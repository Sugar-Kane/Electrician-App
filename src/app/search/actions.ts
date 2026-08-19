"use server";

import { currentContext } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { digitsOf, rankCustomers, type Searchable } from "@/lib/customer-search";

/**
 * Customers, as somebody types their name.
 *
 * Called from the search box on every pause in typing, so it has to be one
 * round trip and it has to be narrow. The database does the coarse filtering —
 * an `or` of `ilike`s over the fields somebody might reasonably type, plus the
 * service address, which lives on `properties` rather than on the customer —
 * and `rankCustomers` does the ordering, because ranking is the part that is
 * worth testing and the part that decides whether the right row is visible
 * before the name is finished.
 *
 * Names, numbers and addresses only. Nothing here can write anything, and every
 * query is scoped to the caller's organization by the same context the rest of
 * the app uses.
 */

export type CustomerMatch = {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  /** "2 open jobs", "Booking request waiting" — enough to tell two Johns apart. */
  status: string;
};

/** Below this there is nothing to go on and every customer would match. */
const MINIMUM = 2;

function nameOf(row: Record<string, unknown>): string {
  const company = typeof row.company_name === "string" ? row.company_name : "";
  const first = typeof row.first_name === "string" ? row.first_name : "";
  const last = typeof row.last_name === "string" ? row.last_name : "";
  return company || [first, last].filter(Boolean).join(" ") || "Unnamed customer";
}

function addressOf(properties: unknown): string {
  const list = Array.isArray(properties) ? (properties as Record<string, unknown>[]) : [];
  const first = list[0];
  if (!first) return "";

  const line = typeof first.address_line_1 === "string" ? first.address_line_1 : "";
  const city = typeof first.city === "string" ? first.city : "";
  return [line, city].filter(Boolean).join(", ");
}

export async function searchCustomers(query: string): Promise<CustomerMatch[]> {
  const needle = query.trim();
  if (needle.length < MINIMUM) return [];

  const context = await currentContext();
  if (!context) return [];

  const supabase = asFlexibleClient(await createClient());

  /*
   * Two shapes of match go to the database. The text one is an `ilike` per
   * field; the phone one compares digits, because a number stored as
   * "(432) 555-1234" contains none of the characters somebody types.
   *
   * `%` and `_` are wildcards inside `ilike` and a comma ends a term inside
   * `or`, so all three are escaped — a customer called "50%" is not a reason to
   * return the whole book.
   */
  const safe = needle.replace(/[%_,]/g, (match) => `\\${match}`);
  const digits = digitsOf(needle);

  const terms = [
    `first_name.ilike.%${safe}%`,
    `last_name.ilike.%${safe}%`,
    `company_name.ilike.%${safe}%`,
    `email.ilike.%${safe}%`,
    `phone.ilike.%${safe}%`,
  ];
  if (digits.length >= 3) terms.push(`phone.ilike.%${digits}%`);

  const [{ data: byCustomer }, { data: byAddress }] = await Promise.all([
    supabase
      .from("customers")
      .select(
        "id, first_name, last_name, company_name, phone, email, properties(address_line_1, city)",
      )
      .eq("organization_id", context.organizationId)
      .is("archived_at", null)
      .or(terms.join(","))
      .limit(40),
    // The address is on the property, so a search for "Main Street" cannot come
    // out of the customers table at all. Two queries beat a join that would
    // drop every customer who has no property on file.
    needle.length >= 3
      ? supabase
          .from("properties")
          .select(
            "address_line_1, city, customers(id, first_name, last_name, company_name, phone, email)",
          )
          .eq("organization_id", context.organizationId)
          .is("archived_at", null)
          .or(`address_line_1.ilike.%${safe}%,city.ilike.%${safe}%`)
          .limit(40)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const found = new Map<string, Searchable>();

  for (const row of (byCustomer ?? []) as Record<string, unknown>[]) {
    const id = String(row.id ?? "");
    if (!id) continue;
    found.set(id, {
      id,
      name: nameOf(row),
      phone: typeof row.phone === "string" ? row.phone : "",
      email: typeof row.email === "string" ? row.email : "",
      address: addressOf(row.properties),
    });
  }

  for (const row of (byAddress ?? []) as Record<string, unknown>[]) {
    const customer = (row.customers ?? {}) as Record<string, unknown>;
    const id = String(customer.id ?? "");
    if (!id || found.has(id)) continue;

    const line = typeof row.address_line_1 === "string" ? row.address_line_1 : "";
    const city = typeof row.city === "string" ? row.city : "";

    found.set(id, {
      id,
      name: nameOf(customer),
      phone: typeof customer.phone === "string" ? customer.phone : "",
      email: typeof customer.email === "string" ? customer.email : "",
      address: [line, city].filter(Boolean).join(", "),
    });
  }

  const ranked = rankCustomers([...found.values()], needle);
  if (ranked.length === 0) return [];

  // What each of them has open, so two customers with the same name are
  // distinguishable by something other than the name that made them ambiguous.
  const [{ data: jobs }, { data: requests }] = await Promise.all([
    supabase
      .from("jobs")
      .select("customer_id, status")
      .eq("organization_id", context.organizationId)
      .in(
        "customer_id",
        ranked.map((customer) => customer.id),
      )
      .not("status", "in", "(completed,canceled)")
      .is("archived_at", null),
    supabase
      .from("booking_requests")
      .select("customer_id, status")
      .eq("organization_id", context.organizationId)
      .in(
        "customer_id",
        ranked.map((customer) => customer.id),
      )
      .in("status", ["new", "needs_review", "awaiting_payment", "safety_escalated"]),
  ]);

  const openJobs = new Map<string, number>();
  for (const row of (jobs ?? []) as Record<string, unknown>[]) {
    const key = String(row.customer_id ?? "");
    openJobs.set(key, (openJobs.get(key) ?? 0) + 1);
  }

  const openRequests = new Set(
    ((requests ?? []) as Record<string, unknown>[]).map((row) => String(row.customer_id ?? "")),
  );

  return ranked.map((customer) => {
    const jobCount = openJobs.get(customer.id) ?? 0;
    const parts: string[] = [];
    if (openRequests.has(customer.id)) parts.push("Request waiting");
    if (jobCount > 0) parts.push(`${jobCount} open ${jobCount === 1 ? "job" : "jobs"}`);

    return { ...customer, status: parts.join(" · ") };
  });
}
