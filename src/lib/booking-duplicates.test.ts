import test from "node:test";
import assert from "node:assert/strict";

import { duplicateGroups, hideRefusal, keepOne, type HideableBooking } from "./booking-duplicates.ts";

function booking(overrides: Partial<HideableBooking> = {}): HideableBooking {
  return {
    id: "b1",
    organizationId: "org-1",
    status: "new",
    phone: "+18055550142",
    email: "",
    createdAt: "2026-10-12T15:00:00Z",
    jobId: "",
    depositPaidAt: "",
    paymentIntentId: "",
    paymentCount: 0,
    archivedAt: "",
    duplicateReviewedAt: "",
    ...overrides,
  };
}

test("a request with a job, a payment, a deposit or a live payment link can't be hidden", () => {
  assert.match(hideRefusal(booking({ jobId: "j1" }))!, /became a job/);
  assert.match(hideRefusal(booking({ paymentCount: 1 }))!, /Money was taken/);
  assert.match(hideRefusal(booking({ depositPaidAt: "2026-10-12T15:05:00Z" }))!, /Money was taken/);
  assert.match(hideRefusal(booking({ paymentIntentId: "pi_1" }))!, /Money was taken/);
  assert.match(hideRefusal(booking({ status: "awaiting_payment" }))!, /payment link is out/);
  assert.match(hideRefusal(booking({ status: "confirmed" }))!, /booked/);
  assert.equal(hideRefusal(booking()), null);
});

test("keeping one hides the others only when none of them has work or money behind it", () => {
  const paid = booking({ id: "paid", paymentCount: 1, createdAt: "2026-10-12T14:00:00Z" });
  const repeat = booking({ id: "repeat", phone: "(805) 555-0142" });
  const [group] = duplicateGroups([paid, repeat]);
  assert.equal(group.length, 2);

  // Keeping the paid one hides the repeat.
  const keepPaid = keepOne(group, "paid");
  assert.ok(keepPaid.ok);
  assert.deepEqual(keepPaid.hide.map((entry) => entry.id), ["repeat"]);

  // Keeping the repeat would hide the paid one: refused, nothing hidden.
  const keepRepeat = keepOne(group, "repeat");
  assert.equal(keepRepeat.ok, false);
  assert.match(keepRepeat.ok ? "" : keepRepeat.refusal, /money was taken/i);

  const withJob = booking({ id: "job", jobId: "j1", createdAt: "2026-10-12T16:00:00Z" });
  const refusal = keepOne([repeat, withJob], "repeat");
  assert.equal(refusal.ok, false);
});

test("requests from another business are never grouped or hidden together", () => {
  const mine = booking({ id: "mine" });
  const theirs = booking({ id: "theirs", organizationId: "org-2" });
  assert.deepEqual(duplicateGroups([mine, theirs]), []);
  const crossed = keepOne([mine, theirs], "mine");
  assert.equal(crossed.ok, false);
  assert.match(crossed.ok ? "" : crossed.refusal, /another business/);
});

test("duplicates share a number or email inside the window, and stay apart once said to be different", () => {
  const first = booking({ id: "a", phone: "", email: "Sam@Example.com" });
  const second = booking({ id: "b", phone: "", email: "sam@example.com ", createdAt: "2026-10-14T15:00:00Z" });
  const late = booking({ id: "c", createdAt: "2026-10-20T15:00:00Z" });
  const stranger = booking({ id: "d", phone: "+18055550199" });
  assert.deepEqual(duplicateGroups([first, second, late, stranger]).map((group) => group.map((entry) => entry.id)), [["a", "b"]]);

  const reviewed = { duplicateReviewedAt: "2026-10-14T16:00:00Z" };
  assert.deepEqual(duplicateGroups([{ ...first, ...reviewed }, { ...second, ...reviewed }]), []);
  // A hidden request is never offered again.
  assert.deepEqual(duplicateGroups([first, { ...second, archivedAt: "2026-10-14T16:00:00Z" }]), []);
});
