/**
 * The small print under each dashboard number.
 *
 * These read as facts — "+18% vs yesterday", "2 on the way", "5 overdue" — and
 * every one of them was a fixture. The card above said $0 revenue while the
 * line beneath it claimed an 18% rise, and 5 overdue invoices sat under a
 * business with no invoices at all. A number that is wrong is a bug; a number
 * that is confidently wrong underneath a correct one is worse, because it
 * teaches people not to believe the correct one either.
 *
 * Import-free so each line can be tested against the counts that produce it.
 */

export type MetricTone = "positive" | "danger" | "neutral";

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Today's takings against yesterday's.
 *
 * A percentage needs something to divide by. Yesterday at zero is the ordinary
 * case for a business just starting, and "+∞%" or "+100%" would both be
 * inventions — so it says what actually happened instead.
 */
export function revenueDetail(input: {
  todayCents: number;
  yesterdayCents: number;
}): { detail: string; tone: MetricTone } {
  const { todayCents, yesterdayCents } = input;

  if (yesterdayCents === 0) {
    if (todayCents === 0) return { detail: "Nothing paid yet today", tone: "neutral" };
    return { detail: "First payments today", tone: "positive" };
  }

  const change = Math.round(((todayCents - yesterdayCents) / yesterdayCents) * 100);
  if (change === 0) return { detail: "Same as yesterday", tone: "neutral" };

  const sign = change > 0 ? "+" : "";
  return {
    detail: `${sign}${change}% vs yesterday`,
    tone: change > 0 ? "positive" : "danger",
  };
}

/**
 * How many of today's jobs are actually underway.
 *
 * Canceled jobs are counted separately rather than silently dropped: a day
 * whose only job was called off is not the same as a day nobody booked, and the
 * electrician wants to know which one they are looking at.
 */
export function jobsDetail(input: {
  inProgress: number;
  total: number;
  canceled?: number;
}): { detail: string; tone: MetricTone } {
  const canceled = input.canceled ?? 0;

  if (input.total === 0) {
    if (canceled > 0) {
      return {
        detail: `${canceled} canceled today`,
        tone: "danger",
      };
    }
    return { detail: "Nothing booked today", tone: "neutral" };
  }

  if (canceled > 0) {
    return { detail: `${input.inProgress} in progress, ${canceled} canceled`, tone: "neutral" };
  }
  return { detail: `${input.inProgress} in progress`, tone: "neutral" };
}

/**
 * How many technicians are on their way somewhere.
 *
 * "2 on the way" under a single technician was the tell that none of this was
 * real. It is now the count of today's jobs whose status says a van is moving.
 */
export function techniciansDetail(input: { active: number; enRoute: number }): {
  detail: string;
  tone: MetricTone;
} {
  if (input.active === 0) return { detail: "Nobody on the schedule", tone: "neutral" };
  if (input.enRoute === 0) return { detail: "None on the way", tone: "neutral" };
  return { detail: `${input.enRoute} on the way`, tone: "neutral" };
}

export function estimatesDetail(input: { pendingCents: number; count: number }): {
  detail: string;
  tone: MetricTone;
} {
  if (input.count === 0) return { detail: "None waiting on a customer", tone: "neutral" };
  // Agreements drawn up before their figures were saved have no total to add,
  // and "$0 pending" beside a waiting quote would be a number that lies.
  if (input.pendingCents <= 0) return { detail: "Waiting on the customer", tone: "neutral" };
  return { detail: `${formatMoney(input.pendingCents)} pending`, tone: "neutral" };
}

/**
 * What is owed, and how much of it is late.
 *
 * Overdue is the only one of these that should ever look alarming, so it is the
 * only one that returns a danger tone — and only when something really is late.
 */
export function invoicesDetail(input: { outstandingCents: number; overdue: number; draftCents?: number }): {
  detail: string;
  tone: MetricTone;
} {
  // Drafts are named beside the total rather than added to it: money the
  // customer has not been asked for is not money owed.
  const drafts = (input.draftCents ?? 0) > 0 ? ` · ${formatMoney(input.draftCents ?? 0)} in drafts not sent` : "";
  if (input.outstandingCents === 0 && input.overdue === 0) {
    return { detail: `Nothing outstanding${drafts}`, tone: "neutral" };
  }
  if (input.overdue === 0) return { detail: `None overdue${drafts}`, tone: "neutral" };
  return {
    detail: `${input.overdue} overdue${drafts}`,
    tone: "danger",
  };
}

