import { FieldPageShell } from "@/components/field-page-shell";
import { InvoiceList } from "@/components/invoice-list";
import { todayInZone } from "@/lib/calendar";
import type { PaidPeriod } from "@/lib/dashboard-metrics";
import { getInvoices } from "@/lib/job-data";
import { currentContext } from "@/lib/request-context";
import { DEFAULT_TIMEZONE } from "@/lib/timezones";

const TITLES: Record<string, string> = {
  paid: "Paid invoices",
  draft: "Drafts not sent",
  awaiting: "Awaiting payment",
  unpaid: "Awaiting payment",
  overdue: "Overdue invoices",
};

const PERIOD_TITLES: Record<PaidPeriod, string> = {
  today: "Paid today",
  month: "Paid this month",
};

/**
 * Invoices.
 *
 * The page fetches once and hands the whole list to a client component, which
 * does the filtering. The tabs used to be links, so every one was a server
 * round trip that fetched all the invoices and then filtered them in memory —
 * identical work for a different view of the same data.
 *
 * The status in the URL still selects the opening tab, so a link from the
 * dashboard to "unpaid" lands where it says it will. `paid=today` narrows Paid
 * to the business's own today, so "Paid today" on Today opens the invoices
 * that make up its number and no others.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; paid?: string }>;
}) {
  const [{ status = "all", paid = "" }, { invoices }, context] = await Promise.all([
    searchParams,
    getInvoices(),
    currentContext(),
  ]);
  const period: PaidPeriod | null = paid === "today" || paid === "month" ? paid : null;
  const today = todayInZone(context?.timeZone || DEFAULT_TIMEZONE);
  const title = period && status === "paid" ? PERIOD_TITLES[period] : (TITLES[status] ?? "Invoices");

  return (
    <FieldPageShell
      title={title}
      eyebrow="Revenue and collections"
      description="Tap an invoice to open its related job and customer context."
    >
      <InvoiceList invoices={invoices} initialStatus={status} paidPeriod={period} today={today} />
    </FieldPageShell>
  );
}
