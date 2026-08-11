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
  return { detail: `${formatMoney(input.pendingCents)} pending`, tone: "neutral" };
}

/**
 * What is owed, and how much of it is late.
 *
 * Overdue is the only one of these that should ever look alarming, so it is the
 * only one that returns a danger tone — and only when something really is late.
 */
export function invoicesDetail(input: { outstandingCents: number; overdue: number }): {
  detail: string;
  tone: MetricTone;
} {
  if (input.outstandingCents === 0 && input.overdue === 0) {
    return { detail: "Nothing outstanding", tone: "neutral" };
  }
  if (input.overdue === 0) return { detail: "None overdue", tone: "neutral" };
  return {
    detail: `${input.overdue} overdue`,
    tone: "danger",
  };
}

/**
 * Whether an invoice is late, as of now.
 *
 * Paid invoices are never overdue however old they are, and an invoice with no
 * due date cannot be late — guessing one would manufacture the alarm this whole
 * module exists to stop.
 */
export function isOverdue(
  invoice: { status: string; dueAt: string | null; balanceDueCents: number },
  now: Date = new Date(),
): boolean {
  if (invoice.status === "paid" || invoice.status === "void") return false;
  if (invoice.balanceDueCents <= 0) return false;
  if (!invoice.dueAt) return false;

  const due = new Date(invoice.dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < now.getTime();
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
  invoices: { dueAt: string | null; balanceDueCents: number; status: string }[],
  now: Date = new Date(),
): AgingBucket[] {
  const buckets = [
    { label: "Not yet due", cents: 0 },
    { label: "1-30 days", cents: 0 },
    { label: "31+ days", cents: 0 },
  ];

  for (const invoice of invoices) {
    if (invoice.status === "paid" || invoice.status === "void") continue;
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
