import "server-only";

import { currentContext } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import { asFlexibleClient } from "@/lib/supabase/flexible";

/**
 * Every customer the business has, for the Customers list.
 *
 * Read through the caller's own session, so row security decides whose
 * customers these are. Each carries what somebody scanning the list looks
 * for: how to reach them, where the work is, and the last job.
 */

export type CustomerListItem = {
  id: string;
  name: string;
  /** "es" when the customer speaks Spanish. */
  language: "en" | "es";
  phone: string;
  email: string;
  address: string;
  lastJob: { number: string; when: string; at: string } | null;
  jobCount: number;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function getCustomerList(): Promise<CustomerListItem[]> {
  const context = await currentContext();
  if (!context) return [];

  const supabase = asFlexibleClient(await createClient());
  const { data, error } = await supabase
    .from("customers")
    .select(
      `id, first_name, last_name, company_name, phone, email, created_at, preferred_language,
       properties ( address_line_1, city, archived_at ),
       jobs ( job_number, scheduled_start, created_at, archived_at )`,
    )
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return [];

  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: context.timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const properties = ((row.properties ?? []) as Record<string, unknown>[]).filter((p) => !p.archived_at);
    const jobs = ((row.jobs ?? []) as Record<string, unknown>[])
      .filter((job) => !job.archived_at)
      .map((job) => ({
        number: String(job.job_number ?? ""),
        // A job with no time yet still happened when it was written down.
        at: text(job.scheduled_start) || text(job.created_at),
        scheduled: Boolean(job.scheduled_start),
      }))
      .sort((a, b) => b.at.localeCompare(a.at));
    const last = jobs[0];
    const property = properties[0];

    return {
      id: text(row.id),
      name:
        text(row.company_name) ||
        [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ") ||
        "Unnamed customer",
      language: row.preferred_language === "es" ? "es" : "en",
      phone: text(row.phone),
      email: text(row.email),
      address: property ? [text(property.address_line_1), text(property.city)].filter(Boolean).join(", ") : "",
      lastJob: last
        ? {
            number: last.number,
            when: last.at ? `${last.scheduled ? "" : "Added "}${day.format(new Date(last.at))}` : "",
            at: last.at,
          }
        : null,
      jobCount: jobs.length,
    };
  });
}
