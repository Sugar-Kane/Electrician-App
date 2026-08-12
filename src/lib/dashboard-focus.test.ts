import test from "node:test";
import assert from "node:assert/strict";

import {
  attentionItems,
  canceledToday,
  firstName,
  greeting,
  isActive,
  minutesFromLabel,
  nextJob,
  openBookingRequests,
  todaysJobs,
} from "./dashboard-focus.ts";
import type { PilotJob } from "./pilot-data.ts";

const job = (over: Partial<PilotJob> & { id: string }): PilotJob =>
  ({
    date: "2026-08-12",
    dateLabel: "Wed, Aug 12",
    time: "8:00 AM",
    endTime: "10:00 AM",
    customer: "Customer",
    contactName: "Customer",
    phone: "",
    email: "",
    address: "",
    city: "Nipomo",
    workType: "diagnostic",
    summary: "",
    status: "Scheduled",
    technician: "Nick",
    technicianInitials: "N",
    accessNotes: "",
    serviceNotes: "",
    coordinates: null,
    documents: [],
    materials: [],
    ...over,
  }) as PilotJob;

const TODAY = "2026-08-12";

test("canceled work is not today's work", () => {
  // A count that includes it makes a day look full when it is not, and the
  // driver reads the list as the route.
  const jobs = [job({ id: "1" }), job({ id: "2", status: "Canceled" })];

  assert.deepEqual(todaysJobs(jobs, TODAY).map((entry) => entry.id), ["1"]);
  assert.deepEqual(canceledToday(jobs, TODAY).map((entry) => entry.id), ["2"]);
});

test("today's jobs come back in the order they happen", () => {
  const jobs = [
    job({ id: "late", time: "2:00 PM" }),
    job({ id: "early", time: "8:00 AM" }),
    job({ id: "mid", time: "11:00 AM" }),
  ];

  assert.deepEqual(todaysJobs(jobs, TODAY).map((entry) => entry.id), ["early", "mid", "late"]);
});

test("a job in progress is the next job, whatever the clock says", () => {
  // If somebody is on a job, that is the job.
  const jobs = [
    job({ id: "earlier", time: "8:00 AM" }),
    job({ id: "current", time: "1:00 PM", status: "In progress" }),
  ];

  assert.equal(nextJob(jobs, TODAY)?.id, "current");
});

test("a finished job is never offered as the next one", () => {
  // "Next: the job you finished two hours ago" is worse than nothing.
  const jobs = [
    job({ id: "done", time: "8:00 AM", status: "Completed" }),
    job({ id: "todo", time: "3:00 PM" }),
  ];

  assert.equal(nextJob(jobs, TODAY)?.id, "todo");
});

test("a canceled job is never offered either", () => {
  const jobs = [job({ id: "off", status: "Canceled" })];
  assert.equal(nextJob(jobs, TODAY), undefined);
});

test("with nothing left today it offers the next day that has work", () => {
  // Six in the evening with the day done should show tomorrow's first call,
  // not an empty screen.
  const jobs = [
    job({ id: "done", status: "Completed" }),
    job({ id: "friday", date: "2026-08-14", time: "9:00 AM" }),
    job({ id: "tomorrow", date: "2026-08-13", time: "11:00 AM" }),
    job({ id: "tomorrow-early", date: "2026-08-13", time: "7:30 AM" }),
  ];

  assert.equal(nextJob(jobs, TODAY)?.id, "tomorrow-early");
});

test("yesterday's unfinished job does not become today's next job", () => {
  // It needs attention, but it is not where the van is going.
  const jobs = [job({ id: "stale", date: "2026-08-10" })];
  assert.equal(nextJob(jobs, TODAY), undefined);
});

test("an empty day offers nothing rather than guessing", () => {
  assert.equal(nextJob([], TODAY), undefined);
});

test("completed and canceled are both inactive", () => {
  assert.equal(isActive({ status: "Scheduled" }), true);
  assert.equal(isActive({ status: "In progress" }), true);
  assert.equal(isActive({ status: "Completed" }), false);
  assert.equal(isActive({ status: "Canceled" }), false);
});

test("nothing wrong means nothing shown", () => {
  // A card that exists only to say "no low-stock items yet" trains people to
  // skim past the place real warnings appear.
  assert.deepEqual(
    attentionItems({
      bookingRequests: 0,
      overdueInvoices: 0,
      unsentInvoices: 0,
      lowStock: 0,
      unassignedToday: 0,
    }),
    [],
  );
});

