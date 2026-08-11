import test from "node:test";
import assert from "node:assert/strict";

import {
  estimatesDetail,
  invoiceAging,
  invoicesDetail,
  isOverdue,
  jobsDetail,
  profitSummary,
  revenueDetail,
  techniciansDetail,
} from "./dashboard-metrics.ts";

test("no takings at all does not claim a rise", () => {
  // The screenshot that prompted this: "$0" with "+18% vs yesterday" under it.
  assert.deepEqual(revenueDetail({ todayCents: 0, yesterdayCents: 0 }), {
    detail: "Nothing paid yet today",
    tone: "neutral",
  });
});

test("a first payment is reported as such rather than as an infinite rise", () => {
  // Dividing by a zero yesterday gives +Infinity, and +100% would be a lie.
  assert.deepEqual(revenueDetail({ todayCents: 25_000, yesterdayCents: 0 }), {
    detail: "First payments today",
    tone: "positive",
  });
});

test("a real rise and a real fall are both reported, with the right tone", () => {
  assert.deepEqual(revenueDetail({ todayCents: 12_000, yesterdayCents: 10_000 }), {
    detail: "+20% vs yesterday",
    tone: "positive",
  });
  assert.deepEqual(revenueDetail({ todayCents: 8_000, yesterdayCents: 10_000 }), {
    detail: "-20% vs yesterday",
    tone: "danger",
  });
});

test("an identical day says so instead of showing +0%", () => {
  assert.deepEqual(revenueDetail({ todayCents: 10_000, yesterdayCents: 10_000 }), {
    detail: "Same as yesterday",
    tone: "neutral",
  });
});

test("a day with nothing booked says so rather than '0 in progress'", () => {
  assert.equal(jobsDetail({ inProgress: 0, total: 0 }).detail, "Nothing booked today");
  assert.equal(jobsDetail({ inProgress: 0, total: 3 }).detail, "0 in progress");
  assert.equal(jobsDetail({ inProgress: 2, total: 3 }).detail, "2 in progress");
});

test("technicians on the way is counted, not asserted", () => {
  // "2 on the way" under a single technician was the tell that none of the
  // subtext was real.
  assert.equal(techniciansDetail({ active: 1, enRoute: 0 }).detail, "None on the way");
  assert.equal(techniciansDetail({ active: 3, enRoute: 2 }).detail, "2 on the way");
  assert.equal(techniciansDetail({ active: 0, enRoute: 0 }).detail, "Nobody on the schedule");
});

test("no estimates says so rather than '$0 pending'", () => {
  assert.equal(estimatesDetail({ pendingCents: 0, count: 0 }).detail, "None waiting on a customer");
  assert.equal(estimatesDetail({ pendingCents: 45_000, count: 2 }).detail, "$450 pending");
});

test("a business with no invoices is not told five are overdue", () => {
  assert.deepEqual(invoicesDetail({ outstandingCents: 0, overdue: 0 }), {
    detail: "Nothing outstanding",
    tone: "neutral",
  });
});

test("money owed but nothing late is not alarming", () => {
  assert.deepEqual(invoicesDetail({ outstandingCents: 120_000, overdue: 0 }), {
    detail: "None overdue",
    tone: "neutral",
  });
});

test("something genuinely late is the one thing that looks alarming", () => {
  assert.deepEqual(invoicesDetail({ outstandingCents: 120_000, overdue: 3 }), {
    detail: "3 overdue",
    tone: "danger",
  });
});

const NOW = new Date("2026-08-11T12:00:00Z");

test("an unpaid invoice past its due date is overdue", () => {
  assert.equal(
    isOverdue(
      { status: "sent", dueAt: "2026-08-01T12:00:00Z", balanceDueCents: 10_000 },
      NOW,
    ),
    true,
  );
});

test("a paid invoice is never overdue, however old", () => {
  assert.equal(
    isOverdue({ status: "paid", dueAt: "2020-01-01T00:00:00Z", balanceDueCents: 0 }, NOW),
    false,
  );
  // Nor is a voided one.
  assert.equal(
    isOverdue({ status: "void", dueAt: "2020-01-01T00:00:00Z", balanceDueCents: 500 }, NOW),
    false,
  );
});

