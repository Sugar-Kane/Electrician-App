import "server-only";

import {
  buildReferenceBrief,
  findReferences,
} from "@/lib/code-reference";
import { forgetFact, getMemories, rememberFact } from "@/lib/assistant-memory";
import { lookUpListPrice } from "@/lib/claude";
import { matchMaterials, normalizeName } from "@/lib/inventory-match";
import { getInventory, getInvoices, getJobs } from "@/lib/job-data";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { currentContext } from "@/lib/request-context";

/**
 * The read-only tools, executed.
 *
 * Everything here answers a question and changes nothing, which is why it runs
 * without asking. Each one reads through the same functions the pages use, so
 * the organization comes from the caller's own session and RLS decides what is
 * visible — the chat cannot see a row the person asking could not already open.
 *
 * Results come back as short text rather than JSON. The model reads them, and a
 * list of six jobs in prose costs a fraction of the tokens the same rows cost
 * as objects.
 */

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const MAX_ROWS = 12;

export async function runReadOnlyTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "search_jobs": {
      const query = text(input.query).toLowerCase();
      const { jobs } = await getJobs();
      const matched = query
        ? jobs.filter((job) =>
            [job.customer, job.city, job.address, job.workType, job.status, job.id]
              .join(" ")
              .toLowerCase()
              .includes(query),
          )
        : jobs;

      if (matched.length === 0) return "No jobs match that.";
      return matched
        .slice(0, MAX_ROWS)
        .map(
          (job) =>
            `#${job.id} | ${job.dateLabel} ${job.time} | ${job.customer} | ${job.city} | ${job.workType} | ${job.status} | ${job.technician}`,
        )
        .join("\n");
    }

    case "search_customers": {
      const query = text(input.query).toLowerCase();
      if (!query) return "Give a name, number or address to search for.";

      const context = await currentContext();
      if (!context) return "Not signed in to a business.";

      const supabase = asFlexibleClient(await createClient());
      const { data } = await supabase
        .from("customers")
        .select("first_name, last_name, company_name, phone, email")
        .eq("organization_id", context.organizationId)
        .is("archived_at", null)
        .limit(200);

      const rows = ((data ?? []) as Record<string, unknown>[])
        .map((row) => ({
          name:
            text(row.company_name) ||
            [text(row.first_name), text(row.last_name)].filter(Boolean).join(" "),
          phone: text(row.phone),
          email: text(row.email),
        }))
        .filter((row) => `${row.name} ${row.phone} ${row.email}`.toLowerCase().includes(query));

      if (rows.length === 0) return "No customer matches that.";
      return rows
        .slice(0, MAX_ROWS)
        .map((row) => `${row.name} | ${row.phone || "no phone"} | ${row.email || "no email"}`)
        .join("\n");
    }

    case "check_stock": {
      const part = text(input.part);
      if (!part) return "Name the part to check.";

      const stock = await getInventory();
      const [matched] = matchMaterials(
        [{ name: part, quantity: 1, unit: "each" }],
        stock.map((entry) => ({
          id: entry.id,
          name: entry.name,
          quantity: entry.quantity,
          unit: entry.unit,
          partNumber: entry.partNumber,
          location: entry.location,
        })),
      );

      if (!matched?.stock) {
        return `Nothing in stock matches "${part}". It is not necessarily absent — it may be recorded under a different name.`;
      }
      const found = matched.stock;
      return `${found.name}: ${found.quantity} ${found.unit}${found.location ? `, ${found.location}` : ""}.`;
    }

    /*
     * The list, not one row.
     *
     * `check_stock` answers "have I got one of these" and returns a single best
     * match, which made "what breakers do I have" unanswerable — the assistant
     * would name one and go quiet. This is the other question, and it is the
     * one people actually ask standing in front of a van.
     */
    case "search_stock": {
      const query = normalizeName(text(input.query));
      const stock = await getInventory();

      const matches = query
        ? stock.filter(
            (entry) =>
              normalizeName(entry.name).includes(query) ||
              normalizeName(entry.partNumber).includes(query) ||
              normalizeName(entry.location).includes(query),
          )
        : stock;

      if (matches.length === 0) {
        return stock.length === 0
          ? "There is nothing in the stock list yet."
          : `Nothing in stock matches "${text(input.query)}".`;
      }

      return matches
        .slice(0, MAX_ROWS)
        .map(
          (entry) =>
            `${entry.name} | ${entry.quantity} ${entry.unit}${
              entry.partNumber ? ` | ${entry.partNumber}` : ""
            }${entry.location ? ` | ${entry.location}` : ""}`,
        )
        .join("\n");
    }

    /*
     * What the next one costs, as opposed to what the last one cost.
     *
     * The two stock tools above answer from the ledger, which is a record of
     * prices already paid. This is the question that comes before an estimate,
     * and the assistant had no way to reach it at all.
     *
     * Located to the business: a price in Santa Maria is not a price in Boston,
     * and both availability and sales tax move by state.
     */
    case "look_up_price": {
      const part = text(input.part);
      if (!part) return "Name the part to price.";

      const context = await currentContext();
      if (!context) return "Not signed in to a business.";

      const supabase = asFlexibleClient(await createClient());
      const { data: organization } = await supabase
        .from("organizations")
        .select("base_city, base_state, timezone")
        .eq("id", context.organizationId)
        .maybeSingle();

      const found = await lookUpListPrice({
        part,
        city: text(organization?.base_city),
        state: text(organization?.base_state),
        timeZone: text(organization?.timezone),
      });

      if (!found) {
        return "That price could not be looked up just now. Say so rather than guessing at a figure.";
      }

      /*
       * A search that did not run is not an answer.
       *
       * Left to itself the model will fill the gap from memory, and a
       * remembered price looks exactly like a real one to somebody about to
       * quote a job. So the failure is reported instead of the text.
       */
      if (!found.searched) {
        return "The web search did not return anything for that part. Tell them the lookup failed — do not give a figure from memory.";
      }

      const where = found.sources.length > 0 ? `\n\nSeen at: ${found.sources.join(", ")}` : "";
      return `${found.answer}${where}\n\n(This is a public list price with no trade discount in it. Say so.)`;
    }

    case "list_invoices": {
      const status = text(input.status) || "all";
      const { invoices } = await getInvoices();
      const filtered =
        status === "all"
          ? invoices
          : invoices.filter((invoice) => invoice.status.toLowerCase() === status);

      if (filtered.length === 0) return `No ${status === "all" ? "" : `${status} `}invoices.`;
      return filtered
        .slice(0, MAX_ROWS)
        .map(
          (invoice) =>
            `${invoice.id} | ${invoice.customer} | $${invoice.amount.toFixed(2)} | ${invoice.status} | due ${invoice.due}${invoice.sentLabel ? ` | sent ${invoice.sentLabel}` : " | never sent"}`,
        )
        .join("\n");
    }

    case "list_technicians": {
      const query = text(input.query).toLowerCase();
      const context = await currentContext();
      if (!context) return "Not signed in to a business.";

      const supabase = asFlexibleClient(await createClient());
      const { data } = await supabase
        .from("technicians")
        .select("display_name, phone, is_active, skills")
        .eq("organization_id", context.organizationId)
        .order("display_name", { ascending: true });

      const rows = ((data ?? []) as Record<string, unknown>[]).filter(
        (row) => !query || text(row.display_name).toLowerCase().includes(query),
      );

      if (rows.length === 0) {
        return query ? `No technician matches "${text(input.query)}".` : "This business has no technicians on its crew yet.";
      }

      return rows
        .slice(0, MAX_ROWS)
        .map(
          (row) =>
            `${text(row.display_name)} | ${row.is_active === false ? "inactive" : "active"}${text(row.phone) ? ` | ${text(row.phone)}` : ""}`,
        )
        .join("\n");
    }

    case "lookup_code": {
      const question = text(input.question);
      const entries = findReferences(question);
      // The empty case is the important one: no entry means the index does not
      // cover it, and the model has to say so rather than fill the gap.
      return buildReferenceBrief(entries);
    }

    case "remember": {
      const fact = text(input.fact);
      const stored = await rememberFact(fact);
      return stored ? `Remembered: ${fact}` : "That could not be remembered.";
    }

    case "forget": {
      const removed = await forgetFact(text(input.id));
      return removed ? "Forgotten." : "That memory could not be found.";
    }

    default:
      return `No such tool: ${name}.`;
  }
}

/** The memories, for showing in the chat's own settings. */
export { getMemories };
