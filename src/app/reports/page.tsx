import {
  InvoiceOverview,
  ProfitOverview,
  RecentActivity,
} from "@/components/dashboard-shell";
import { FieldPageShell } from "@/components/field-page-shell";
import { getDashboardSnapshot } from "@/lib/dashboard";

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
  const snapshot = await getDashboardSnapshot();

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
    </FieldPageShell>
  );
}
