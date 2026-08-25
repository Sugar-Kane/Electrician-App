import test from "node:test";
import assert from "node:assert/strict";

import {
  isJobCategory,
  jobCategoryLabel,
  JOB_CATEGORIES,
  MAX_COST_CENTS,
  parseCostToCents,
  parseNewJob,
  parseWorkOrderLines,
  splitName,
  workOrderTotalCents,
  type NewJobRaw,
} from "./new-job-input.ts";

const raw = (over: Partial<NewJobRaw> = {}): NewJobRaw => ({
  customerName: "Jane Doe",
  phone: "805-555-0142",
  email: "",
  addressLine1: "123 Main St",
  city: "Nipomo",
  state: "CA",
  postalCode: "93444",
  // A work order, so the two-hour diagnostic lock does not quietly override
  // whatever duration a test is about.
  category: "work_order",
  description: "Panel is buzzing.",
  startLocal: "2026-08-18T08:00",
  durationHours: "2",
  cost: "1280",
  mode: "save",
  workOrderLines: "",
  ...over,
});

test("a whole job is read out of the form", () => {
  const result = parseNewJob(raw());

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.customerName, "Jane Doe");
  // Stored as a carrier would take it, never as typed.
  assert.equal(result.value.phone, "+18055550142");
  assert.deepEqual(result.value.address, {
    line1: "123 Main St",
    city: "Nipomo",
    state: "CA",
    postalCode: "93444",
  });
  assert.equal(result.value.category, "work_order");
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

test("the figure that lost somebody a whole form is read fine", () => {
  // A million dollars with the decimal point tapped before the cents were.
  assert.equal(parseCostToCents("$1,000,000."), 100_000_000);
  assert.equal(parseCostToCents("1,000,000"), 100_000_000);
  assert.equal(parseCostToCents("1000000.00"), 100_000_000);
  // Non-breaking and narrow spaces, which is what a phone keyboard and a
  // spreadsheet paste actually produce.
  assert.equal(parseCostToCents("$1 280"), 128_000);
  assert.equal(parseCostToCents("1 280.50"), 128_050);
});

test("more decimals than money has are rounded, not refused", () => {
  assert.equal(parseCostToCents("1280.999"), 128_100);
  assert.equal(parseCostToCents("1280.994"), 128_099);
});

test("a cost bigger than the invoice columns is refused by name", () => {
  assert.equal(parseCostToCents(String(MAX_COST_CENTS / 100)), MAX_COST_CENTS);
  assert.equal(parseCostToCents("100000000"), null);

  const result = parseNewJob(raw({ cost: "100000000" }));
  assert.equal(result.ok, false);
  // Not the generic "could not be read" — it was read, and it is too big.
  assert.match(result.ok === false ? result.error : "", /larger than an invoice can hold/);
});

test("a diagnostic is two hours whatever the form posted", () => {
  // The field is locked on screen. A locked field is a courtesy, not a control.
  const result = parseNewJob(raw({ category: "diagnostic", durationHours: "0.5" }));

  assert.equal(result.ok, true);
  assert.equal(result.ok === true ? result.value.durationMinutes : 0, 120);
});

test("a work order keeps the hours it was given", () => {
  const result = parseNewJob(raw({ category: "work_order", durationHours: "6" }));
  assert.equal(result.ok === true ? result.value.durationMinutes : 0, 360);
});

test("a draft saves what there is so far", () => {
  // No way to reach them yet, and half an address. Both refuse a real save.
  const half = { phone: "", email: "", postalCode: "" };

  assert.equal(parseNewJob(raw({ ...half, mode: "save" })).ok, false);

  const draft = parseNewJob(raw({ ...half, mode: "draft" }));
  assert.equal(draft.ok, true);
  if (!draft.ok) return;
  assert.equal(draft.value.mode, "draft");
  assert.deepEqual(draft.value.address, {
    line1: "123 Main St",
    city: "Nipomo",
    state: "CA",
    postalCode: "",
  });
});

test("a draft still needs somebody to file it under", () => {
  const result = parseNewJob(raw({ customerName: "", mode: "draft" }));
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /customer name/);
});

test("an unknown mode is read as a real save, not as a draft", () => {
  // The mode arrives from a button in a form, so it is a claim like any other.
  const result = parseNewJob(raw({ phone: "", email: "", mode: "whatever" }));
  assert.equal(result.ok, false);
});

test("work order lines are read out of the field the form posts", () => {
  const lines = parseWorkOrderLines(
    JSON.stringify([
      { kind: "labor", description: "Pull new circuit", quantity: 3.5, unitPriceCents: 12_000 },
      { kind: "material", description: "20A breaker", quantity: 2, unit: "each", unitPriceCents: 4_200 },
    ]),
  );

  assert.equal(lines.length, 2);
  // Labour and parts default to the unit each is actually sold in.
  assert.equal(lines[0]?.unit, "hour");
  assert.equal(lines[1]?.unit, "each");
  assert.equal(workOrderTotalCents(lines), 3.5 * 12_000 + 2 * 4_200);
});

test("a half-typed line is dropped rather than losing the other eight", () => {
  const lines = parseWorkOrderLines(
    JSON.stringify([
      { kind: "labor", description: "Pull new circuit", quantity: 1, unitPriceCents: 12_000 },
      { kind: "labor", description: "", quantity: 1, unitPriceCents: 0 },
      { kind: "material", description: "Nothing of these", quantity: 0, unitPriceCents: 500 },
      { kind: "material", description: "Free offcut", quantity: 2 },
    ]),
  );

  assert.deepEqual(
    lines.map((line) => line.description),
    ["Pull new circuit", "Free offcut"],
  );
  // A part with no price is a part with no price, not a refusal.
  assert.equal(lines[1]?.unitPriceCents, 0);
});

test("nothing usable in the lines field comes back as no lines", () => {
  for (const raw of ["", "   ", "not json", "{}", "[]", '"a string"']) {
    assert.deepEqual(parseWorkOrderLines(raw), []);
  }
});

test("lines only come back for a work order", () => {
  const posted = JSON.stringify([
    { kind: "labor", description: "Pull new circuit", quantity: 1, unitPriceCents: 12_000 },
  ]);

  const order = parseNewJob(raw({ category: "work_order", workOrderLines: posted }));
  assert.equal(order.ok === true ? order.value.lines.length : 0, 1);

  // A diagnostic that somehow posted lines does not get them. The two hours are
  // the product; an itemised diagnostic is a different thing with the same name.
  const diagnostic = parseNewJob(raw({ category: "diagnostic", workOrderLines: posted }));
  assert.deepEqual(diagnostic.ok === true ? diagnostic.value.lines : null, []);
});

test("every kind of work a job has ever had still reads as English", () => {
  assert.equal(jobCategoryLabel("work_order"), "Work order");
  assert.equal(jobCategoryLabel("diagnostic"), "Diagnostic");
  // Booked before the list changed, or classified by the text assistant.
  assert.equal(jobCategoryLabel("ev_charger"), "EV charger");
  assert.equal(jobCategoryLabel("panel_breaker"), "Panel or breaker");
  // Something nobody planned for still reads as words rather than as a column.
  assert.equal(jobCategoryLabel("solar_tie_in"), "solar tie in");
  assert.equal(jobCategoryLabel(""), "Service");
});
