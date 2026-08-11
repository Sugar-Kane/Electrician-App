import { FieldPageShell } from "@/components/field-page-shell";
import { InvoiceList } from "@/components/invoice-list";
import { getInvoices } from "@/lib/job-data";

const TITLES: Record<string, string> = {
  paid: "Paid invoices",
  unpaid: "Unpaid invoices",
  overdue: "Overdue invoices",
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
 * dashboard to "unpaid" lands where it says it will.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status = "all" } = await searchParams;
  const { invoices } = await getInvoices();

  return (
    <FieldPageShell
      title={TITLES[status] ?? "Invoices"}
      eyebrow="Revenue and collections"
      description="Tap an invoice to open its related job and customer context."
    >
      <InvoiceList invoices={invoices} initialStatus={status} />
    </FieldPageShell>
  );
}
