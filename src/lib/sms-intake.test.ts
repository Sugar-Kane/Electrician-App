import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIntakeSystemPrompt,
  composeReply,
  decideIntakeAction,
  detectHazards,
  INTAKE_TOOLS,
  splitName,
  type IntakeContext,
} from "./sms-intake.ts";

const context = (overrides: Partial<IntakeContext> = {}): IntakeContext => ({
  businessName: "Pacific Plains Electric",
  businessPhone: "(805) 555-0100",
  offeredSlots: [
    { start: "2026-08-11T15:00:00.000Z", end: "2026-08-11T17:00:00.000Z", label: "Tue Aug 11, 8:00-10:00 AM" },
    { start: "2026-08-11T20:00:00.000Z", end: "2026-08-11T22:00:00.000Z", label: "Tue Aug 11, 1:00-3:00 PM" },
  ],
  diagnosticFee: "$149",
  serviceArea: "the Central Coast",
  isFirstReply: false,
  ...overrides,
});

const decide = (tool: string, input: Record<string, unknown>, customerText = "my outlet stopped working") =>
  decideIntakeAction({ decision: { tool, input }, customerText, context: context() });

test("a hazard in the customer's own words is caught without the model", () => {
  assert.deepEqual(detectHazards("theres smoke coming from the panel"), ["active_fire_or_smoke"]);
  assert.deepEqual(detectHazards("my son got shocked by the outlet"), ["shock_injury"]);
  assert.deepEqual(detectHazards("power line is down across my driveway"), ["downed_power_line"]);
  assert.deepEqual(detectHazards("water is coming into the breaker box"), ["water_touching_electrical"]);
  assert.deepEqual(detectHazards("my kitchen outlet stopped working"), []);
});

test("a hazard overrides a booking the model wanted to make", () => {
  // The dangerous case: a customer describes a fire *and* asks for an
  // appointment. Booking a visit for Tuesday is the wrong answer on Saturday
  // night, whatever the model decided.
  const action = decideIntakeAction({
    decision: {
      tool: "confirm_visit",
      input: {
        contact_name: "Ada Lovelace",
        description: "panel is smoking",
        address_line_1: "123 Maple St",
        city: "Santa Maria",
        postal_code: "93454",
        slot_start: "2026-08-11T15:00:00.000Z",
        urgency: "urgent",
      },
    },
    customerText: "the panel is smoking, can someone come Tuesday",
    context: context(),
  });

  assert.equal(action.kind, "escalate");
  assert.match(action.reply, /911/);
  assert.deepEqual(action.kind === "escalate" ? action.hazards : [], ["active_fire_or_smoke"]);
});

test("an emergency reply never offers to book", () => {
  const action = decideIntakeAction({
    decision: null,
    customerText: "wire is down in the yard",
    context: context(),
  });
  assert.equal(action.kind, "escalate");
  assert.doesNotMatch(action.reply, /book|schedule|appointment/i);
});

test("a window the model invented is refused", () => {
  // The scheduler is the only source of truth for what is open. A made-up time
  // is a promise the business never agreed to.
  const action = decide("confirm_visit", {
    contact_name: "Ada",
    description: "no power in the kitchen",
    address_line_1: "123 Maple St",
    city: "Santa Maria",
    postal_code: "93454",
    slot_start: "2026-08-12T09:00:00.000Z",
    urgency: "routine",
  });

  assert.equal(action.kind, "ask");
  assert.match(action.reply, /Tue Aug 11, 8:00-10:00 AM/);
});

test("a real window books, and carries the address through", () => {
  const action = decide("confirm_visit", {
    contact_name: "Ada Lovelace",
    description: "no power in the kitchen",
    address_line_1: "123 Maple St",
    city: "Santa Maria",
    postal_code: "93454",
    slot_start: "2026-08-11T20:00:00.000Z",
    urgency: "routine",
  });

  assert.equal(action.kind, "book");
  if (action.kind !== "book") return;
  assert.equal(action.slot.label, "Tue Aug 11, 1:00-3:00 PM");
  assert.equal(action.address.city, "Santa Maria");
  assert.match(action.reply, /booked for Tue Aug 11, 1:00-3:00 PM/i);
});

