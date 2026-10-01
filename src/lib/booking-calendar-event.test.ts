import test from "node:test";
import assert from "node:assert/strict";
import { paidCalendarEvent } from "./booking-calendar-event.ts";
const booking = { id: "booking", status: "scheduled", deposit_paid_at: "2026-09-30T01:00:00Z", created_job_id: "6f31578f-9413-4ac4-bfb1-b56a7467686f", arrival_window_start: "2026-09-30T15:00:00Z", arrival_window_end: "2026-09-30T17:00:00Z", contact_name: "Adam", city: "Santa Maria", description: "Add two mini-split circuits" };
test("only paid confirmed jobs enter Calendar", () => {
  assert.equal(paidCalendarEvent({ ...booking, deposit_paid_at: null }), null);
  assert.equal(paidCalendarEvent({ ...booking, status: "awaiting_payment" }), null);
  assert.equal(paidCalendarEvent({ ...booking, created_job_id: null }), null);
  assert.equal(paidCalendarEvent({ ...booking, status: "canceled" }), null);
});
test("retry event IDs are stable and valid for Google", () => {
  const first = paidCalendarEvent(booking)!;
  assert.deepEqual(first, paidCalendarEvent(booking));
  assert.match(first.id, /^[a-v0-9]{5,1024}$/);
  assert.equal(first.start.dateTime, "2026-09-30T15:00:00.000Z");
  assert.equal(first.end.dateTime, "2026-09-30T17:00:00.000Z");
  assert.match(first.summary, /paid/);
});
test("bad windows cannot create events", () => {
  assert.equal(paidCalendarEvent({ ...booking, arrival_window_end: booking.arrival_window_start }), null);
});
