import Link from "next/link";
import { Boxes, CalendarDays, ReceiptText, Route } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { SearchConsole } from "@/components/search-console";
import { getJobs } from "@/lib/job-data";

/**
 * Search, and the assistant, in one place.
 *
 * The page is a shell now: it fetches the jobs once — they are already loaded
 * for the dashboard on every other screen and filtering them in the browser is
 * what makes job matches instant — and hands everything else to the console,
 * which does the typing, the customer lookup and the asking.
 */
export const dynamic = "force-dynamic";

const SHORTCUTS = [
  { label: "Schedule", description: "Open calendar view", href: "/schedule", icon: CalendarDays },
  { label: "Invoices", description: "Paid and unpaid", href: "/invoices", icon: ReceiptText },
  { label: "Materials", description: "Stock and sourcing", href: "/materials", icon: Boxes },
  { label: "Route builder", description: "Optimize today", href: "/route", icon: Route },
];

export default async function SearchPage() {
  const { jobs } = await getJobs();

  return (
    <FieldPageShell
      title="Search"
      eyebrow="Find anything"
      description="Customers by name, number or address — or ask Volteira a question."
    >
      <SearchConsole jobs={jobs} />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SHORTCUTS.map(({ label, description, href, icon: Icon }) => (
          <Link key={href} href={href} className="tap-card rounded-control border border-line p-3">
            <Icon className="h-5 w-5 text-brand" aria-hidden />
            <p className="mt-3 text-sm font-semibold">{label}</p>
            <p className="mt-1 text-[10px] text-ink-faint">{description}</p>
          </Link>
        ))}
      </div>
    </FieldPageShell>
  );
}