test("a booking without an address is sent back for the address", () => {
  const action = decide("confirm_visit", {
    contact_name: "Ada",
    description: "no power",
    address_line_1: "",
    city: "",
    postal_code: "",
    slot_start: "2026-08-11T15:00:00.000Z",
    urgency: "routine",
  });
  assert.equal(action.kind, "ask");
  assert.match(action.reply, /address/i);
});

test("proposing a window books nothing", () => {
  const action = decide("propose_visit", {
    contact_name: "Ada",
    description: "no power in the kitchen",
    address_line_1: "123 Maple St",
    city: "Santa Maria",
    postal_code: "93454",
    slot_start: "2026-08-11T15:00:00.000Z",
    urgency: "routine",
  });
  assert.equal(action.kind, "propose");
  assert.match(action.reply, /Reply YES/);
  assert.match(action.reply, /\$149/);
});

test("a callback is the answer when there is no address", () => {
  const action = decide("request_callback", {
    contact_name: "Ada",
    description: "wants a quote for a panel upgrade",
    urgency: "routine",
  });
  assert.equal(action.kind, "callback");
  assert.match(action.reply, /call you back/i);
});

test("an unknown tool falls through to a human rather than guessing", () => {
  const action = decide("book_everything", { contact_name: "Ada" }, "please just fix it");
  assert.equal(action.kind, "callback");
});

test("no model output at all still answers the customer", () => {
  const action = decideIntakeAction({
    decision: null,
    customerText: "hello?",
    context: context(),
  });
  assert.equal(action.kind, "ask");
  assert.match(action.reply, /electrical problem/i);
});

test("replies fit in two segments and carry the opt-out only on the first", () => {
  const long = "x".repeat(500);
  const first = composeReply(long, context({ isFirstReply: true }));
  assert.ok(first.length <= 300, `first reply was ${first.length} characters`);
  assert.match(first, /Reply STOP to opt out\.$/);

  const later = composeReply("Short answer.", context());
  assert.equal(later, "Short answer.");
});

test("no reply contains a link", () => {
  // The A2P campaign was filed with embedded links unchecked; a link in an
  // automated reply is traffic that does not match the registration.
  const replies = [
    decide("request_callback", { contact_name: "Ada", description: "quote", urgency: "routine" }).reply,
    decide("propose_visit", {
      contact_name: "Ada", description: "no power", address_line_1: "1 A St",
      city: "Nipomo", postal_code: "93444", slot_start: "2026-08-11T15:00:00.000Z", urgency: "routine",
    }).reply,
    decideIntakeAction({ decision: null, customerText: "smoke", context: context() }).reply,
  ];
  for (const reply of replies) {
    assert.doesNotMatch(reply, /https?:\/\/|www\.|\.com/i, reply);
  }
});

test("the model is only ever shown windows that are really open", () => {
  const prompt = buildIntakeSystemPrompt(context());
  assert.match(prompt, /2026-08-11T15:00:00\.000Z/);
  assert.match(prompt, /Never invent or adjust a time/);
  assert.match(prompt, /escalate_emergency/);
});

test("an empty schedule says so rather than offering nothing", () => {
  const prompt = buildIntakeSystemPrompt(context({ offeredSlots: [] }));
  assert.match(prompt, /none available/);
});

test("every tool refuses arguments it did not declare", () => {
  // strict tool use is what keeps a malformed booking from reaching the
  // database; without additionalProperties:false the API stops enforcing it.
  for (const tool of INTAKE_TOOLS) {
    assert.equal(tool.strict, true, tool.name);
    assert.equal(tool.input_schema.additionalProperties, false, tool.name);
    assert.ok(tool.input_schema.required.length > 0, tool.name);
  }
});

test("names split into the columns customers actually has", () => {
  assert.deepEqual(splitName("Ada Lovelace"), { first: "Ada", last: "Lovelace" });
  assert.deepEqual(splitName("Ada"), { first: "Ada", last: "" });
  assert.deepEqual(splitName("  "), { first: "", last: "" });
});

test("an ordinary water heater call is not an emergency", () => {
  // "water" near an appliance name must not trip the electrical-contact rule,
  // or every water heater job becomes a 911 reply.
  assert.deepEqual(detectHazards("my water heater stopped heating"), []);
  assert.deepEqual(detectHazards("need a quote to move a water heater"), []);
  assert.deepEqual(detectHazards("the breaker box has water in it"), ["water_touching_electrical"]);
});
