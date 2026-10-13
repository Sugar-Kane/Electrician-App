import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { AdminTime } from "@/components/admin-time";
import { Empty, Pill } from "@/components/admin-ui";
import { SelectField } from "@/components/ui/select-field";
import { listCases, listOrganizations, requirePlatformAdmin } from "@/lib/admin-console";
import { createClient } from "@/lib/supabase/server";
import { CASE_CATEGORIES, CASE_SEVERITY_TONE, CASE_STATES } from "@/lib/support-cases";

export const metadata: Metadata = {
  title: "Cases | Volteira support",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SHOW = [
  { value: "active", label: "Not closed" },
  { value: "open", label: "Open" },
  { value: "waiting", label: "Waiting on someone" },
  { value: "verifying", label: "Fix ready to verify" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "Every case" },
];

/** Every support case, overdue updates first, then by severity. */
export default async function AdminCasesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; business?: string; mine?: string }>;
}) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const show = SHOW.some((entry) => entry.value === params.show) ? params.show! : "active";
  const business = UUID.test(params.business ?? "") ? params.business! : "";
  const mine = params.mine === "1";
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const [cases, organizations] = await Promise.all([
    listCases({ state: show === "all" ? "" : show, organizationId: business, assignee: mine ? auth.user?.id : "" }),
    listOrganizations(),
  ]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Cases</h1>
        <Link href="/admin/cases/new" className="tap-target inline-flex items-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand">
          <Plus className="h-4 w-4" aria-hidden /> Open a case
        </Link>
      </div>
      <form action="/admin/cases" className="grid gap-3 rounded-panel border border-line bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
        <SelectField name="show" label="Showing" defaultValue={show} choices={SHOW} placeholder="Not closed" />
        <SelectField
          name="business"
          label="Business"
          defaultValue={business}
          placeholder="Every business"
          choices={[{ value: "", label: "Every business" }, ...organizations.map((entry) => ({ value: entry.id, label: entry.name }))]}
        />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="mine" value="1" defaultChecked={mine} className="h-4 w-4" /> Mine
        </label>
        <button type="submit" className="tap-target rounded-control bg-brand px-5 text-sm font-bold text-on-brand">
          Show
        </button>
      </form>

      {cases.length === 0 ? (
        <Empty>{show === "active" && !business && !mine ? "No open cases." : "Nothing matches."}</Empty>
      ) : (
        <ul className="space-y-2">
          {cases.map((entry) => {
            const overdue = entry.overdue;
            return (
              <li key={entry.id}>
                <Link href={`/admin/cases/${entry.id}`} className="block rounded-control border border-line bg-surface p-4 hover:border-brand/40">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">
                      #{entry.number} · {CASE_CATEGORIES.find((category) => category.value === entry.category)?.label ?? entry.category}
                      {entry.organizationName ? ` · ${entry.organizationName}` : " · Platform"}
                    </p>
                    <span className="flex flex-wrap gap-2">
                      <Pill tone={CASE_SEVERITY_TONE[entry.severity] ?? "neutral"}>{entry.severity}</Pill>
                      <Pill tone={entry.state === "closed" ? "good" : "neutral"}>{CASE_STATES[entry.state] ?? entry.state}</Pill>
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{entry.symptom}</p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {entry.assigneeEmail ? `With ${entry.assigneeEmail}` : "Nobody has it"} · opened{" "}
                    <AdminTime iso={entry.createdAt} timeZone={entry.timeZone} dateOnly />
                    {entry.state === "closed" && entry.closedAt ? (
                      <>
                        {" · closed "}
                        <AdminTime iso={entry.closedAt} timeZone={entry.timeZone} dateOnly />
                      </>
                    ) : entry.nextUpdateDue ? (
                      <span className={overdue ? "font-semibold text-critical" : ""}>
                        {overdue ? " · update overdue since " : " · next update "}
                        <AdminTime iso={entry.nextUpdateDue} timeZone={entry.timeZone} />
                      </span>
                    ) : null}
                    {entry.linkCount ? ` · ${entry.linkCount} linked ${entry.linkCount === 1 ? "record" : "records"}` : ""}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