test("attention items are counted, worded and linked", () => {
  const items = attentionItems({
    bookingRequests: 2,
    overdueInvoices: 1,
    unsentInvoices: 0,
    lowStock: 3,
    unassignedToday: 1,
  });

  assert.deepEqual(
    items.map((item) => item.label),
    [
      "2 booking requests",
      "1 overdue invoice",
      "1 job today with nobody assigned",
      "3 parts running low",
    ],
  );
  assert.equal(items[0]!.href, "/booking-requests");
  assert.equal(items[1]!.urgent, true);
  // Low stock is worth knowing and is not an emergency.
  assert.equal(items[3]!.urgent, undefined);
});

test("money and customers come before housekeeping", () => {
  const items = attentionItems({
    bookingRequests: 1,
    overdueInvoices: 1,
    unsentInvoices: 1,
    lowStock: 1,
    unassignedToday: 0,
  });

  assert.ok(items.findIndex((item) => item.urgent) < items.findIndex((item) => !item.urgent));
});

test("the greeting follows the business's own clock", () => {
  assert.equal(greeting(6), "Good morning");
  assert.equal(greeting(11), "Good morning");
  assert.equal(greeting(12), "Good afternoon");
  assert.equal(greeting(16), "Good afternoon");
  assert.equal(greeting(17), "Good evening");
  assert.equal(greeting(23), "Good evening");
  assert.equal(greeting(Number.NaN), "Hello");
});

test("somebody is greeted by name, never by an email address", () => {
  // "Good morning, adamkane13.ak@gmail.com" is what makes software feel like
  // software.
  assert.equal(firstName("Nick Kane"), "Nick");
  assert.equal(firstName("", "dana.harper@example.com"), "Dana");
  assert.equal(firstName("dana@example.com", "dana@example.com"), "Dana");
});

test("an unusable name greets nobody rather than something wrong", () => {
  // A local part with digits in it is an identifier, and a greeting is better
  // dropped than made up.
  assert.equal(firstName("", "adamkane13.ak@gmail.com"), "");
  assert.equal(firstName("", ""), "");
  assert.equal(firstName("   ", "  "), "");
});

test("times sort by the clock, not alphabetically", () => {
  // "11:00 AM" < "2:00 PM" < "8:00 AM" as text, which would put the afternoon
  // job at the top of the day and name the wrong one as next.
  assert.ok(minutesFromLabel("8:00 AM") < minutesFromLabel("11:00 AM"));
  assert.ok(minutesFromLabel("11:00 AM") < minutesFromLabel("2:00 PM"));
});

test("noon and midnight are not off by twelve hours", () => {
  assert.equal(minutesFromLabel("12:00 AM"), 0);
  assert.equal(minutesFromLabel("12:30 PM"), 12 * 60 + 30);
  assert.equal(minutesFromLabel("1:00 PM"), 13 * 60);
});

test("an unreadable time sorts last, not to midnight", () => {
  // Otherwise a malformed value claims to be the first job of the morning.
  assert.equal(minutesFromLabel(""), Number.MAX_SAFE_INTEGER);
  assert.equal(minutesFromLabel("half seven"), Number.MAX_SAFE_INTEGER);
  assert.equal(minutesFromLabel("25:00 AM"), Number.MAX_SAFE_INTEGER);
});

test("a booking request that has been dealt with stops asking for attention", () => {
  // A text booking accepted on Monday, turned into a job and marked
  // `scheduled`, still read as "1 booking request" in amber on Friday — and
  // the requests page showed a Scheduled badge rather than buttons, so there
  // was nothing left to press to clear it.
  assert.equal(openBookingRequests([{ status: "scheduled" }]), 0);
  assert.equal(openBookingRequests([{ status: "dismissed" }]), 0);
  assert.equal(openBookingRequests([{ status: "new" }]), 1);
});

test("only the new ones are counted, out of a mixed list", () => {
  assert.equal(
    openBookingRequests([
      { status: "new" },
      { status: "scheduled" },
      { status: "new" },
      { status: "dismissed" },
    ]),
    2,
  );
});

test("a missing or empty request list is nothing to do, not a crash", () => {
  assert.equal(openBookingRequests([]), 0);
  assert.equal(openBookingRequests(undefined as unknown as { status: string }[]), 0);
  // An unrecognised status is not new, so it does not nag. A status this code
  // has never heard of has still been through something.
  assert.equal(openBookingRequests([{ status: "" }]), 0);
});
