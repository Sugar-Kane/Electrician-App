import Link from "next/link";
import { ChevronRight, MapPin, Phone, Search } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { getCustomerList } from "@/lib/customer-list";
import { matchScore } from "@/lib/customer-search";
import { formatForDisplay } from "@/lib/phone-format";

export const dynamic = "force-dynamic";

/**
 * Everyone the business has worked for.
 *
 * A customer page already existed, but the only way to it was search — so
 * "who was that panel job on Elm Street last spring" meant remembering a name
 * to type. This lists them all, most recently worked for first, with the
 * search box narrowing the same list. The query stays in the address, so
 * coming back from a customer lands on the same results.
 */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ q = "" }, customers] = await Promise.all([searchParams, getCustomerList()]);
  const query = q.slice(0, 80);

  const shown = query
    ? customers
        .map((customer) => ({ customer, score: matchScore(customer, query) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.customer.name.localeCompare(b.customer.name))
        .map((entry) => entry.customer)
    : [...customers].sort((a, b) => (b.lastJob?.at ?? "").localeCompare(a.lastJob?.at ?? ""));

  return (
    <FieldPageShell title="Customers" eyebrow="Work" compact>
      <section className="rounded-panel border border-line bg-surface p-3 sm:p-5">
        <form action="/customers" className="flex gap-2">
          <label className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-control border border-line bg-raised px-4">
            <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
            <span className="sr-only">Search customers</span>
            <input
              name="q"
              defaultValue={query}
              placeholder="Name, phone, email or address"
              className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-ink-faint"
            />
          </label>
          <button className="tap-target shrink-0 rounded-control border border-line px-4 text-sm font-semibold">
            Search
          </button>
        </form>

        <p className="mt-3 px-1 text-xs text-ink-muted" aria-live="polite">
          {query
            ? `${shown.length} of ${customers.length} ${customers.length === 1 ? "customer" : "customers"} match “${query}”`
            : `${customers.length} ${customers.length === 1 ? "customer" : "customers"}, most recent work first`}
        </p>

        {shown.length === 0 ? (
          <p className="mt-3 rounded-control border border-dashed border-line p-6 text-center text-sm text-ink-muted">
            {query
              ? `Nobody matches “${query}”. Try part of the name, or the last four digits of the phone.`
              : "No customers yet. A customer is added with their first job."}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {shown.map((customer) => (
              <li key={customer.id}>
                <Link
                  href={`/customers/${customer.id}`}
                  prefetch={false}
                  className="tap-row flex min-h-16 items-center gap-3 rounded-control border border-line bg-raised px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{customer.name}</span>
                    {customer.phone ? (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-ink-muted">
                        <Phone className="h-3 w-3 shrink-0" aria-hidden />
                        {formatForDisplay(customer.phone)}
                      </span>
                    ) : null}
                    {customer.address ? (
                      <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-ink-faint">
                        <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate">{customer.address}</span>
                      </span>
                    ) : null}
                    <span className="mt-0.5 block text-[11px] text-ink-faint">
                      {customer.lastJob
                        ? `Last job #${customer.lastJob.number} · ${customer.lastJob.when}${
                            customer.jobCount > 1 ? ` · ${customer.jobCount} jobs` : ""
                          }`
                        : "No jobs yet"}
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </FieldPageShell>
  );
}
