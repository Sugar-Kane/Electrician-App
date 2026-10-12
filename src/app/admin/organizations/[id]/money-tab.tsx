import Link from "next/link";

import { AdminTime } from "@/components/admin-time";
import { Card, Empty, Pill, type Tone } from "@/components/admin-ui";
import { listOrgInvoices, listOrgPayments, type OrganizationDetail } from "@/lib/admin-console";
import { INVOICE_STATE_LABELS, invoiceState, type InvoiceState } from "@/lib/dashboard-metrics";
import { formatCents } from "@/lib/job-lines";

const STATE_TONE: Record<InvoiceState, Tone> = {
  draft: "waiting",
  awaiting: "waiting",
  part_paid: "waiting",
  overdue: "problem",
  paid: "good",
  void: "neutral",
};

/**
 * The business's invoices and the payments it has received.
 *
 * These are the business's money from its customers. Volteira's own platform
 * billing is a separate thing and is not shown here.
 */
export async function MoneyTab({ organization }: { organization: OrganizationDetail }) {
  const [invoices, payments] = await Promise.all([listOrgInvoices(organization.id), listOrgPayments(organization.id)]);
  const zone = organization.timeZone;
  const base = `/admin/organizations/${organization.id}`;
  const now = new Date();

  return (
    <>
      <Card title="Invoices" aside={`${invoices.length} shown`}>
        {invoices.length === 0 ? (
          <Empty>No invoices.</Empty>
        ) : (
          <ul className="space-y-2">
            {invoices.map((invoice) => {
              const state = invoiceState(
                {
                  status: invoice.status,
                  dueAt: invoice.dueAt || null,
                  balanceDueCents: invoice.balanceDueCents,
                  lastSentAt: invoice.lastSentAt || null,
                },
                now,
              );
              return (
                <li key={invoice.id} className="rounded-control border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">
                      Invoice #{invoice.number}
                      {invoice.jobNumber ? (
                        <>
                          {" · "}
                          <Link href={`${base}/jobs/${invoice.jobNumber}`} className="text-brand">
                            Job #{invoice.jobNumber}
                          </Link>
                        </>
                      ) : null}
                    </p>
                    <Pill tone={STATE_TONE[state]}>{INVOICE_STATE_LABELS[state]}</Pill>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    {formatCents(invoice.totalCents)} total · {formatCents(invoice.balanceDueCents)} left to pay
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">
                    Made <AdminTime iso={invoice.createdAt} timeZone={zone} dateOnly />
                    {invoice.lastSentAt ? (
                      <>
                        {" · sent "}
                        <AdminTime iso={invoice.lastSentAt} timeZone={zone} />
                      </>
                    ) : " · never sent"}
                    {invoice.dueAt ? (
                      <>
                        {" · due "}
                        <AdminTime iso={invoice.dueAt} timeZone={zone} dateOnly />
                      </>
                    ) : null}
                    {invoice.paidAt ? (
                      <>
                        {" · paid "}
                        <AdminTime iso={invoice.paidAt} timeZone={zone} />
                      </>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Payments received" aside={`${payments.length} shown`}>
        {payments.length === 0 ? (
          <Empty>No payments recorded.</Empty>
        ) : (
          <ul className="space-y-2">
            {payments.map((payment) => (
              <li key={payment.id} className="rounded-control border border-line p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {formatCents(payment.amountCents)}
                    {payment.forBooking ? <span className="font-normal text-ink-muted"> · paid when booking</span> : null}
                  </p>
                  <Pill tone={payment.status === "succeeded" ? "good" : payment.status === "failed" ? "problem" : "waiting"}>
                    {payment.status || "unknown"}
                  </Pill>
                </div>
                <p className="mt-1 text-xs text-ink-faint">
                  <AdminTime iso={payment.paidAt || payment.createdAt} timeZone={zone} />
                  {` · ${payment.provider || "provider unknown"}`}
                  {payment.providerRef ? ` ${payment.providerRef}` : ""}
                  {payment.jobNumber ? (
                    <>
                      {" · "}
                      <Link href={`${base}/jobs/${payment.jobNumber}`} className="font-semibold text-brand">
                        Job #{payment.jobNumber}
                      </Link>
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-ink-faint">
          Payment state here comes from Stripe&rsquo;s own events, never from a customer&rsquo;s browser landing on a
          success page.
        </p>
      </Card>
    </>
  );
}
