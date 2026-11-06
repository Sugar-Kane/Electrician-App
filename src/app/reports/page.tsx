import {
  InvoiceOverview,
  ProfitOverview,
  RecentActivity,
} from "@/components/dashboard-shell";
import { FieldPageShell } from "@/components/field-page-shell";
import { Download } from "lucide-react";

import { canExportReports } from "@/lib/csv";
import { getDashboardSnapshot } from "@/lib/dashboard";
import { REPORT_EXPORTS } from "@/lib/report-exports";
import { currentContext } from "@/lib/request-context";
import { calendarDate } from "@/lib/schedule-labels";

export const dynamic = "force-dynamic";

/**
 * The business numbers, off the field dashboard.
 *
 * Profit, invoice ageing and recent activity were three of the seven sections
 * an electrician scrolled past to reach today's work. They are worth reading —
 * monthly, sitting down — so they moved rather than went away. The same
 * components render them; nothing was rebuilt.
 */
export default async function ReportsPage() {
  const [snapshot, context] = await Promise.all([getDashboardSnapshot(), currentContext()]);
  const zone = snapshot.timezone || "America/Los_Angeles";
  const today = calendarDate(new Date().toISOString(), zone);
  const yearStart = `${today.slice(0, 4)}-01-01`;

  return (
    <FieldPageShell
      title="Reports"
      eyebrow="Business"
      description="Money in, money owed, and what has been happening."
      backHref="/"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <ProfitOverview profit={snapshot.profit} />
        <InvoiceOverview
          invoiceAging={snapshot.invoiceAging}
          outstandingValue={snapshot.metrics[4]?.value ?? "$0"}
        />
        <div className="sm:col-span-2">
          <RecentActivity activity={snapshot.activity} />
        </div>
      </div>

      <section id="download" className="mt-4 rounded-panel border border-line bg-surface p-4 sm:p-5" aria-labelledby="download-heading">
        <h2 id="download-heading" className="flex items-center gap-2 text-base font-semibold">
          <Download className="h-4 w-4 text-brand" aria-hidden />
          Download for a spreadsheet
        </h2>
        {context && canExportReports(context.role) ? (
          <>
            <p className="mt-1 text-sm text-ink-muted">
              CSV files that open in Excel, Google Sheets or Numbers, or that you can send to your accountant. Pick the dates,
              then the report.
            </p>
            <form action="/reports/export" method="get" className="mt-4">
              <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
                <label className="text-xs font-semibold text-ink-muted">
                  From
                  <input type="date" name="from" defaultValue={yearStart} max={today} className="mt-1 min-h-11 w-full rounded-control border border-line bg-raised px-3 text-sm text-ink" />
                </label>
                <label className="text-xs font-semibold text-ink-muted">
                  To
                  <input type="date" name="to" defaultValue={today} max={today} className="mt-1 min-h-11 w-full rounded-control border border-line bg-raised px-3 text-sm text-ink" />
                </label>
              </div>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {Object.entries(REPORT_EXPORTS).map(([key, report]) => (
                  <li key={key}>
                    <button
                      type="submit"
                      name="report"
                      value={key}
                      className="tap-row flex min-h-16 w-full items-center gap-3 rounded-control border border-line px-3 py-2 text-left"
                    >
                      <Download className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{report.title}</span>
                        <span className="block text-xs leading-5 text-ink-muted">{report.note}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </form>
          </>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">Ask your business owner, an admin or your accountant to download reports.</p>
        )}
      </section>
    </FieldPageShell>
  );
}
