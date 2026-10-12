/**
 * One job, traced for support: what happened, where each part stands, and
 * what looks wrong.
 *
 * Read from `admin_job_trace`, which returns the job and everything attached to
 * it in one piece. The readings reuse the app's own rules — where a job stands
 * (job-stage), whether a visit is late (follow-ups), an invoice's state
 * (dashboard-metrics), what changed since signing (job-billing) — so support
 * and the electrician see the same job the same way.
 *
 * Nothing here changes anything. A problem is a sentence pointing at a section,
 * never a button that "fixes" it.
 *
 * Import-free apart from those rules, so it can be tested without a database.
 */

import type { ActivityRow } from "./activity-timeline.ts";
import { INVOICE_STATE_LABELS, invoiceState, type InvoiceState } from "./dashboard-metrics.ts";
import { lateness } from "./follow-ups.ts";
import { agreementChanges, type ContractStanding } from "./job-billing.ts";
import { formatCents, lineTotalCents } from "./job-lines.ts";
import { JOB_STAGE_LABELS, jobStage, jobStatusLabel } from "./job-stage.ts";
import { kindOfWork } from "./new-job-input.ts";

export type SendAttempt = { channel: string; to: string; ok: boolean; detail: string; at: string };

export type TraceContract = {
  id: string;
  kind: "agreement" | "change_order";
  status: string;
  createdAt: string;
  sentAt: string;
  signedAt: string;
  signer: string;
  method: string;
  contractorSignedAt: string;
  bodyFixed: boolean;
  totalCents: number | null;
  depositCents: number | null;
  depositPaid: boolean | null;
};

export type TraceLine = {
  id: string;
  kind: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  unitCostCents: number | null;
  invoiceId: string | null;
  fromStock: boolean;
  createdAt: string;
  /** Out of the van because of this line, net of anything returned. */
  stockTaken: number;
};

export type TraceInvoice = {
  id: string;
  number: string;
  status: string;
  subtotalCents: number;
  creditCents: number;
  taxCents: number;
  totalCents: number;
  balanceDueCents: number;
  dueAt: string;
  paidAt: string;
  lastSentAt: string;
  createdAt: string;
  deliveries: SendAttempt[];
};

export type TracePayment = {
  id: string;
  provider: string;
  status: string;
  amountCents: number;
  paidAt: string;
  createdAt: string;
  forBooking: boolean;
  providerRef: string;
};

export type TraceMessage = {
  id: string;
  createdAt: string;
  direction: string;
  status: string;
  errorCode: string;
  sentAt: string;
  deliveredAt: string;
  body: string;
  /** Whether Twilio accepted it and gave it an id. */
  hasProviderRef: boolean;
};

export type JobTrace = {
  job: {
    id: string;
    number: string;
    status: string;
    category: string;
    description: string;
    scheduledStart: string;
    scheduledEnd: string;
    createdAt: string;
    canceledAt: string;
    cancellationReason: string;
    diagnosticFeeCents: number;
    diagnosticPaid: boolean;
    technician: string;
    followUpOf: string;
    notices: SendAttempt[];
  };
  customer: { id: string; name: string; phone: string; email: string } | null;
  address: string;
  bookings: {
    id: string;
    createdAt: string;
    status: string;
    source: string;
    depositCents: number;
    depositPaidAt: string;
    notices: SendAttempt[];
  }[];
  contracts: TraceContract[];
  lines: TraceLine[];
  invoices: TraceInvoice[];
  payments: TracePayment[];
  messages: TraceMessage[];
  activity: ActivityRow[];
};

type Raw = Record<string, unknown>;

const str = (value: unknown): string =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined || value === "" ? null : num(value);
const list = (value: unknown): Raw[] => (Array.isArray(value) ? (value as Raw[]) : []);
const obj = (value: unknown): Raw | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : null;

function attempts(value: unknown): SendAttempt[] {
  return list(value).map((entry) => ({
    channel: str(entry.channel),
    to: str(entry.to),
    ok: entry.ok === true,
    detail: str(entry.detail ?? entry.error),
    at: str(entry.at ?? entry.sent_at),
  }));
}

