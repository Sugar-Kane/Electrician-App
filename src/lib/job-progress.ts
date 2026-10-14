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

/**
 * What finishes a step, offered on the step itself.
 *
 * Most steps are finished somewhere on the job page (the contract card, the
 * billing section), so their action goes there. Marking materials ready is the
 * one that is a single tap with nothing to fill in, so it is done in place.
 */
export type StepAction =
  | { kind: "go"; label: string; href: string }
  | { kind: "materials_ready"; label: string };

export type ProgressStep = {
  key: ProgressKey;
  label: string;
  /** done, waiting on somebody (current), still to do, or not needed for this job. */
  state: "done" | "current" | "todo" | "skipped";
  /** One short line saying why it is in that state. */
  note: string;
  /** The section of the job page that step is about. Always an element on the page. */
  href: string;
  /** What finishes it, while it is not finished. */
  action: StepAction | null;
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
  /** When somebody marked the parts gathered. */
  materialsReadyAt?: string | null;
  agreement: { sent: boolean; signed: boolean } | null;
  invoices: { status: string; lastSentAt: string | null; paidAt: string | null; previewSentAt?: string | null }[];
  /** Priced work no live invoice has billed yet, in cents. */
  unbilledCents?: number;
  /** For the "Priced at" note. */
  formatMoney: (cents: number) => string;
};

const UNDER_WAY = new Set(["en_route", "arrived", "working", "review"]);
const STARTED = new Set(["arrived", "working", "review", "completed"]);

const go = (label: string, href: string): StepAction => ({ kind: "go", label, href });