/** What an invoice's state is worked out from. `lastSentAt` is the delivery record. */
export type InvoiceFacts = {
  status: string;
  dueAt: string | null;
  balanceDueCents: number;
  lastSentAt?: string | null;
};

/**
 * Whether the customer has been sent this invoice.
 *
 * Texting or emailing an invoice used to record when it went and leave the
 * status at "draft", so a bill the customer had in hand still read Draft on
 * the job and Unpaid on the list. Either fact is enough: a status past draft,
 * or a recorded send.
 */
export function wasSent(invoice: InvoiceFacts): boolean {
  return invoice.status !== "draft" || Boolean(invoice.lastSentAt);
}

/**
 * Whether an invoice is late, as of now.
 *
 * Paid invoices are never overdue however old they are, and an invoice with no
 * due date cannot be late — guessing one would manufacture the alarm this whole
 * module exists to stop. Nor can a draft nobody has sent: the customer has not
 * been asked for anything yet, and chasing them for it is the mistake.
 */
export function isOverdue(invoice: InvoiceFacts, now: Date = new Date()): boolean {
  if (invoice.status === "paid" || invoice.status === "void") return false;
  if (!wasSent(invoice)) return false;
  if (invoice.balanceDueCents <= 0) return false;
  if (invoice.status === "overdue") return true;
  if (!invoice.dueAt) return false;

  const due = new Date(invoice.dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < now.getTime();
}

export type InvoiceState = "draft" | "awaiting" | "part_paid" | "overdue" | "paid" | "void";

/**
 * Where an invoice is, as of now: one answer for the list, the job, the
 * invoice itself, Home and Reports.
 *
 * Each screen used to decide for itself, and they disagreed — the same bill
 * was Unpaid on the list, Draft on its job, and counted in Home's money owed
 * before the customer had ever seen it.
 */
export function invoiceState(invoice: InvoiceFacts, now: Date = new Date()): InvoiceState {
  if (invoice.status === "void") return "void";
  if (invoice.status === "paid") return "paid";
  if (!wasSent(invoice)) return "draft";
  if (isOverdue(invoice, now)) return "overdue";
  if (invoice.status === "partially_paid") return "part_paid";
  // Sent with nothing left to pay is settled in all but the word.
  if (invoice.balanceDueCents <= 0) return "paid";
  return "awaiting";
}

export const INVOICE_STATE_LABELS: Record<InvoiceState, string> = {
  draft: "Draft · not sent",
  awaiting: "Sent · awaiting payment",
  part_paid: "Part paid",
  overdue: "Overdue",
  paid: "Paid",
  void: "Void",
};

/** The words an invoice is listed under, as of now. */
export function invoiceStatusLabel(invoice: InvoiceFacts, now: Date = new Date()): string {
  return INVOICE_STATE_LABELS[invoiceState(invoice, now)];
}

/**
 * What the business is owed, and what it has not yet asked for.
 *
 * Owed is the balance on every invoice that has gone to a customer and is not
 * paid or voided — part-paid ones included, which the old sum of "draft and
 * sent" left out while counting drafts nobody had seen. Drafts are kept
 * apart, so a total can say "and $X in drafts not sent" rather than pretend
 * that money is due.
 */
export function receivables(
  invoices: InvoiceFacts[],
  now: Date = new Date(),
): { owedCents: number; overdueCount: number; overdueCents: number; draftCount: number; draftCents: number } {
  const totals = { owedCents: 0, overdueCount: 0, overdueCents: 0, draftCount: 0, draftCents: 0 };
  for (const invoice of invoices) {
    const state = invoiceState(invoice, now);
    const balance = Math.max(0, invoice.balanceDueCents);
    if (state === "draft") {
      totals.draftCount += 1;
      totals.draftCents += balance;
    } else if (state === "awaiting" || state === "part_paid" || state === "overdue") {
      totals.owedCents += balance;
      if (state === "overdue") {
        totals.overdueCount += 1;
        totals.overdueCents += balance;
      }
    }
  }
  return totals;
}

/**
 * The Invoices list's tabs, as one rule with the totals above.
 *
 * Awaiting is everything sent and not settled, overdue included: Today's
 * "owed" opens it, and a tab that left the late ones out would show less than
 * the number that was tapped. Overdue is the late part of it.
 */
export type InvoiceFilter = "all" | "draft" | "awaiting" | "overdue" | "paid";

export function inInvoiceFilter(state: InvoiceState, filter: InvoiceFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "draft":
      return state === "draft";
    case "awaiting":
      return state === "awaiting" || state === "part_paid" || state === "overdue";
    case "overdue":
      return state === "overdue";
    case "paid":
      return state === "paid";
  }
}