export function parseTrace(raw: unknown): JobTrace | null {
  const root = obj(raw);
  const job = obj(root?.job);
  if (!root || !job) return null;
  const customer = obj(root.customer);

  return {
    job: {
      id: str(job.id),
      number: str(job.job_number),
      status: str(job.status),
      category: str(job.category),
      description: str(job.description),
      scheduledStart: str(job.scheduled_start),
      scheduledEnd: str(job.scheduled_end),
      createdAt: str(job.created_at),
      canceledAt: str(job.canceled_at),
      cancellationReason: str(job.cancellation_reason),
      diagnosticFeeCents: num(job.diagnostic_fee_cents),
      diagnosticPaid: job.diagnostic_paid === true,
      technician: str(job.technician),
      followUpOf: str(job.follow_up_of),
      notices: attempts(job.customer_notifications),
    },
    customer: customer
      ? { id: str(customer.id), name: str(customer.name), phone: str(customer.phone), email: str(customer.email) }
      : null,
    address: str(root.address),
    bookings: list(root.bookings).map((row) => ({
      id: str(row.id),
      createdAt: str(row.created_at),
      status: str(row.status),
      source: str(row.source),
      depositCents: num(row.deposit_cents),
      depositPaidAt: str(row.deposit_paid_at),
      notices: attempts(row.notification_results),
    })),
    contracts: list(root.contracts).map((row) => ({
      id: str(row.id),
      kind: row.kind === "change_order" ? "change_order" : "agreement",
      status: str(row.status),
      createdAt: str(row.created_at),
      sentAt: str(row.sent_at),
      signedAt: str(row.signed_at),
      signer: str(row.signer),
      method: str(row.method),
      contractorSignedAt: str(row.contractor_signed_at),
      bodyFixed: row.body_fixed === true,
      totalCents: numOrNull(row.total_cents),
      depositCents: numOrNull(row.deposit_cents),
      depositPaid: typeof row.deposit_paid === "boolean" ? row.deposit_paid : null,
    })),
    lines: list(root.lines).map((row) => ({
      id: str(row.id),
      kind: str(row.kind),
      description: str(row.description),
      quantity: num(row.quantity),
      unit: str(row.unit),
      unitPriceCents: num(row.unit_price_cents),
      unitCostCents: numOrNull(row.unit_cost_cents),
      invoiceId: str(row.invoice_id) || null,
      fromStock: row.from_stock === true,
      createdAt: str(row.created_at),
      stockTaken: Math.max(0, -num(row.stock_moved)),
    })),
    invoices: list(root.invoices).map((row) => ({
      id: str(row.id),
      number: str(row.invoice_number),
      status: str(row.status),
      subtotalCents: num(row.subtotal_cents),
      creditCents: num(row.diagnostic_credit_cents),
      taxCents: num(row.tax_cents),
      totalCents: num(row.total_cents),
      balanceDueCents: num(row.balance_due_cents),
      dueAt: str(row.due_at),
      paidAt: str(row.paid_at),
      lastSentAt: str(row.last_sent_at),
      createdAt: str(row.created_at),
      deliveries: attempts(row.deliveries),
    })),
    payments: list(root.payments).map((row) => ({
      id: str(row.id),
      provider: str(row.provider),
      status: str(row.status),
      amountCents: num(row.amount_cents),
      paidAt: str(row.paid_at),
      createdAt: str(row.created_at),
      forBooking: row.for_booking === true,
      providerRef: str(row.provider_ref),
    })),
    messages: list(root.messages).map((row) => ({
      id: str(row.id),
      createdAt: str(row.created_at),
      direction: str(row.direction),
      status: str(row.status),
      errorCode: str(row.error_code),
      sentAt: str(row.sent_at),
      deliveredAt: str(row.delivered_at),
      body: str(row.body),
      hasProviderRef: row.has_provider_ref === true,
    })),
    activity: list(root.activity).map((row) => ({
      id: str(row.id),
      eventType: str(row.event_type),
      label: str(row.label),
      createdAt: str(row.created_at),
      metadata: obj(row.metadata),
    })),
  };
}

const RECEIVED = new Set(["succeeded", "paid"]);

const liveInvoices = (trace: JobTrace) => trace.invoices.filter((invoice) => invoice.status !== "void");

