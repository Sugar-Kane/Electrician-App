/**
 * Where a job is, step by step: Estimate · Approval · Materials · Work ·
 * Invoice · Paid.
 *
 * Everything here is read off what the job page already loads — its lines,
 * its agreement, the visit's state and its invoices — so nothing new is
 * stored and a job can join at any step. A diagnostic is priced by its fee and
 * needs no approval; a job with no parts has nothing to gather.
 *
 * Import-free, so the page and anything else can share one reading.
 */

export type ProgressKey = "estimate" | "approval" | "materials" | "work" | "invoice" | "paid";

export type ProgressStep = {
  key: ProgressKey;
  label: string;
  /** done, waiting on somebody (current), still to do, or not needed for this job. */
  state: "done" | "current" | "todo" | "skipped";
  /** One short line saying why it is in that state. */
  note: string;
  /** The section of the job page that step is about. */
  href: string;
};

export type ProgressInput = {
  kindOfWork: string;
  /** "Sat, Oct 31 · 8:00 AM", or empty when the job has no time. */
  scheduledLabel: string;
  /** Where a time is set, for a job that has none. */
  scheduleHref: string;
  workflowState: string;
  /** What the job's lines come to, in cents. */
  pricedCents: number;
  partCount: number;
  agreement: { sent: boolean; signed: boolean } | null;
  invoices: { status: string; lastSentAt: string | null; paidAt: string | null }[];
  /** For the "Priced at" note. */
  formatMoney: (cents: number) => string;
};

const UNDER_WAY = new Set(["en_route", "arrived", "working", "review"]);
const STARTED = new Set(["arrived", "working", "review", "completed"]);

export function jobProgress(input: ProgressInput): { steps: ProgressStep[]; next: ProgressStep | null } {
  const diagnostic = input.kindOfWork === "Diagnostic";
  const live = input.invoices.filter((invoice) => invoice.status !== "void");
  const sent = live.filter((invoice) => invoice.status !== "draft" || Boolean(invoice.lastSentAt));
  const allPaid = live.length > 0 && live.every((invoice) => invoice.status === "paid" || Boolean(invoice.paidAt));

  const estimate: ProgressStep = diagnostic
    ? { key: "estimate", label: "Estimate", state: "done", note: "The diagnostic fee is the price", href: "#work-materials" }
    : input.pricedCents > 0
      ? { key: "estimate", label: "Estimate", state: "done", note: `Priced at ${input.formatMoney(input.pricedCents)}`, href: "#work-materials" }
      : { key: "estimate", label: "Estimate", state: "todo", note: "Add the work and parts to price it", href: "#work-materials" };

  const approval: ProgressStep = input.agreement?.signed
    ? { key: "approval", label: "Approval", state: "done", note: "Signed by the customer", href: "#contract" }
    : input.agreement?.sent
      ? { key: "approval", label: "Approval", state: "current", note: "Waiting for the customer to sign", href: "#contract" }
      : diagnostic
        ? { key: "approval", label: "Approval", state: "skipped", note: "Not needed for a diagnostic", href: "#contract" }
        : { key: "approval", label: "Approval", state: "todo", note: "Send the agreement for approval", href: "#contract" };

  const parts = `${input.partCount} ${input.partCount === 1 ? "part" : "parts"}`;
  const materials: ProgressStep =
    input.partCount === 0
      ? { key: "materials", label: "Materials", state: "skipped", note: "No parts listed", href: "#work-materials" }
      : STARTED.has(input.workflowState)
        ? { key: "materials", label: "Materials", state: "done", note: `${parts} on the job`, href: "#work-materials" }
        : { key: "materials", label: "Materials", state: "todo", note: `Have ${parts} ready`, href: "#work-materials" };

  const work: ProgressStep =
    input.workflowState === "completed"
      ? { key: "work", label: "Work", state: "done", note: "Finished", href: "#main-content" }
      : UNDER_WAY.has(input.workflowState)
        ? { key: "work", label: "Work", state: "current", note: "Under way", href: "#main-content" }
        : input.scheduledLabel
          ? { key: "work", label: "Work", state: "todo", note: `Booked for ${input.scheduledLabel}`, href: "#main-content" }
          : { key: "work", label: "Work", state: "todo", note: "Not scheduled yet", href: input.scheduleHref };

  const invoice: ProgressStep =
    sent.length > 0
      ? { key: "invoice", label: "Invoice", state: "done", note: "Sent to the customer", href: "#billing" }
      : live.length > 0
        ? { key: "invoice", label: "Invoice", state: "current", note: "Draft, not sent yet", href: "#billing" }
        : { key: "invoice", label: "Invoice", state: "todo", note: "No invoice yet", href: "#work-materials" };

  const paid: ProgressStep = allPaid
    ? { key: "paid", label: "Paid", state: "done", note: "Paid in full", href: "#billing" }
    : sent.length > 0
      ? { key: "paid", label: "Paid", state: "current", note: "Waiting for payment", href: "#billing" }
      : { key: "paid", label: "Paid", state: "todo", note: "Nothing billed yet", href: "#billing" };

  const steps = [estimate, approval, materials, work, invoice, paid];
  const next = steps.find((step) => step.state === "current" || step.state === "todo") ?? null;
  return { steps, next };
}