test("an invoice with nothing left to pay is not overdue", () => {
  // Settled by a payment that has not flipped the status yet.
  assert.equal(
    isOverdue({ status: "sent", dueAt: "2020-01-01T00:00:00Z", balanceDueCents: 0 }, NOW),
    false,
  );
});

test("an invoice with no due date is not overdue, because we would be inventing one", () => {
  assert.equal(isOverdue({ status: "sent", dueAt: null, balanceDueCents: 10_000 }, NOW), false);
  assert.equal(
    isOverdue({ status: "sent", dueAt: "not a date", balanceDueCents: 10_000 }, NOW),
    false,
  );
});

test("an invoice due later today is not yet overdue", () => {
  assert.equal(
    isOverdue({ status: "sent", dueAt: "2026-08-11T23:00:00Z", balanceDueCents: 10_000 }, NOW),
    false,
  );
});

test("a part month is compared against the same part of the last one", () => {
  // Comparing eleven days against a full previous month would show a collapse
  // every month until the last day of it.
  assert.deepEqual(profitSummary({ monthToDateCents: 120_000, lastMonthToDateCents: 100_000 }), {
    value: "$1,200",
    change: "+20% vs last month",
    tone: "positive",
  });
});

test("a business that has collected nothing is not shown a percentage", () => {
  assert.deepEqual(profitSummary({ monthToDateCents: 0, lastMonthToDateCents: 0 }), {
    value: "$0",
    change: "Nothing collected yet",
    tone: "neutral",
  });
  assert.equal(
    profitSummary({ monthToDateCents: 50_000, lastMonthToDateCents: 0 }).change,
    "First month of collections",
  );
});

test("no outstanding invoices draws an empty bar, not three fixed segments", () => {
  const buckets = invoiceAging([]);
  assert.equal(buckets.length, 3);
  assert.deepEqual(
    buckets.map((bucket) => bucket.percent),
    [0, 0, 0],
  );
  assert.deepEqual(
    buckets.map((bucket) => bucket.value),
    ["$0", "$0", "$0"],
  );
});

test("owed money lands in the bucket matching how late it is", () => {
  const now = new Date("2026-08-11T12:00:00Z");
  const buckets = invoiceAging(
    [
      { dueAt: "2026-08-20T12:00:00Z", balanceDueCents: 10_000, status: "sent" },
      { dueAt: "2026-08-01T12:00:00Z", balanceDueCents: 20_000, status: "sent" },
      { dueAt: "2026-05-01T12:00:00Z", balanceDueCents: 70_000, status: "overdue" },
    ],
    now,
  );

  assert.deepEqual(
    buckets.map((bucket) => [bucket.label, bucket.value, bucket.percent]),
    [
      ["Not yet due", "$100", 10],
      ["1-30 days", "$200", 20],
      ["31+ days", "$700", 70],
    ],
  );
});

test("paid and settled invoices are not counted as owed", () => {
  const buckets = invoiceAging([
    { dueAt: "2020-01-01T00:00:00Z", balanceDueCents: 0, status: "paid" },
    { dueAt: "2020-01-01T00:00:00Z", balanceDueCents: 5_000, status: "void" },
    { dueAt: "2020-01-01T00:00:00Z", balanceDueCents: 0, status: "sent" },
  ]);
  assert.deepEqual(
    buckets.map((bucket) => bucket.percent),
    [0, 0, 0],
  );
});

test("an invoice with no due date counts as owed but not as late", () => {
  const buckets = invoiceAging([
    { dueAt: null, balanceDueCents: 30_000, status: "sent" },
  ]);
  assert.equal(buckets[0]?.value, "$300");
  assert.equal(buckets[0]?.percent, 100);
});

test("a day whose only job was canceled is not the same as an empty day", () => {
  // "Jobs today: 1" with "0 in progress" under it was the contradiction that
  // gave this away — the job had been cancelled and still counted.
  assert.deepEqual(jobsDetail({ inProgress: 0, total: 0, canceled: 1 }), {
    detail: "1 canceled today",
    tone: "danger",
  });

  assert.deepEqual(jobsDetail({ inProgress: 0, total: 0, canceled: 0 }), {
    detail: "Nothing booked today",
    tone: "neutral",
  });
});

test("a cancellation alongside live work is mentioned, not hidden", () => {
  assert.equal(
    jobsDetail({ inProgress: 1, total: 2, canceled: 1 }).detail,
    "1 in progress, 1 canceled",
  );
});