export function jobProgress(input: ProgressInput): { steps: ProgressStep[]; next: ProgressStep | null } {
  const diagnostic = input.kindOfWork === "Diagnostic";
  const completed = input.workflowState === "completed";
  const signed = Boolean(input.agreement?.signed);
  const live = input.invoices.filter((invoice) => invoice.status !== "void");
  const sent = live.filter((invoice) => invoice.status !== "draft" || Boolean(invoice.lastSentAt));
  const allPaid = live.length > 0 && live.every((invoice) => invoice.status === "paid" || Boolean(invoice.paidAt));
  const previewed = live.some((invoice) => Boolean(invoice.previewSentAt));
  // Work added after the invoice went out: billed on its own, so the job is
  // not finished until it is.
  const moreToBill = sent.length > 0 && (input.unbilledCents ?? 0) > 0;

  const estimate: ProgressStep = diagnostic
    ? { key: "estimate", label: "Estimate", state: "done", note: "The diagnostic fee is the price", href: "#work-materials", action: null }
    : input.pricedCents > 0
      ? { key: "estimate", label: "Estimate", state: "done", note: `Priced at ${input.formatMoney(input.pricedCents)}`, href: "#work-materials", action: null }
      : {
          key: "estimate",
          label: "Estimate",
          state: "todo",
          note: "Add the work and parts to price it",
          href: "#work-materials",
          action: go("Add work & materials", "#work-materials"),
        };

  const approval: ProgressStep = signed
    ? { key: "approval", label: "Approval", state: "done", note: "Signed by the customer", href: "#contract", action: null }
    : input.agreement?.sent
      ? {
          key: "approval",
          label: "Approval",
          state: "current",
          note: "Waiting for the customer to sign",
          href: "#contract",
          action: go("Resend or sign in person", "#contract"),
        }
      : diagnostic
        ? { key: "approval", label: "Approval", state: "skipped", note: "Not needed for a diagnostic", href: "#contract", action: null }
        : {
            key: "approval",
            label: "Approval",
            state: "todo",
            note: "Send the agreement for approval",
            href: "#contract",
            action: go("Send for signature", "#contract"),
          };

  const parts = `${input.partCount} ${input.partCount === 1 ? "part" : "parts"}`;
  const materials: ProgressStep =
    input.partCount === 0
      ? { key: "materials", label: "Materials", state: "skipped", note: "No parts listed", href: "#work-materials", action: null }
      : input.materialsReadyAt || STARTED.has(input.workflowState)
        ? { key: "materials", label: "Materials", state: "done", note: `${parts} ready`, href: "#work-materials", action: null }
        : {
            key: "materials",
            label: "Materials",
            state: "todo",
            note: `Have ${parts} ready`,
            href: "#work-materials",
            action: { kind: "materials_ready", label: "Mark materials ready" },
          };

  const work: ProgressStep = completed
    ? { key: "work", label: "Work", state: "done", note: "Finished", href: "#work", action: null }
    : UNDER_WAY.has(input.workflowState)
      ? { key: "work", label: "Work", state: "current", note: "Under way", href: "#work", action: go("Complete the job", "#work") }
      : input.scheduledLabel
        ? {
            key: "work",
            label: "Work",
            state: "todo",
            note: `Booked for ${input.scheduledLabel}`,
            href: "#work",
            action: go("Start or complete the visit", "#work"),
          }
        : {
            key: "work",
            label: "Work",
            state: "todo",
            note: "Not scheduled yet",
            href: input.scheduleHref,
            action: go("Schedule it", input.scheduleHref),
          };

  /*
   * The invoice goes out twice, in effect: a preview once the customer has
   * signed (what they will be billed, nothing due yet), and the real invoice
   * once the work is done. The step is only finished by the real one.
   */
  const invoice: ProgressStep =
    moreToBill
      ? {
          key: "invoice",
          label: "Invoice",
          state: "current",
          note: `${input.formatMoney(input.unbilledCents ?? 0)} of work added since the last invoice`,
          href: "#billing",
          action: go("Invoice the difference", "#billing"),
        }
      : sent.length > 0
      ? { key: "invoice", label: "Invoice", state: "done", note: "Sent to the customer", href: "#billing", action: null }
      : live.length > 0
        ? completed
          ? {
              key: "invoice",
              label: "Invoice",
              state: "current",
              note: "The work is done: send the invoice",
              href: "#billing",
              action: go("Send invoice", "#billing"),
            }
          : previewed
            ? {
                key: "invoice",
                label: "Invoice",
                state: "current",
                note: "Preview sent. Send the final invoice when the work is complete",
                href: "#billing",
                action: go("Send invoice", "#billing"),
              }
            : signed
              ? {
                  key: "invoice",
                  label: "Invoice",
                  state: "current",
                  note: "Signed: send the customer a preview of the invoice",
                  href: "#billing",
                  action: go("Send invoice preview", "#billing"),
                }
              : {
                  key: "invoice",
                  label: "Invoice",
                  state: "current",
                  note: "Draft, not sent yet",
                  href: "#billing",
                  action: go("Open the invoice", "#billing"),
                }
        : input.pricedCents > 0 || diagnostic
          ? {
              key: "invoice",
              label: "Invoice",
              state: "todo",
              note: "No invoice yet",
              href: "#billing",
              action: go("Generate invoice", "#billing"),
            }
          : {
              key: "invoice",
              label: "Invoice",
              state: "todo",
              note: "Price the job first",
              href: "#work-materials",
              action: go("Add work & materials", "#work-materials"),
            };

  const paid: ProgressStep = allPaid && moreToBill
    ? { key: "paid", label: "Paid", state: "todo", note: "Paid so far; there is more to bill", href: "#billing", action: null }
    : allPaid
    ? { key: "paid", label: "Paid", state: "done", note: "Paid in full", href: "#billing", action: null }
    : sent.length > 0
      ? {
          key: "paid",
          label: "Paid",
          state: "current",
          note: "Waiting for payment",
          href: "#billing",
          action: go("Record payment", "#billing"),
        }
      : { key: "paid", label: "Paid", state: "todo", note: "Nothing billed yet", href: "#billing", action: null };

  const steps = [estimate, approval, materials, work, invoice, paid];
  const next = steps.find((step) => step.state === "current" || step.state === "todo") ?? null;
  return { steps, next };
}

/** The steps still in the way of a finished job, for a job card. */
export function openSteps(steps: ProgressStep[]): ProgressStep[] {
  return steps.filter((step) => step.state === "current" || step.state === "todo");
}

export function isProgressKey(value: unknown): value is ProgressKey {
  return value === "estimate" || value === "approval" || value === "materials" || value === "work" || value === "invoice" || value === "paid";
}
