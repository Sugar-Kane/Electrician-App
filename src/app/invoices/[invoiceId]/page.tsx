import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, FileWarning } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { InvoiceDocumentPanel } from "@/components/invoice-document-panel";
import { currentDocument } from "@/lib/pdf/store";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * One invoice, as the customer will see it.
 *
 * The point of this page is that there is nothing to imagine. Raising an
 * invoice used to produce a row and a subtotal, and whether the thing that
 * reached the customer looked right was something an electrician found out from
 * the customer. Here is the actual file, before it goes anywhere.
 */

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function money(cents: unknown): string {
  const value = Number(cents ?? 0) / 100;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const context = await currentContext();

  if (!context) {
    return (
      <FieldPageShell title="Invoice" eyebrow="Invoices" backHref="/invoices">
        <section className="rounded-panel border border-line bg-surface p-6 text-center">
          <h2 className="font-semibold">Sign in to open this invoice</h2>
          <p className="mt-2 text-sm leading-6 text-ink-muted">
            Invoices belong to a business, so there is nothing to show in the demo workspace.
          </p>
        </section>
      </FieldPageShell>
    );
  }

  const database = asFlexibleClient(await createClient());

  const { data } = await database
    .from("invoices")
    .select(
      `id, invoice_number, status, total_cents, balance_due_cents, due_at,
       jobs ( job_number, customers ( first_name, last_name, company_name ) )`,
    )
    .eq("organization_id", context.organizationId)
    .eq("id", invoiceId)
    .maybeSingle();

  if (!data) notFound();

  const invoice = data as Record<string, unknown>;
  const job = (invoice.jobs ?? null) as Record<string, unknown> | null;
  const customer = (job?.customers ?? null) as Record<string, unknown> | null;

  const customerName =
    str(customer?.company_name) ||
    [str(customer?.first_name), str(customer?.last_name)].filter(Boolean).join(" ") ||
    "Customer";

  const document = await currentDocument({
    database,
    organizationId: context.organizationId,
    invoiceId,
    timeZone: context.timeZone,
  });

  const jobNumber = String(job?.job_number ?? "");

  return (
    <FieldPageShell
      compact
      title={`Invoice ${String(invoice.invoice_number ?? "")}`}
      eyebrow={customerName}
      backHref="/invoices"
    >
      <section className="rounded-panel border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-2xl font-semibold">{money(invoice.total_cents)}</p>
            <p className="mt-0.5 text-sm text-ink-muted">
              {Number(invoice.balance_due_cents ?? 0) > 0
                ? `${money(invoice.balance_due_cents)} still owed`
                : "Nothing owed"}
            </p>
          </div>
          {jobNumber ? (
            <Link
              href={`/jobs/${jobNumber}`}
              className="tap-target inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand"
            >
              Job #{jobNumber}
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      </section>

      {document ? (
        <InvoiceDocumentPanel
          invoiceId={invoiceId}
          url={document.url}
          fileName={document.fileName}
          versionNumber={document.versionNumber}
          generatedLabel={document.generatedLabel}
          jobNumber={jobNumber}
        />
      ) : (
        // An invoice raised before documents existed, or one whose PDF failed
        // to build. Both are recoverable in one tap rather than being a dead
        // end with a number and no paperwork.
        <section className="mt-3 rounded-panel border border-line bg-surface p-6 text-center">
          <FileWarning className="mx-auto h-6 w-6 text-caution" aria-hidden />
          <h2 className="mt-3 font-semibold">No document yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-muted">
            This invoice has no PDF — either it was raised before documents were generated, or
            building it did not finish.
          </p>
          <div className="mx-auto mt-4 max-w-xs">
            <InvoiceDocumentPanel
              invoiceId={invoiceId}
              url=""
              fileName=""
              versionNumber={0}
              generatedLabel=""
              jobNumber={jobNumber}
            />
          </div>
        </section>
      )}
    </FieldPageShell>
  );
}
