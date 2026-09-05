import test from "node:test";
import assert from "node:assert/strict";

import { callRecordProvenance, callRecordTitle, readCallRecord } from "./call-record.ts";

/**
 * The row a real call left behind, copied from production.
 *
 * A Spanish-language call on 2026-08-26: whole house with no power, flagged
 * urgent, booked for the next morning. The answers are her words as the
 * receptionist heard them, which is exactly the thing the panel exists to show
 * and the thing no test written from imagination would have got right.
 */
const CALL = {
  communication_channel: "phone",
  created_by: "ai",
  created_at: "2026-08-26T20:18:51.853Z",
  description: "No tengo electricidad. Afecta a toda la casa.",
  urgency: "urgent",
  arrival_window_start: "2026-08-27T15:00:00+00:00",
  arrival_window_end: "2026-08-27T17:00:00+00:00",
  deposit_cents: 18000,
  intake_answers: [
    { question: "Is this affecting the whole house, one room, or a single outlet or fixture?", answer: "Toda la casa" },
    { question: "When did it start, and did anything change just before — a new appliance, a storm, or work done?", answer: "No" },
    { question: "Have you looked at the breaker panel? Is anything tripped, and does it reset?", answer: "No" },
    { question: "Is this a house, a condo, or a commercial space, and roughly how old is the building?", answer: "Casa de unos cinco años" },
    { question: "Is there anything the electrician needs to get in — a gate code, a dog, parking, or someone home?", answer: "No" },
  ],
};

test("a real call reads back with everything an electrician needs before driving out", () => {
  const record = readCallRecord(CALL)!;

  assert.equal(record.channel, "phone");
  assert.equal(record.byReceptionist, true);
  assert.equal(record.urgency, "urgent");
  assert.equal(record.said, "No tengo electricidad. Afecta a toda la casa.");
  assert.equal(record.answers.length, 5);
  assert.equal(record.feeCents, 18000);
  assert.deepEqual(record.window, {
    start: "2026-08-27T15:00:00+00:00",
    end: "2026-08-27T17:00:00+00:00",
  });

  // Her words, not a translation and not a paraphrase.
  assert.equal(record.answers[3].answer, "Casa de unos cinco años");
});

test("the panel says where the words came from, and does not say transcript", () => {
  const record = readCallRecord(CALL)!;

  const title = callRecordTitle(record);
  const provenance = callRecordProvenance(record);

  // The panel is the receptionist's structured notes, not a transcript. The
  // actual audio is shown separately on the customer profile when available.
  assert.doesNotMatch(title, /transcript|recording/i);
  assert.doesNotMatch(provenance, /transcript/i);
  assert.doesNotMatch(provenance, /no recording/i);
  assert.match(provenance, /written down by the receptionist/i);
  assert.match(title, /said on the call/);
});

test("an unanswered question is dropped rather than shown blank", () => {
  // Three questions asked of five reads as three, not as five with two silences.
  const record = readCallRecord({
    ...CALL,
    intake_answers: [
      { question: "Whole house?", answer: "Yes" },
      { question: "When did it start?", answer: "" },
      { question: "Breaker tripped?", answer: "   " },
      { question: "", answer: "orphan" },
    ],
  })!;

  assert.equal(record.answers.length, 1);
  assert.equal(record.answers[0].question, "Whole house?");
});

test("a job with nothing behind it offers nothing to open", () => {
  // A job typed in by hand. A disclosure onto an empty box is worse than none.
  assert.equal(readCallRecord({ communication_channel: "manual", description: "" }), null);
  assert.equal(readCallRecord(null), null);
  assert.equal(readCallRecord("nonsense"), null);
  assert.equal(readCallRecord({ intake_answers: [] }), null);

  // A description on its own is still worth opening: it is the customer's words.
  assert.ok(readCallRecord({ description: "Kitchen outlets dead", intake_answers: [] }));
});

test("each channel is named as itself", () => {
  const of = (row: Record<string, unknown>) => readCallRecord({ ...CALL, ...row })!;

  assert.match(callRecordTitle(of({ communication_channel: "sms" })), /over text/);
  assert.match(callRecordTitle(of({ communication_channel: "web" })), /filled in/);
  assert.match(callRecordProvenance(of({ communication_channel: "web" })), /booking page/);

  // A phone call somebody in the office typed up is not the receptionist's, and
  // must not carry its "written down during the call" claim.
  const byHand = of({ communication_channel: "phone", created_by: "staff" });
  assert.equal(byHand.byReceptionist, false);
  assert.doesNotMatch(callRecordProvenance(byHand), /receptionist/);

  // An unknown channel falls to manual rather than rendering a raw column value.
  assert.equal(of({ communication_channel: "carrier-pigeon" }).channel, "manual");
});

test("a fee or a window that is not there is not invented", () => {
  const bare = readCallRecord({
    description: "Lights flickering",
    intake_answers: [],
    arrival_window_start: "2026-08-27T15:00:00+00:00",
    arrival_window_end: null,
  })!;

  // Half a window is no window. Rendering one end of it would show a time
  // nobody agreed to.
  assert.equal(bare.window, null);
  assert.equal(bare.feeCents, 0);
  assert.equal(bare.urgency, "routine");
});
