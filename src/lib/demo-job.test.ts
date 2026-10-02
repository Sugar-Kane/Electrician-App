import test from "node:test";
import assert from "node:assert/strict";

import {
  BOOKED_WEEKDAY,
  DEMO_JOB,
  DEMO_LINES,
  JOB_STAGES,
  demoCalendar,
  demoContract,
  demoEstimateLabel,
  demoHistory,
  demoInvoice,
  demoToday,
  demoTotals,
  jobStatusAt,
  longDate,
  signedAtLabel,
  stageIndex,
} from "./demo-job.ts";

test("the six stages, in the order a job moves through them", () => {
  assert.deepEqual(
    JOB_STAGES.map((stage) => stage.name),
    ["Estimate", "Contract", "Schedule", "Work", "Invoice", "Paid"],
  );
  assert.equal(stageIndex("schedule"), 2);
  for (const stage of JOB_STAGES) assert.ok(stage.line.length > 0, stage.id);
});

test("the job's status follows the stage, in the app's own words", () => {
  assert.deepEqual(
    JOB_STAGES.map((stage) => jobStatusAt(stage.id)),
    ["Pending", "Pending", "Scheduled", "In progress", "Completed", "Completed"],
  );
});

test("the estimate is $4,850: labor and parts added up the way a real job's are", () => {
  const totals = demoTotals();
  assert.equal(totals.laborCents, 250_000);
  assert.equal(totals.materialCents, 235_000);
  assert.equal(totals.subtotalCents, 485_000);
  assert.equal(totals.lineCount, DEMO_LINES.length);
  assert.equal(demoEstimateLabel(), "$4,850");
});

test("the invoice takes the diagnostic fee paid at booking off, once", () => {
  const invoice = demoInvoice();
  assert.equal(invoice.subtotalCents, 485_000);
  assert.equal(invoice.diagnosticCreditCents, DEMO_JOB.diagnosticFeeCents);
  assert.equal(invoice.totalCents, 467_000);
});

test("the contract is the starter template with nothing left blank", () => {
  const calendar = demoCalendar("2026-10-02");
  const workDay = calendar.week[BOOKED_WEEKDAY]!;
  const contract = demoContract({ calendar, workDay });

  assert.deepEqual(contract.unfilled, []);
  assert.doesNotMatch(contract.body, /\{\{/);
  assert.match(contract.body, /^WORK AGREEMENT/);
  assert.match(contract.body, /Sarah Martinez/);
  assert.match(contract.body, /Total: \$4,850\.00/);
  // Paid at booking, so the contract does not ask for it again.
  assert.match(contract.body, /Deposit due before work begins: \$180\.00 \(paid\)/);
  assert.match(contract.body, /scheduled for Tue, Oct 6, 2026/);
  assert.equal(contract.reference, "Job #1042");
  assert.equal(contract.job.scheduledLabel, "Scheduled Oct 6, 2026");
  assert.equal(contract.signature, undefined);
});

test("the business signed the day before, so it always signed first", () => {
  const calendar = demoCalendar("2026-10-02");
  const contract = demoContract({ calendar, workDay: calendar.week[BOOKED_WEEKDAY]! });

  assert.match(contract.body, /This agreement is made on Thu, Oct 1, 2026/);
  assert.equal(contract.createdLabel, "Oct 1, 2026");
  assert.equal(contract.contractorSignature?.name, "Dana Ridgeway");
  assert.equal(contract.contractorSignature?.signedLabel, "Oct 1, 2026, 4:12 PM PDT");
  // Out of daylight saving it is still the afternoon.
  const winter = demoContract({ calendar: demoCalendar("2026-12-02"), workDay: calendar.week[BOOKED_WEEKDAY]! });
  assert.equal(winter.contractorSignature?.signedLabel, "Dec 1, 2026, 3:12 PM PST");
});

test("once signed, the contract carries the customer's signature", () => {
  const calendar = demoCalendar("2026-10-02");
  const contract = demoContract({
    calendar,
    workDay: calendar.week[BOOKED_WEEKDAY]!,
    signature: { method: "typed", name: "Sarah Martinez", image: "", signedLabel: "Oct 2, 2026, 3:14 PM PDT", fingerprint: "ab12 cd34 ef56 7890" },
  });
  assert.equal(contract.signature?.name, "Sarah Martinez");
});

test("the work goes into the week after today, never a day already gone", () => {
  // A Friday: the following Monday to Friday.
  const friday = demoCalendar("2026-10-02");
  assert.deepEqual(
    friday.week.map((day) => `${day.weekday} ${day.date}`),
    ["Mon Oct 5", "Tue Oct 6", "Wed Oct 7", "Thu Oct 8", "Fri Oct 9"],
  );
  assert.equal(friday.booked.date, "Sep 23");
  assert.equal(friday.diagnostic.date, "Sep 25");

  // A Monday books into next week, not today.
  assert.equal(demoCalendar("2026-10-05").week[0]?.iso, "2026-10-12");
  // A weekend books into the week ahead.
  assert.equal(demoCalendar("2026-10-04").week[0]?.iso, "2026-10-05");
  assert.equal(demoCalendar("2026-10-10").week[0]?.iso, "2026-10-12");
});

test("a date that cannot be read falls back to today rather than throwing", () => {
  const calendar = demoCalendar("not a date");
  assert.equal(calendar.week.length, 5);
  assert.match(calendar.todayIso, /^\d{4}-\d{2}-\d{2}$/);
});

test("today is the sample business's today, on its own clock", () => {
  // 11:30 PM on the 1st in Sacramento is already the 2nd in UTC.
  assert.equal(demoToday(new Date("2026-10-02T06:30:00Z")), "2026-10-01");
  assert.equal(demoToday(new Date("2026-10-02T19:00:00Z")), "2026-10-02");
});

test("dates read the way the app writes them", () => {
  assert.equal(longDate("2026-10-06"), "Tue, Oct 6, 2026");
  assert.equal(signedAtLabel(new Date("2026-10-02T22:14:00Z")), "Oct 2, 2026, 3:14 PM PDT");
});

test("the customer's history runs from booking to the invoice", () => {
  const calendar = demoCalendar("2026-10-02");
  const workDay = calendar.week[BOOKED_WEEKDAY]!;
  const unsigned = demoHistory({ calendar, workDay, signed: false });
  const signed = demoHistory({ calendar, workDay, signed: true });

  assert.equal(unsigned.length, 5);
  assert.match(unsigned[0]!.text, /paid the \$180\.00 fee/);
  assert.match(unsigned[2]!.text, /^Contract sent for \$4,850\.00/);
  assert.equal(unsigned[2]!.day.iso, "2026-10-01");
  assert.ok(!unsigned.some((entry) => entry.text.startsWith("Signed")));

  // Signing adds the day it happened, which is today.
  assert.equal(signed.length, 6);
  assert.equal(signed[3]!.text, "Signed the contract");
  assert.equal(signed[3]!.day.iso, "2026-10-02");
  assert.match(signed[5]!.text, /\$4,670\.00 due/);
});