/**
 * What a tab adds up to: the balance still owed where money is being waited
 * for, so it matches `receivables`, and the invoice total everywhere else.
 */
export function listedTotalCents(
  invoices: { state: InvoiceState; totalCents: number; balanceCents: number }[],
  filter: InvoiceFilter,
): number {
  const owing = filter === "awaiting" || filter === "overdue";
  return invoices
    .filter((invoice) => inInvoiceFilter(invoice.state, filter))
    .reduce((sum, invoice) => sum + (owing ? Math.max(0, invoice.balanceCents) : invoice.totalCents), 0);
}

export type PaidPeriod = "today" | "month";

/**
 * Whether an invoice paid on `paidOn` (YYYY-MM-DD, the business's own day)
 * falls in the period, as of `today`. Today's takings and the list they open
 * both ask this, so the two cannot disagree about a payment just after
 * midnight.
 */
export function paidInPeriod(paidOn: string | null | undefined, period: PaidPeriod, today: string): boolean {
  if (!paidOn) return false;
  if (period === "today") return paidOn === today;
  return paidOn.slice(0, 7) === today.slice(0, 7) && paidOn <= today;
}

/**
 * Money collected this month against the same stretch of last month.
 *
 * Compared like-for-like — the first eleven days of this month against the
 * first eleven of last — because measuring a part-month against a whole one
 * makes every month look like a collapse until the last day of it.
 */
export function profitSummary(input: {
  monthToDateCents: number;
  lastMonthToDateCents: number;
}): { value: string; change: string; tone: MetricTone } {
  const { monthToDateCents, lastMonthToDateCents } = input;
  const value = formatMoney(monthToDateCents);

  if (lastMonthToDateCents === 0) {
    if (monthToDateCents === 0) return { value, change: "Nothing collected yet", tone: "neutral" };
    return { value, change: "First month of collections", tone: "positive" };
  }

  const change = Math.round(
    ((monthToDateCents - lastMonthToDateCents) / lastMonthToDateCents) * 100,
  );
  if (change === 0) return { value, change: "Level with last month", tone: "neutral" };

  const sign = change > 0 ? "+" : "";
  return {
    value,
    change: `${sign}${change}% vs last month`,
    tone: change > 0 ? "positive" : "danger",
  };
}

export type AgingBucket = { label: string; value: string; percent: number };

/**
 * What is owed, split by how late it is.
 *
 * The bar under it is drawn from these percentages, so they have to add up to
 * something honest: with nothing outstanding every bucket is zero and the bar
 * is empty, rather than three fixed segments implying a debt profile the
 * business does not have.
 */
export function invoiceAging(
  invoices: InvoiceFacts[],
  now: Date = new Date(),
): AgingBucket[] {
  const buckets = [
    { label: "Not yet due", cents: 0 },
    { label: "1-30 days", cents: 0 },
    { label: "31+ days", cents: 0 },
  ];

  for (const invoice of invoices) {
    if (invoice.status === "paid" || invoice.status === "void") continue;
    if (!wasSent(invoice)) continue;
    if (invoice.balanceDueCents <= 0) continue;

    const due = invoice.dueAt ? new Date(invoice.dueAt) : null;
    const daysLate =
      due && !Number.isNaN(due.getTime())
        ? Math.floor((now.getTime() - due.getTime()) / 86_400_000)
        : -1;

    const index = daysLate < 1 ? 0 : daysLate <= 30 ? 1 : 2;
    buckets[index]!.cents += invoice.balanceDueCents;
  }

  const total = buckets.reduce((sum, bucket) => sum + bucket.cents, 0);

  return buckets.map((bucket) => ({
    label: bucket.label,
    value: formatMoney(bucket.cents),
    percent: total === 0 ? 0 : Math.round((bucket.cents / total) * 100),
  }));
}
