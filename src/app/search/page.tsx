import Link from "next/link";
import { Boxes, BriefcaseBusiness, CalendarDays, ChevronRight, ReceiptText, Route, Search } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { getJobs } from "@/lib/job-data";

const shortcuts = [
  { label: "Schedule", description: "Open calendar view", href: "/schedule", icon: CalendarDays },
  { label: "Invoices", description: "Paid and unpaid", href: "/invoices", icon: ReceiptText },
  { label: "Materials", description: "Stock and sourcing", href: "/materials", icon: Boxes },
  { label: "Route builder", description: "Optimize today", href: "/route", icon: Route },
];

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ query?: string; scope?: string }> }) {
  const { query = "", scope } = await searchParams;
  const normalized = query.trim().toLowerCase();
  const { jobs: allJobs } = await getJobs();
  const jobs = allJobs.filter((job) => !normalized || `${job.customer} ${job.contactName} ${job.id} ${job.address} ${job.city} ${job.workType} ${job.materials.map((material) => material.name).join(" ")}`.toLowerCase().includes(normalized));
  const title = scope === "customers" ? "Customers" : scope === "estimates" ? "Estimates" : scope === "settings" ? "Settings" : scope === "notifications" ? "Notifications" : "Search";

  return (
    <FieldPageShell title={title} eyebrow="Find anything" description="Search by customer, job number, address, city, work type, or material.">
      <section className="rounded-panel border border-line bg-surface p-4 sm:p-6">
        <form action="/search" className="flex gap-2"><input type="hidden" name="scope" value={scope ?? ""} /><label className="flex min-h-13 flex-1 items-center gap-3 rounded-control border border-line bg-raised px-4"><Search className="h-5 w-5 text-ink-faint" aria-hidden /><span className="sr-only">Search</span><input name="query" defaultValue={query} autoFocus placeholder="Name, address, job #, material…" className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-ink-faint" /></label><button className="tap-target grid h-13 w-13 place-items-center rounded-control bg-brand text-on-brand" aria-label="Run search"><Search className="h-5 w-5" aria-hidden /></button></form>
        {!query ? <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">{shortcuts.map(({ label, description, href, icon: Icon }) => <Link key={href} href={href} className="tap-card rounded-control border border-line p-3"><Icon className="h-5 w-5 text-brand" aria-hidden /><p className="mt-3 text-sm font-semibold">{label}</p><p className="mt-1 text-[10px] text-ink-faint">{description}</p></Link>)}</div> : null}
        <div className="mt-5 space-y-2"><div className="flex items-center justify-between"><h2 className="font-semibold">{query ? `Results for “${query}”` : "Jobs and customers"}</h2><span className="text-xs text-ink-faint">{jobs.length}</span></div>{jobs.map((job) => <Link key={job.id} href={`/jobs/${job.id}`} className="tap-row flex min-h-[74px] items-center gap-3 rounded-control border border-line px-4 py-3 active:bg-white/5"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-white/5"><BriefcaseBusiness className="h-5 w-5 text-brand" aria-hidden /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{job.customer} · #{job.id}</span><span className="mt-1 block truncate text-xs text-ink-muted">{job.contactName} · {job.workType}</span><span className="mt-0.5 block truncate text-[10px] text-ink-faint">{job.address}, {job.city}</span></span><ChevronRight className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden /></Link>)}{jobs.length === 0 ? <p className="rounded-control border border-dashed border-line p-8 text-center text-sm text-ink-muted">No matching jobs or customers.</p> : null}</div>
      </section>
    </FieldPageShell>
  );
}
