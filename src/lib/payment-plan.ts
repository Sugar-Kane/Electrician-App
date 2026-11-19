/**
 * A job's payment plan: a deposit, installments, and the balance.
 *
 * The plan is what the contract tells the customer and what they are asked to
 * pay, when. All of it in integer cents. A percentage is of the contract
 * total; the last payment is always "the balance", whatever is left, so the
 * plan adds up to the total exactly and rounding never charges a cent more or
 * less. A plan that would ask for more than the total is refused.
 *
 * Import-free, so the rules are tested without a database.
 */

export type PlanItemKind = "deposit" | "installment" | "final";
export type PlanDue = "on_signing" | "on_date" | "on_completion";

export type PlanItemInput = {
  kind: PlanItemKind;
  amountType: "fixed" | "percent";
  /** For a fixed amount, in cents. */
  amountCents?: number | null;
  /** For a percentage, in basis points: 2500 is 25%. */
  percentBps?: number | null;
  due: PlanDue;
  /** "2026-12-01", for a payment due on a date. */
  dueDate?: string | null;
};

export type PlannedPayment = PlanItemInput & { cents: number };

export type PlanResult = { ok: true; payments: PlannedPayment[] } | { ok: false; reason: string };

function whole(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/**
 * What each payment comes to, for a contract total.
 *
 * The final payment (added when missing) is the balance. Every payment must
 * come to more than nothing, a date payment needs its date, and the payments
 * before the balance cannot reach the total.
 */
/**
 * The most a California home improvement contract may take as a down payment:
 * 10% of the contract price or $1,000, whichever is less (Business and
 * Professions Code §7159.5).
 */
export const DOWN_PAYMENT_CAP_CENTS = 100_000;

export function maxDownPaymentCents(totalCents: number): number {
  const total = Math.max(0, whole(totalCents));
  return Math.min(Math.floor(total / 10), DOWN_PAYMENT_CAP_CENTS);
}

/** The statutory notice a contract with a down payment carries. */
export const DOWN_PAYMENT_NOTICE = "THE DOWN PAYMENT MAY NOT EXCEED $1,000 OR 10 PERCENT OF THE CONTRACT PRICE, WHICHEVER IS LESS.";

export function planAmounts(totalCents: number, items: PlanItemInput[]): PlanResult {
  const total = Math.max(0, whole(totalCents));
  if (total <= 0) return { ok: false, reason: "Price the job first. A payment plan splits the contract total." };

  const before = items.filter((item) => item.kind !== "final");
  const final = items.find((item) => item.kind === "final") ?? { kind: "final" as const, amountType: "fixed" as const, due: "on_completion" as const };

  const payments: PlannedPayment[] = [];
  let sum = 0;
  for (const item of before) {
    const cents =
      item.amountType === "percent"
        ? Math.round((total * Math.max(0, whole(item.percentBps))) / 10_000)
        : Math.max(0, whole(item.amountCents));
    if (cents <= 0) return { ok: false, reason: "Every payment needs an amount or a percentage more than zero." };
    if (item.due === "on_date" && !/^\d{4}-\d{2}-\d{2}$/.test(item.dueDate ?? "")) {
      return { ok: false, reason: "Give each dated payment its date." };
    }
    sum += cents;
    payments.push({ ...item, cents });
  }

  // The down payment: the deposit and anything else due on signing, before
  // any work. California caps it.
  const down = payments
    .filter((payment) => payment.kind === "deposit" || payment.due === "on_signing")
    .reduce((acc, payment) => acc + payment.cents, 0);
  const cap = maxDownPaymentCents(total);
  if (down > cap) {
    return {
      ok: false,
      reason: `California limits the down payment to 10% of the price or $1,000, whichever is less: at most ${(cap / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} for this job.`,
    };
  }

  const balance = total - sum;
  if (balance <= 0) {
    return { ok: false, reason: "The payments before the balance come to the whole total or more. Lower one of them." };
  }
  if (final.due === "on_date" && !/^\d{4}-\d{2}-\d{2}$/.test(final.dueDate ?? "")) {
    return { ok: false, reason: "Give the balance its date, or make it due on completion." };
  }
  payments.push({ ...final, kind: "final", amountType: "fixed", amountCents: balance, percentBps: null, cents: balance });
  return { ok: true, payments };
}

/** Whether a payment is due yet: on signing once signed, on a date once it comes, on completion once done. */
export function paymentIsDue(
  payment: Pick<PlanItemInput, "due" | "dueDate">,
  state: { today: string; signed: boolean; completed: boolean },
): boolean {
  if (payment.due === "on_signing") return state.signed;
  if (payment.due === "on_completion") return state.completed;
  return Boolean(payment.dueDate) && (payment.dueDate as string) <= state.today;
}

/**
 * What to ask the customer for now: everything due so far, less what they
 * have already paid. Never below zero, never above what is left on the total.
 */
export function amountDueNow(
  payments: PlannedPayment[],
  state: { paidCents: number; today: string; signed: boolean; completed: boolean },
): number {
  const total = payments.reduce((sum, payment) => sum + payment.cents, 0);
  const dueSoFar = payments.filter((payment) => paymentIsDue(payment, state)).reduce((sum, payment) => sum + payment.cents, 0);
  const paid = Math.max(0, whole(state.paidCents));
  return Math.max(0, Math.min(dueSoFar - paid, total - paid));
}

/**
 * What has been paid toward each payment, oldest first. Money received counts
 * against the plan in order (the deposit, then each payment, then the
 * balance), however it came in: a pay link, cash, a check. So a plan saved
 * again, or a payment made on the wrong link, never makes anything look unpaid
 * or paid twice.
 */
export function paymentsOwed(payments: PlannedPayment[], prepaidCents: number): { cents: number; owedCents: number; paid: boolean }[] {
  let left = Math.max(0, whole(prepaidCents));
  return payments.map((payment) => {
    const covered = Math.min(left, payment.cents);
    left -= covered;
    const owedCents = payment.cents - covered;
    return { cents: payment.cents, owedCents, paid: owedCents === 0 };
  });
}

/**
 * What a payment's pay link asks for: everything in the plan up to and
 * including it, less what has been paid and what is already on its way by
 * bank. A deposit still owed is part of the next payment's link rather than
 * forgotten; a payment already covered asks for nothing.
 */
export function payLinkCents(
  payments: PlannedPayment[],
  index: number,
  state: { prepaidCents: number; processingCents?: number },
): number {
  if (index < 0 || index >= payments.length) return 0;
  const through = payments.slice(0, index + 1).reduce((sum, payment) => sum + payment.cents, 0);
  const paid = Math.max(0, whole(state.prepaidCents)) + Math.max(0, whole(state.processingCents ?? 0));
  return Math.max(0, through - paid);
}

/**
 * Whether the customer is asked for a payment automatically now: one due on
 * signing once signed, one due on a date once that date comes, and only once
 * (`requestedAt`). The balance due on completion is asked for by the invoice,
 * not a pay link, and nothing is asked for once the invoice is out.
 */
export function shouldRequestPayment(
  payment: Pick<PlannedPayment, "kind" | "due" | "dueDate">,
  state: { requestedAt: string | null; owedCents: number; today: string; signed: boolean; invoiceSent: boolean },
): boolean {
  if (state.requestedAt || state.invoiceSent || state.owedCents <= 0) return false;
  if (payment.due === "on_completion") return false;
  return paymentIsDue(payment, { today: state.today, signed: state.signed, completed: false });
}

/** A payment as a signed contract's schedule recorded it (contracts.payment_schedule). */
export type SignedSchedulePayment = { kind: string; cents: number; due: string; dueDate: string | null };

/**
 * Whether a payment is one the customer signed for: the same place in the
 * schedule, the same kind, amount and due date as the signed contract says.
 * Only such a payment is asked for automatically; a plan changed after
 * signing is asked for by hand, or after the new contract is signed.
 */
export function matchesSignedSchedule(
  payment: Pick<PlannedPayment, "kind" | "cents" | "due" | "dueDate">,
  index: number,
  signed: SignedSchedulePayment[] | null,
): boolean {
  const entry = signed?.[index];
  if (!entry) return false;
  return (
    entry.kind === payment.kind &&
    whole(entry.cents) === payment.cents &&
    entry.due === payment.due &&
    (entry.dueDate ?? null) === (payment.due === "on_date" ? payment.dueDate ?? null : null)
  );
}

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * The payment terms in plain words, one line a payment, for the contract.
 * `formatDate` turns "2026-12-01" into "Dec 1, 2026".
 */
export function planSummaryLines(payments: PlannedPayment[], formatDate: (isoDate: string) => string): string[] {
  if (payments.length <= 1) return ["Payment in full is due on completion of the work."];
  return payments.map((payment, index) => {
    const when =
      payment.due === "on_signing"
        ? "due on signing"
        : payment.due === "on_completion"
          ? "due on completion of the work"
          : `due ${formatDate(payment.dueDate ?? "")}`;
    const share = payment.amountType === "percent" && payment.percentBps ? ` (${(payment.percentBps / 100).toLocaleString("en-US")}%)` : "";
    return `${paymentLabel(payment, index)} ${dollars(payment.cents)}${share} ${when}.`;
  });
}

/** "Deposit", "Payment 2", "Balance": the name a payment goes by on the contract and its pay link. */
export function paymentLabel(payment: Pick<PlanItemInput, "kind">, index: number): string {
  return payment.kind === "deposit" ? "Deposit" : payment.kind === "final" ? "Balance" : `Payment ${index + 1}`;
}

/** The deposit to state on the contract: the first payment when it is a deposit, else none. */
export function planDepositCents(payments: PlannedPayment[]): number {
  const first = payments[0];
  return payments.length > 1 && first?.kind === "deposit" ? first.cents : 0;
}

/**
 * The payment terms as the contract states them: a "PAYMENT SCHEDULE" block,
 * and the deposit figure. Empty when the job has no plan (payment in full on
 * completion, as the template already says).
 */
export function contractPaymentTerms(
  payments: PlannedPayment[] | null,
  formatDate: (isoDate: string) => string,
): { block: string; depositCents: number; snapshot: { lines: string[]; payments: { kind: string; cents: number; due: string; dueDate: string | null }[] } | null } {
  if (!payments || payments.length <= 1) return { block: "", depositCents: 0, snapshot: null };
  const lines = planSummaryLines(payments, formatDate);
  return {
    block: [
      "PAYMENT SCHEDULE",
      ...lines.map((line, index) => `${index + 1}. ${line}`),
      "Progress payments are for work performed or materials delivered.",
      ...(planDepositCents(payments) > 0 ? ["", DOWN_PAYMENT_NOTICE] : []),
    ].join("\n"),
    depositCents: planDepositCents(payments),
    snapshot: {
      lines,
      payments: payments.map((payment) => ({ kind: payment.kind, cents: payment.cents, due: payment.due, dueDate: payment.dueDate ?? null })),
    },
  };
}

/**
 * Put the payment schedule into a filled contract body: in place of
 * {{payment_terms}} when the template has it, otherwise straight after the
 * PRICE section's deposit line (or at the end), and the "balance is due on
 * completion" sentence pointed at the schedule instead.
 */
export function withPaymentSchedule(body: string, block: string): string {
  if (!block) return body.replace(/\{\{\s*payment_terms\s*\}\}/g, "Payment in full is due on completion of the work.");
  let next = body;
  if (/\{\{\s*payment_terms\s*\}\}/.test(next)) {
    next = next.replace(/\{\{\s*payment_terms\s*\}\}/g, block);
  } else {
    const lines = next.split("\n");
    const deposit = lines.findIndex((line) => /deposit due before work begins/i.test(line));
    if (deposit >= 0) lines.splice(deposit + 1, 0, "", block);
    else lines.push("", block);
    next = lines.join("\n");
  }
  return next.replace(
    /The balance is due on completion of the work described above\./g,
    "Payments are due as set out in the payment schedule.",
  );
}
