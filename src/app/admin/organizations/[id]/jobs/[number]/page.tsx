import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, TriangleAlert } from "lucide-react";

import { AdminTime } from "@/components/admin-time";
import { Card, Empty, Pill, RevealBar, type Tone } from "@/components/admin-ui";
import { buildTimeline } from "@/lib/activity-timeline";
import { getJobTrace, getOrganizationDetail, recordOrganizationTab, requirePlatformAdmin, revealIsValid } from "@/lib/admin-console";
import { maskBody, maskContacts, maskEmail, maskPhone } from "@/lib/admin-mask";
import { traceProblems, traceStates, type SendAttempt } from "@/lib/admin-trace";
import { todayInZone } from "@/lib/calendar";
import { INVOICE_STATE_LABELS, invoiceState } from "@/lib/dashboard-metrics";
import { formatCents, formatQuantity, lineTotalCents } from "@/lib/job-lines";
import { deliveryState } from "@/lib/message-errors";
import { kindOfWork } from "@/lib/new-job-input";
import { openCaseHref } from "@/lib/support-cases";

export const metadata: Metadata = {
  title: "Job trace | Volteira support",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Attempts({ attempts, zone, revealed }: { attempts: SendAttempt[]; zone: string; revealed: boolean }) {
  if (attempts.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {attempts.map((attempt, index) => (
        <li
          key={index}
          className={`rounded-chip px-3 py-1.5 text-xs ${attempt.ok ? "bg-positive-bg text-positive" : "bg-critical-bg text-critical"}`}
        >
          <span className="font-semibold">{attempt.channel || "message"}</span>
          {attempt.to ? ` → ${revealed ? attempt.to : maskContacts(attempt.to)}` : ""} · {attempt.ok ? "sent" : "failed"}
          {attempt.detail ? ` — ${revealed ? attempt.detail : maskContacts(attempt.detail)}` : ""}
          {attempt.at ? (
            <>
              {" · "}
              <AdminTime iso={attempt.at} timeZone={zone} />
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * One job, from the request that created it to the last payment, read-only.
 *
 * Each part says where it stands separately, and anything that looks wrong is
 * listed first with the figures that show it. Nothing here changes the job.
 */
export default async function AdminJobTracePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; number: string }>;
  searchParams: Promise<{ reveal?: string }>;
}) {
  await requirePlatformAdmin();
  const [{ id, number }, query] = await Promise.all([params, searchParams]);
  const jobNumber = Number(number);
  if (!UUID.test(id) || !Number.isSafeInteger(jobNumber) || jobNumber <= 0) notFound();

  const [organization, trace] = await Promise.all([getOrganizationDetail(id), getJobTrace(id, jobNumber)]);
  if (!organization || !trace) notFound();

  const [, revealed] = await Promise.all([
    recordOrganizationTab(id, `Job #${jobNumber}`),
    UUID.test(query.reveal ?? "") ? revealIsValid(query.reveal!, id) : Promise.resolve(false),
  ]);

  const zone = organization.timeZone;
  const now = new Date();
  const base = `/admin/organizations/${id}`;
  const here = `${base}/jobs/${jobNumber}`;
  const states = traceStates(trace, now);
  const problems = traceProblems(trace, now);
  const history = buildTimeline(trace.activity, zone, todayInZone(zone));
  const linesCents = trace.lines.reduce((sum, line) => sum + lineTotalCents(line), 0);
  const invoiceNumber = new Map(trace.invoices.map((invoice) => [invoice.id, invoice.number]));

  return (
    <div className="space-y-4">
      <header className="sticky top-0 z-20 -mx-3 border-b border-line bg-canvas/95 px-3 pb-3 pt-3 backdrop-blur sm:-mx-5 sm:px-5 lg:-mx-8 lg:px-8">
        <Link href={`${base}?tab=jobs`} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {organization.name} · Jobs
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="min-w-0 text-xl font-semibold tracking-tight sm:text-2xl">
            Job #{trace.job.number} · {trace.customer?.name ?? "No customer"}
          </h1>
          <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-semibold text-ink-muted">Read-only</span>
        </div>
        <p className="mt-0.5 text-xs text-ink-faint">
          {kindOfWork(trace.job.category)} · made <AdminTime iso={trace.job.createdAt} timeZone={zone} />
          {trace.job.followUpOf ? (
            <>
              {" · follows "}
              <Link href={`${base}/jobs/${trace.job.followUpOf}`} className="font-semibold text-brand">
                Job #{trace.job.followUpOf}
              </Link>
            </>
          ) : null}
          {" · "}
          <Link
            href={openCaseHref({ organizationId: id, type: "job", id: trace.job.id, label: `Job #${trace.job.number}` })}
            className="font-semibold text-ink-muted underline underline-offset-2"
          >
            Open a case
          </Link>
        </p>
      </header>

      <RevealBar organizationId={id} scope={`Job #${jobNumber}`} returnTo={here} revealed={revealed} hideHref={here} />

      <section aria-label="Where it stands" className="grid gap-2 sm:grid-cols-5">
        {states.map((state) => (
          <div key={state.label} className="rounded-control border border-line bg-surface p-3">
            <p className="text-xs text-ink-faint">{state.label}</p>
            <div className="mt-1">
              <Pill tone={state.tone as Tone}>{state.value}</Pill>
            </div>
          </div>
        ))}
      </section>

      {problems.length > 0 ? (
        <Card title="What looks wrong">
          <ul className="space-y-2">
            {problems.map((problem) => (
              <li key={problem.title} className="flex items-start gap-3 rounded-control border border-caution/25 bg-caution-bg p-4 text-caution">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0">
                  <a href={`#${problem.section}`} className="block text-sm font-semibold underline-offset-2 hover:underline">
                    {problem.title}
                  </a>
                  <span className="mt-1 block text-sm leading-6 opacity-90">{problem.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-faint">Facts from the records, not verdicts: a mismatch can have a reason the data doesn&rsquo;t hold.</p>
        </Card>
      ) : null}

      <Card title="Customer">
        <p className="text-sm font-semibold">{trace.customer?.name ?? "No customer"}</p>
        <p className="mt-1 text-sm text-ink-muted">
          {revealed ? trace.customer?.phone || "No phone" : maskPhone(trace.customer?.phone) || "No phone"}
          {trace.customer?.email ? ` · ${revealed ? trace.customer.email : maskEmail(trace.customer.email)}` : ""}
        </p>
        <p className="mt-1 text-sm text-ink-muted">{trace.address ? (revealed ? trace.address : "Address hidden") : "No address"}</p>
        {trace.job.description ? (
          <p className="mt-2 text-sm text-ink-muted">{revealed ? trace.job.description : maskContacts(trace.job.description)}</p>
        ) : null}
        {trace.customer ? (
          <Link href={`${base}?tab=jobs&customer=${trace.customer.id}`} className="mt-2 inline-block text-xs font-semibold text-brand">
            Their other jobs
          </Link>
        ) : null}
      </Card>

      <Card title="Request" id="request">
        {trace.bookings.length === 0 ? (
          <Empty>Typed in by the business. No booking request created this job.</Empty>
        ) : (
          <ul className="space-y-2">
            {trace.bookings.map((booking) => (
              <li key={booking.id} className="rounded-control border border-line p-3">
                <p className="text-sm font-semibold">
                  Booking {booking.source ? `by ${booking.source.replace(/_/g, " ")}` : ""} · {booking.status}
                </p>
                <p className="mt-1 text-xs text-ink-faint">
                  <AdminTime iso={booking.createdAt} timeZone={zone} />
                  {booking.depositCents > 0
                    ? ` · ${formatCents(booking.depositCents)} fee ${booking.depositPaidAt ? "paid" : "not paid"}`
                    : ""}
                </p>
                <Attempts attempts={booking.notices} zone={zone} revealed={revealed} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Approval" id="approval">
        {trace.contracts.length === 0 ? (
          <Empty>No agreement or change order.</Empty>
        ) : (
          <ul className="space-y-2">
            {trace.contracts.map((contract) => (
              <li key={contract.id} className="rounded-control border border-line p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">{contract.kind === "change_order" ? "Change order" : "Agreement"}</p>
                  <Pill tone={contract.signedAt ? "good" : contract.status === "void" ? "neutral" : contract.sentAt ? "waiting" : "neutral"}>
                    {contract.signedAt ? "Signed" : contract.status === "void" ? "Void" : contract.sentAt ? "Sent, not signed" : "Not sent"}
                  </Pill>
                </div>
                <p className="mt-1 text-xs text-ink-faint">
                  Drawn up <AdminTime iso={contract.createdAt} timeZone={zone} />
                  {contract.sentAt ? (
                    <>
                      {" · sent "}
                      <AdminTime iso={contract.sentAt} timeZone={zone} />
                    </>
                  ) : null}
                  {contract.signedAt ? (
                    <>
                      {" · signed "}
                      <AdminTime iso={contract.signedAt} timeZone={zone} />
                      {contract.signer ? ` by ${contract.signer}` : ""}
                      {contract.method ? ` (${contract.method})` : ""}
                    </>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-ink-faint">
                  {contract.totalCents !== null ? `Total ${formatCents(contract.totalCents)}` : "No saved total (older contract)"}
                  {contract.depositCents ? ` · fee ${formatCents(contract.depositCents)}${contract.depositPaid ? " paid" : " due"}` : ""}
                  {contract.contractorSignedAt ? " · signed for the business" : ""}
                  {contract.bodyFixed ? " · wording fixed at signing" : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Schedule" id="schedule">
        <dl className="text-sm">
          <div className="flex flex-wrap justify-between gap-2 py-1">
            <dt className="text-ink-muted">Visit</dt>
            <dd>
              {trace.job.scheduledStart ? <AdminTime iso={trace.job.scheduledStart} timeZone={zone} /> : "Not scheduled"}
              {trace.job.scheduledEnd ? (
                <>
                  {" – "}
                  <AdminTime iso={trace.job.scheduledEnd} timeZone={zone} />
                </>
              ) : null}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2 py-1">
            <dt className="text-ink-muted">Electrician</dt>
            <dd>{trace.job.technician || "Unassigned"}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2 py-1">
            <dt className="text-ink-muted">Stored status</dt>
            <dd>{trace.job.status.replace(/_/g, " ")}</dd>
          </div>
          {trace.job.canceledAt ? (
            <div className="flex flex-wrap justify-between gap-2 py-1">
              <dt className="text-ink-muted">Cancelled</dt>
              <dd>
                <AdminTime iso={trace.job.canceledAt} timeZone={zone} />
                {trace.job.cancellationReason ? ` · ${trace.job.cancellationReason}` : ""}
              </dd>
            </div>
          ) : null}
        </dl>
        {trace.job.notices.length > 0 ? (
          <>
            <p className="mt-3 text-xs font-semibold text-ink-muted">Customer told about changes</p>
            <Attempts attempts={trace.job.notices} zone={zone} revealed={revealed} />
          </>
        ) : null}
      </Card>

      <Card title="Work and materials" id="lines" aside={trace.lines.length > 0 ? `${formatCents(linesCents)} in all` : undefined}>
        {trace.lines.length === 0 ? (
          <Empty>No lines priced yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {trace.lines.map((line) => (
              <li key={line.id} className="rounded-control border border-line p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 font-semibold">{line.description || (line.kind === "labor" ? "Labor" : "Part")}</p>
                  <p className="whitespace-nowrap font-semibold">{formatCents(lineTotalCents(line))}</p>
                </div>
                <p className="mt-1 text-xs text-ink-faint">
                  {formatQuantity(line.quantity)} {line.unit || "each"} × {formatCents(line.unitPriceCents)}
                  {line.unitCostCents !== null ? ` · cost ${formatCents(line.unitCostCents)} each` : ""}
                  {line.fromStock ? ` · from stock, ${line.stockTaken > 0 ? `${formatQuantity(line.stockTaken)} used` : "reserved, not used yet"}` : ""}
                  {line.invoiceId ? ` · on invoice #${invoiceNumber.get(line.invoiceId) ?? "?"}` : " · not invoiced"}
                  {" · added "}
                  <AdminTime iso={line.createdAt} timeZone={zone} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Invoices" id="invoices">
        {trace.invoices.length === 0 ? (
          <Empty>No invoice.</Empty>
        ) : (
          <ul className="space-y-2">
            {trace.invoices.map((invoice) => {
              const state = invoiceState(
                { status: invoice.status, dueAt: invoice.dueAt || null, balanceDueCents: invoice.balanceDueCents, lastSentAt: invoice.lastSentAt || null },
                now,
              );
              return (
                <li key={invoice.id} className="rounded-control border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">Invoice #{invoice.number}</p>
                    <Pill tone={state === "paid" ? "good" : state === "overdue" ? "problem" : state === "void" ? "neutral" : "waiting"}>
                      {INVOICE_STATE_LABELS[state]}
                    </Pill>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    {formatCents(invoice.subtotalCents)}
                    {invoice.creditCents ? ` − ${formatCents(invoice.creditCents)} diagnostic fee already paid` : ""}
                    {invoice.taxCents ? ` + ${formatCents(invoice.taxCents)} tax` : ""} = {formatCents(invoice.totalCents)} ·{" "}
                    {formatCents(invoice.balanceDueCents)} left to pay
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">
                    Made <AdminTime iso={invoice.createdAt} timeZone={zone} />
                    {invoice.lastSentAt ? (
                      <>
                        {" · sent "}
                        <AdminTime iso={invoice.lastSentAt} timeZone={zone} />
                      </>
                    ) : " · never sent"}
                    {invoice.paidAt ? (
                      <>
                        {" · paid "}
                        <AdminTime iso={invoice.paidAt} timeZone={zone} />
                      </>
                    ) : null}
                  </p>
                  <Attempts attempts={invoice.deliveries} zone={zone} revealed={revealed} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Payments" id="payments">
        {trace.payments.length === 0 ? (
          <Empty>No payment recorded.</Empty>
        ) : (
          <ul className="space-y-2">
            {trace.payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-control border border-line p-3 text-sm">
                <span>
                  <span className="font-semibold">{formatCents(payment.amountCents)}</span>
                  <span className="text-ink-muted">
                    {payment.forBooking ? " · paid when booking" : ""} · {payment.provider || "provider unknown"} {payment.providerRef}
                  </span>
                  <span className="block text-xs text-ink-faint">
                    <AdminTime iso={payment.paidAt || payment.createdAt} timeZone={zone} />
                  </span>
                </span>
                <Pill tone={payment.status === "succeeded" ? "good" : payment.status === "failed" ? "problem" : "waiting"}>
                  {payment.status || "unknown"}
                </Pill>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Texts with this customer" id="texts" aside={trace.messages.length ? `${trace.messages.length} shown` : undefined}>
        {trace.messages.length === 0 ? (
          <Empty>No texts.</Empty>
        ) : (
          <ul className="space-y-2">
            {[...trace.messages].reverse().map((message) => {
              const state = deliveryState(message);
              return (
                <li key={message.id} className="rounded-control border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-xs text-ink-faint">
                      {message.direction === "outbound" ? "Sent" : "Received"} <AdminTime iso={message.createdAt} timeZone={zone} />
                    </p>
                    <Pill tone={state.tone}>{state.label}</Pill>
                  </div>
                  <p className={`mt-1 text-sm ${revealed ? "whitespace-pre-wrap break-words" : "text-ink-faint"}`}>
                    {revealed ? message.body || "Empty" : maskBody(message.body)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="History" id="history">
        {history.length === 0 ? (
          <Empty>Nothing recorded on this job.</Empty>
        ) : (
          <div className="space-y-4">
            {history.map((day) => (
              <section key={day.date}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{day.label}</h3>
                <ul className="mt-2 space-y-1.5">
                  {day.entries.map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className={entry.failed ? "text-critical" : ""}>
                        {entry.failed ? "Failed · " : ""}
                        {entry.title}
                        {entry.detail ? (
                          <span className="text-ink-muted"> · {revealed ? entry.detail : maskContacts(entry.detail)}</span>
                        ) : null}
                      </span>
                      <span className="text-xs text-ink-faint">
                        <AdminTime iso={entry.at} timeZone={zone} />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
