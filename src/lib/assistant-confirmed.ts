import "server-only";

import { deliverInvoice } from "@/lib/invoice-delivery";
import { describeDelivery, formatMoney } from "@/lib/invoice-messages";
import { adjustmentTo, isMovementReason, signedQuantity } from "@/lib/inventory-movement";
import { invoiceTotals } from "@/lib/invoice-math";
import { parseCostToCents } from "@/lib/new-job-input";
import { currentContext } from "@/lib/request-context";
import { zonedWallClockToIso } from "@/lib/schedule-labels";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { sendSms } from "@/lib/twilio";

/**
 * The actions somebody has actually approved.
 *
 * Reached only from `confirmProposal`, with the input the person read on the
 * screen. Nothing here asks a model anything: a second model call at this point
 * could produce a different action from the one that was approved, which would
 * make the confirmation meaningless.
 *
 * Every write goes through the caller's session, so RLS decides what may be
 * touched. Each returns a sentence saying what happened, including when it did
 * not happen — a confirmation that silently fails is worse than one that
 * refuses, because the person believes it went out.
 */

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function runConfirmedTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  const context = await currentContext();
  if (!context) return "You are not signed in to a business, so nothing was done.";

  const supabase = asFlexibleClient(await createClient());
  const organizationId = context.organizationId;

  switch (name) {
    case "send_invoice": {
      const number = text(input.invoice_number).replace(/^INV-/i, "");
      const channel = text(input.channel);
      const channels =
        channel === "both" ? (["sms", "email"] as const) : channel === "email" ? (["email"] as const) : (["sms"] as const);

      const { data } = await supabase
        .from("invoices")
        .select(
          `id, invoice_number, status, total_cents, due_at, stripe_hosted_invoice_url,
           jobs ( customer_description, customers ( first_name, last_name, company_name, phone, email ) ),
           organizations ( name, phone, timezone )`,
        )
        .eq("organization_id", organizationId)
        .eq("invoice_number", Number(number))
        .maybeSingle();

      if (!data) return `Invoice ${text(input.invoice_number)} could not be found. Nothing was sent.`;

      const row = data as Record<string, unknown>;
      const job = (row.jobs ?? null) as Record<string, unknown> | null;
      const customer = (job?.customers ?? null) as Record<string, unknown> | null;
      const organization = (row.organizations ?? null) as Record<string, unknown> | null;
      const amount = Number(row.total_cents ?? 0) / 100;

      const attempts = await deliverInvoice({
        invoiceId: text(row.id),
        organizationId,
        channels: [...channels],
        customerPhone: text(customer?.phone),
        customerEmail: text(customer?.email),
        facts: {
          businessName: text(organization?.name) || "Your electrician",
          businessPhone: text(organization?.phone) || "our office",
          contactName:
            text(customer?.company_name) ||
            [text(customer?.first_name), text(customer?.last_name)].filter(Boolean).join(" "),
          invoiceNumber: `INV-${text(row.invoice_number) || number}`,
          amountDue: amount,
          dueLabel: "",
          payUrl: text(row.stripe_hosted_invoice_url) || undefined,
          workSummary: text(job?.customer_description) || undefined,
        },
      });

      return describeDelivery(attempts).message;
    }

    case "send_text": {
      const who = text(input.customer).toLowerCase();
      const body = text(input.message).slice(0, 300);
      if (!body) return "There was no message to send, so nothing was sent.";

      const { data } = await supabase
        .from("customers")
        .select("first_name, last_name, company_name, phone")
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .limit(200);

      const match = ((data ?? []) as Record<string, unknown>[]).find((row) => {
        const name = [
          text(row.company_name),
          text(row.first_name),
          text(row.last_name),
        ]
          .join(" ")
          .toLowerCase();
        return name.includes(who) || text(row.phone).includes(who);
      });

      const phone = text(match?.phone);
      if (!phone) return `No customer matching "${text(input.customer)}" has a mobile number. Nothing was sent.`;

      const { data: settings } = await supabase
        .from("messaging_settings")
        .select("messaging_service_sid")
        .eq("organization_id", organizationId)
        .maybeSingle();

      const sid = text(settings?.messaging_service_sid);
      if (!sid) return "This business has no messaging service, so no text could be sent.";

      const result = await sendSms({ to: phone, body, messagingServiceSid: sid });
      return result.ok
        ? `Text sent to ${phone}.`
        : `The text could not be sent (${result.errorCode}: ${result.errorDetail}).`;
    }

    case "schedule_job": {
      const jobNumber = Number(text(input.job_number));
      const startLocal = text(input.start_local);
      if (!Number.isFinite(jobNumber) || !startLocal) {
        return "That job or time could not be read, so nothing was changed.";
      }

      const hours = Number(text(input.duration_hours) || "2");
      const minutes = Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : 120;

      // Wall clock in the business's zone, not the server's — the fault that
      // once had windows offered in UTC.
      const start = zonedWallClockToIso(startLocal, context.timeZone);
      const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();

      const { error } = await supabase
        .from("jobs")
        .update({
          scheduled_start: start,
          scheduled_end: end,
          arrival_window_start: start,
          arrival_window_end: end,
        })
        .eq("organization_id", organizationId)
        .eq("job_number", jobNumber);

      if (error) return "That job could not be moved.";
      return `Job #${jobNumber} moved. The customer has not been told — send them a text if they should know.`;
    }

    case "assign_technician": {
      const jobNumber = Number(text(input.job_number));
      if (!Number.isFinite(jobNumber)) return "That job could not be read, so nothing was changed.";

      const who = text(input.technician);

      // An empty name is "take them off", which is a real instruction and not a
      // failed lookup. Treating the two the same would silently unassign a job
      // whenever a name was misheard.
      let technicianId: string | null = null;
      if (who) {
        const { data } = await supabase
          .from("technicians")
          .select("id, display_name")
          .eq("organization_id", organizationId)
          .limit(100);

        const rows = (data ?? []) as Record<string, unknown>[];
        const needle = who.toLowerCase();
        const exact = rows.find((row) => text(row.display_name).toLowerCase() === needle);
        const partial = rows.filter((row) => text(row.display_name).toLowerCase().includes(needle));

        const match = exact ?? (partial.length === 1 ? partial[0] : undefined);
        if (!match) {
          // Ambiguity is reported rather than guessed. Two people called Nick
          // and picking one is how the wrong person drives to Nipomo.
          return partial.length > 1
            ? `More than one technician matches "${who}": ${partial.map((row) => text(row.display_name)).join(", ")}. Nothing was changed.`
            : `No technician called "${who}" is on this crew. Nothing was changed.`;
        }
        technicianId = text(match.id);
      }

      const { data: updated, error } = await supabase
        .from("jobs")
        .update({ technician_id: technicianId })
        .eq("organization_id", organizationId)
        .eq("job_number", jobNumber)
        .select("job_number")
        .maybeSingle();

      if (error) return "That job could not be updated.";
      if (!updated) return `Job #${jobNumber} could not be found. Nothing was changed.`;

      return who
        ? `${who} is now on job #${jobNumber}. The customer has not been told.`
        : `Job #${jobNumber} has nobody assigned now.`;
    }

    /*
     * Stock in or out, said out loud.
     *
     * The assistant could look stock up and nothing else, so "I used three of
     * those" got the answer that it had no way to change anything and the
     * electrician had to go and do it by hand — which is exactly the boring
     * thing this is supposed to absorb.
     *
     * A movement, never a set. `stock_take` is the one that reads as a total,
     * and it is turned into the difference here rather than trusted as one,
     * because "I counted seventeen" and "add seventeen" are different sentences.
     */
    case "adjust_stock": {
      const part = text(input.part);
      const typed = Number(input.quantity);
      const reason = text(input.reason);

      if (!part) return "Nothing was changed — the part was not named.";
      if (!Number.isFinite(typed)) return "Nothing was changed — that number could not be read.";
      if (!isMovementReason(reason) || reason === "opening" || reason === "used_on_job") {
        return "Nothing was changed — say whether they arrived, came back, were damaged, or were counted.";
      }

      const { data: found } = await supabase
        .from("inventory_items")
        .select("id, name, quantity_on_hand, unit, unit_cost_cents")
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .ilike("name", `%${part}%`)
        .limit(2);

      const matches = (found ?? []) as Record<string, unknown>[];
      if (matches.length === 0) {
        return `Nothing in stock matches "${part}", so nothing was changed. Add it first if it is new.`;
      }
      if (matches.length > 1) {
        const names = matches.map((row) => text(row.name)).join(" and ");
        return `More than one part matches "${part}" — ${names}. Nothing was changed; say which one.`;
      }

      const item = matches[0]!;
      const onHand = Number(item.quantity_on_hand ?? 0);

      // A counted total becomes the difference that gets there.
      const change =
        reason === "stock_take"
          ? adjustmentTo(Math.abs(typed), onHand)
          : signedQuantity(reason, typed);

      if (change === null || change === 0) {
        return `${text(item.name)} already reads ${onHand} ${text(item.unit) || "each"}. Nothing was changed.`;
      }

      const { error } = await supabase.from("inventory_movements").insert({
        organization_id: organizationId,
        item_id: text(item.id),
        quantity: change,
        reason,
        unit_cost_cents: Number(item.unit_cost_cents ?? 0),
        note: text(input.note) || "Recorded through the assistant.",
      });

      if (error) {
        console.error("assistant: stock movement failed", error);
        return "That change could not be recorded, so nothing moved.";
      }

      const now = Math.round((onHand + change) * 100) / 100;
      const unit = text(item.unit) || "each";
      return `${text(item.name)} is now ${now} ${unit}, from ${onHand}.`;
    }

    case "add_stock_item": {
      const name = text(input.name);
      if (!name) return "Nothing was added — the part was not named.";

      const quantity = Number(input.quantity);
      if (!Number.isFinite(quantity) || quantity < 0) {
        return "Nothing was added — that quantity could not be read.";
      }

      // A second row for a part already listed splits its count in half, and
      // the materials list then matches whichever one it finds first.
      const { data: clash } = await supabase
        .from("inventory_items")
        .select("name")
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .ilike("name", name)
        .maybeSingle();

      if (clash) {
        return `${text(clash.name)} is already in the stock list, so nothing was added. Adjust its count instead.`;
      }

      const unitCostCents = parseCostToCents(text(input.unit_cost)) ?? 0;
      const unit = text(input.unit) || "each";

      const { data: created, error } = await supabase
        .from("inventory_items")
        // The trigger owns the count; the opening movement below sets it.
        .insert({
          organization_id: organizationId,
          name,
          quantity_on_hand: 0,
          unit,
          sku: text(input.part_number) || null,
          unit_cost_cents: unitCostCents,
          location: text(input.location) || null,
        })
        .select("id")
        .maybeSingle();

      const itemId = text((created ?? {}).id);
      if (error || !itemId) {
        console.error("assistant: stock item could not be added", error);
        return "That part could not be added to the stock list.";
      }

      if (quantity > 0) {
        await supabase.from("inventory_movements").insert({
          organization_id: organizationId,
          item_id: itemId,
          quantity,
          reason: "opening",
          unit_cost_cents: unitCostCents,
          note: "Added through the assistant.",
        });
      }

      return `${name} is in the stock list with ${quantity} ${unit} on hand.`;
    }

    case "set_invoice_amount": {
      const jobNumber = Number(text(input.job_number));
      const cents = parseCostToCents(text(input.amount));
      if (!Number.isFinite(jobNumber)) return "That job could not be read.";
      if (cents === null || cents <= 0) return "That amount could not be read, so no invoice was raised.";

      const { data: job } = await supabase
        .from("jobs")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("job_number", jobNumber)
        .maybeSingle();

      if (!job) return `Job #${jobNumber} could not be found.`;

      const totals = invoiceTotals({ subtotalCents: cents });
      const { error } = await supabase.from("invoices").insert({
        organization_id: organizationId,
        job_id: text((job as Record<string, unknown>).id),
        status: "draft",
        subtotal_cents: totals.subtotalCents,
        diagnostic_credit_cents: totals.diagnosticCreditCents,
        tax_cents: totals.taxCents,
        total_cents: totals.totalCents,
        balance_due_cents: totals.totalCents,
        stripe_application_fee_cents: totals.applicationFeeCents,
      });

      if (error) return "That invoice could not be created.";
      return `Draft invoice for ${formatMoney(totals.totalCents / 100)} created on job #${jobNumber}. It has not been sent.`;
    }

    case "draft_contract": {
      const jobNumber = text(input.job_number);
      if (!jobNumber) return "That job could not be read, so no contract was drafted.";

      // The job page's own generator, called rather than reimplemented. Two
      // code paths for the same document is how the two drift, and a contract
      // that differs depending on where it was raised is the worst version of
      // that.
      const { generateContract } = await import("@/app/jobs/[jobId]/contract-actions");
      const form = new FormData();
      form.set("jobNumber", jobNumber);

      const result = await generateContract({ error: "" }, form);
      if (result.error) return result.error;
      return `${result.notice ?? "Draft contract created."} Open job #${jobNumber} to read it — it has not been sent.`;
    }

    default:
      return `Nothing happened: ${name} is not something this can do.`;
  }
}