/** The newest agreement that was not voided: what approval means for the job. */
function currentAgreement(trace: JobTrace): TraceContract | null {
  return (
    [...trace.contracts]
      .filter((contract) => contract.kind === "agreement" && contract.status !== "void")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

function stateOf(invoice: TraceInvoice, now: Date): InvoiceState {
  return invoiceState(
    {
      status: invoice.status,
      dueAt: invoice.dueAt || null,
      balanceDueCents: invoice.balanceDueCents,
      lastSentAt: invoice.lastSentAt || null,
    },
    now,
  );
}

export type TraceTone = "good" | "waiting" | "problem" | "neutral";
export type TraceState = { label: string; value: string; tone: TraceTone };

/**
 * Where each part of the job stands, separately.
 *
 * One "status" for a job hides the case support is usually looking for: work
 * done, invoice sent, nothing paid. So job, approval, schedule, invoice and
 * payment each get their own answer.
 */
export function traceStates(trace: JobTrace, now: Date = new Date()): TraceState[] {
  const kind = kindOfWork(trace.job.category);
  const agreement = currentAgreement(trace);
  const signed = Boolean(agreement && (agreement.status === "signed" || agreement.signedAt));
  const sent = Boolean(agreement && (agreement.status === "sent" || agreement.sentAt));
  const status = jobStatusLabel(trace.job.status);
  const stage = jobStage({
    status,
    scheduled: Boolean(trace.job.scheduledStart),
    kindOfWork: kind,
    agreement: agreement ? { sent, signed } : null,
  });

  const late = lateness({ stage: trace.job.status, startsAt: trace.job.scheduledStart, endsAt: trace.job.scheduledEnd }, now);
  const live = liveInvoices(trace);
  const latest = [...live].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const received = trace.payments
    .filter((payment) => RECEIVED.has(payment.status))
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  const allPaid = live.length > 0 && live.every((invoice) => stateOf(invoice, now) === "paid");

  const approval: TraceState = signed
    ? { label: "Approval", value: `Signed${agreement?.signer ? ` by ${agreement.signer}` : ""}`, tone: "good" }
    : sent
      ? { label: "Approval", value: "Sent, not signed", tone: "waiting" }
      : agreement
        ? { label: "Approval", value: "Drawn up, not sent", tone: "waiting" }
        : { label: "Approval", value: kind === "Diagnostic" ? "Not needed for a diagnostic" : "No agreement", tone: "neutral" };

  const schedule: TraceState = !trace.job.scheduledStart
    ? { label: "Schedule", value: "Not scheduled", tone: stage === "to_schedule" ? "waiting" : "neutral" }
    : late
      ? { label: "Schedule", value: late === "not_started" ? "Time passed, not started" : "Time passed, not finished", tone: "problem" }
      : { label: "Schedule", value: status === "Completed" ? "Visit done" : "Scheduled", tone: "neutral" };

  const invoice: TraceState = latest
    ? {
        label: "Invoice",
        value: `#${latest.number} · ${INVOICE_STATE_LABELS[stateOf(latest, now)]}`,
        tone: ((): TraceTone => {
          const state = stateOf(latest, now);
          if (state === "paid") return "good";
          if (state === "overdue") return "problem";
          return "waiting";
        })(),
      }
    : { label: "Invoice", value: "None", tone: status === "Completed" ? "problem" : "neutral" };

  const payment: TraceState = allPaid
    ? { label: "Payment", value: "Paid in full", tone: "good" }
    : received > 0
      ? { label: "Payment", value: `${formatCents(received)} received`, tone: "waiting" }
      : { label: "Payment", value: "Nothing received", tone: live.length > 0 ? "waiting" : "neutral" };

  return [
    { label: "Job", value: `${JOB_STAGE_LABELS[stage]} · ${kind}`, tone: "neutral" },
    approval,
    schedule,
    invoice,
    payment,
  ];
}

export type TraceProblem = {
  title: string;
  detail: string;
  /** The section of the trace it is about, as a page anchor. */
  section: "schedule" | "approval" | "lines" | "invoices" | "payments";
};

const DAY_MS = 86_400_000;
const APPROVAL_WAIT_DAYS = 3;

/**
 * What looks wrong, read-only.
 *
 * Each is a fact with the figures that show it, not a verdict: a mismatch can
 * have a reason the data does not hold. Ordered as the job happens.
 */
export function traceProblems(trace: JobTrace, now: Date = new Date()): TraceProblem[] {
  const problems: TraceProblem[] = [];
  const status = jobStatusLabel(trace.job.status);
  const live = liveInvoices(trace);

  const late = lateness({ stage: trace.job.status, startsAt: trace.job.scheduledStart, endsAt: trace.job.scheduledEnd }, now);
  if (late) {
    problems.push({
      title: "Time passed with no outcome",
      detail:
        late === "not_started"
          ? "The visit's time has gone by and the job was never started, rescheduled or completed. Nothing completes it automatically."
          : "The visit ran past its end and the job is still open. Nothing completes it automatically.",
      section: "schedule",
    });
  }

  const agreement = currentAgreement(trace);
  if (agreement && agreement.sentAt && !agreement.signedAt && agreement.status !== "signed") {
    const days = Math.floor((now.getTime() - Date.parse(agreement.sentAt)) / DAY_MS);
    if (days >= APPROVAL_WAIT_DAYS) {
      problems.push({
        title: "Approval waiting",
        detail: `The agreement was sent ${days} days ago and hasn't been signed.`,
        section: "approval",
      });
    }
  }

  const standing: ContractStanding[] = trace.contracts.map((contract) => ({
    id: contract.id,
    kind: contract.kind,
    status: contract.status,
    createdAt: contract.createdAt,
    signedAt: contract.signedAt || null,
  }));
  const changes = agreementChanges(trace.lines, standing);
  if (changes.added.length > 0) {
    const count = changes.added.length;
    problems.push(
      changes.waiting
        ? {
            title: "Change order waiting for signature",
            detail: `${count} line${count === 1 ? "" : "s"} (${formatCents(changes.addedCents)}) added after the customer signed are in a change order they haven't signed yet.`,
            section: "approval",
          }
        : {
            title: "Work added after the customer signed",
            detail: `${count} line${count === 1 ? "" : "s"} (${formatCents(changes.addedCents)}) were added after the signed agreement and aren't in a signed change order.`,
            section: "lines",
          },
    );
  }

  if (status === "Completed" && live.length === 0) {
    problems.push({
      title: "Completed, never invoiced",
      detail: "The job is completed and has no invoice.",
      section: "invoices",
    });
  }

  for (const invoice of live) {
    const claimed = trace.lines.filter((line) => line.invoiceId === invoice.id);
    if (claimed.length > 0) {
      const linesCents = claimed.reduce((sum, line) => sum + lineTotalCents(line), 0);
      if (linesCents !== invoice.subtotalCents) {
        problems.push({
          title: `Invoice #${invoice.number} doesn't match its lines`,
          detail: `Its lines add to ${formatCents(linesCents)}; the invoice says ${formatCents(invoice.subtotalCents)} before credit and tax.`,
          section: "invoices",
        });
      }
    }
    const expected = Math.max(0, invoice.subtotalCents - invoice.creditCents + invoice.taxCents);
    if (expected !== invoice.totalCents) {
      problems.push({
        title: `Invoice #${invoice.number}'s total doesn't add up`,
        detail: `${formatCents(invoice.subtotalCents)} less ${formatCents(invoice.creditCents)} credit plus ${formatCents(invoice.taxCents)} tax is ${formatCents(expected)}; the invoice says ${formatCents(invoice.totalCents)}.`,
        section: "invoices",
      });
    }
  }

  // A deposit paid at booking is expected before any invoice exists; it is
  // credited on the first one. Any other payment should have an invoice.
  const unexplained = trace.payments.filter((payment) => RECEIVED.has(payment.status) && !payment.forBooking);
  if (unexplained.length > 0 && live.length === 0) {
    const total = unexplained.reduce((sum, payment) => sum + payment.amountCents, 0);
    problems.push({
      title: "Payment with no invoice",
      detail: `${formatCents(total)} was received for this job and no invoice records it.`,
      section: "payments",
    });
  }

  return problems;
}
