import test from "node:test";
import assert from "node:assert/strict";

import {
  isJobCategory,
  JOB_CATEGORIES,
  parseCostToCents,
  parseNewJob,
  splitName,
  type NewJobRaw,
} from "./new-job-input.ts";

const raw = (over: Partial<NewJobRaw> = {}): NewJobRaw => ({
  customerName: "Dana Harper",
  phone: "209-626-9313",
  email: "",
  addressLine1: "994 Red Gum Lane",
  city: "Nipomo",
  state: "CA",
  postalCode: "93444",
  category: "panel_breaker",
  description: "Panel is buzzing.",
  startLocal: "2026-08-18T08:00",
  durationHours: "2",
  cost: "1280",
  ...over,
});

test("a whole job is read out of the form", () => {
  const result = parseNewJob(raw());

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.customerName, "Dana Harper");
  // Stored as a carrier would take it, never as typed.
  assert.equal(result.value.phone, "+12096269313");
  assert.deepEqual(result.value.address, {
    line1: "994 Red Gum Lane",
    city: "Nipomo",
    state: "CA",
    postalCode: "93444",
  });
  assert.equal(result.value.category, "panel_breaker");
  assert.equal(result.value.durationMinutes, 120);
  assert.equal(result.value.costCents, 128_000);
});

test("money is read the way an electrician writes it", () => {
  assert.equal(parseCostToCents("1280"), 128_000);
  assert.equal(parseCostToCents("$1,280.00"), 128_000);
  assert.equal(parseCostToCents("1280.5"), 128_050);
  assert.equal(parseCostToCents(" $950 "), 95_000);
  assert.equal(parseCostToCents("0.99"), 99);
});

test("no cost means no invoice, and a typo means no job", () => {
  // Zero is a real answer. A misread figure quietly becoming a free job is the
  // expensive kind of silent failure, so it has to be refused instead.
  assert.equal(parseCostToCents(""), 0);
  assert.equal(parseCostToCents("   "), 0);

  assert.equal(parseCostToCents("twelve hundred"), null);
  assert.equal(parseCostToCents("1280.999"), null);
  assert.equal(parseCostToCents("-500"), null);
  assert.equal(parseCostToCents("."), null);
  assert.equal(parseCostToCents("12,80,0.0.0"), null);
});

test("a cost that cannot be read stops the whole job", () => {
  const result = parseNewJob(raw({ cost: "about a grand" }));

  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /cost could not be read/);
});

test("a customer with no way to reach them is refused", () => {
  // Without either, nothing in this app can ever tell them their appointment
  // moved — the job would be a note in a system that believes it notifies.
  const result = parseNewJob(raw({ phone: "", email: "" }));

  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /phone number or an email/);
});

test("either contact method alone is enough", () => {
  assert.equal(parseNewJob(raw({ phone: "", email: "dana@example.com" })).ok, true);
  assert.equal(parseNewJob(raw({ email: "" })).ok, true);
});

test("an unreadable phone number is refused rather than stored unusable", () => {
  // Storing "555-CALL-NOW" would make every future text silently fail.
  const result = parseNewJob(raw({ phone: "555-CALL-NOW" }));

  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /could not be read/);
});

test("a half-typed address is caught here, not by the database", () => {
  // properties requires street, city, state and ZIP. Letting a partial address
  // through means a constraint violation nobody in a van can act on.
  const result = parseNewJob(raw({ postalCode: "" }));

  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /street, city, state, and ZIP/);
});

test("no address at all is allowed", () => {
  // A quoted job booked over the phone often has no address yet.
  const result = parseNewJob(
    raw({ addressLine1: "", city: "", state: "", postalCode: "" }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.ok === true ? result.value.address : undefined, null);
});

test("a nameless customer is refused", () => {
  const result = parseNewJob(raw({ customerName: "   " }));

  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /customer name/);
});

test("an unknown kind of work is refused, and a blank one defaults", () => {
  assert.equal(parseNewJob(raw({ category: "" })).ok, true);
  const defaulted = parseNewJob(raw({ category: "" }));
  assert.equal(defaulted.ok === true ? defaulted.value.category : "", "diagnostic");

  const bogus = parseNewJob(raw({ category: "'; drop table jobs; --" }));
  assert.equal(bogus.ok, false);
});

test("every offered category is one the parser accepts", () => {
  // The dropdown and the validator drifting apart would be a form that refuses
  // its own options.
  for (const entry of JOB_CATEGORIES) {
    assert.ok(isJobCategory(entry.value), `${entry.value} should be valid`);
    assert.equal(parseNewJob(raw({ category: entry.value })).ok, true);
  }
});

test("visit length is bounded at both ends", () => {
  assert.equal(parseNewJob(raw({ durationHours: "0" })).ok, false);
  assert.equal(parseNewJob(raw({ durationHours: "-2" })).ok, false);
  assert.equal(parseNewJob(raw({ durationHours: "13" })).ok, false);
  assert.equal(parseNewJob(raw({ durationHours: "abc" })).ok, false);

  const blank = parseNewJob(raw({ durationHours: "" }));
  assert.equal(blank.ok === true ? blank.value.durationMinutes : 0, 120);

  const half = parseNewJob(raw({ durationHours: "1.5" }));
  assert.equal(half.ok === true ? half.value.durationMinutes : 0, 90);
});

test("a bad email address is refused", () => {
  assert.equal(parseNewJob(raw({ email: "dana@" })).ok, false);
  assert.equal(parseNewJob(raw({ email: "dana at example.com" })).ok, false);
  assert.equal(parseNewJob(raw({ email: "dana@example.com" })).ok, true);
});

test("a name is split into the two columns the table has", () => {
  assert.deepEqual(splitName("Dana Harper"), { firstName: "Dana", lastName: "Harper" });
  // One field to a human, two to the database — and a surname with spaces in
  // it must survive the trip.
  assert.deepEqual(splitName("Mary Jo Van Der Berg"), {
    firstName: "Mary",
    lastName: "Jo Van Der Berg",
  });
  assert.deepEqual(splitName("Cher"), { firstName: "Cher", lastName: "" });
  assert.deepEqual(splitName("   "), { firstName: "", lastName: "" });
});

test("stray whitespace does not become part of the record", () => {
  const result = parseNewJob(
    raw({ customerName: "  Dana   Harper  ", city: " Nipomo " }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.customerName, "Dana Harper");
  assert.equal(result.value.address?.city, "Nipomo");
});
