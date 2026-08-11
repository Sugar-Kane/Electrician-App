import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIntakeSystemPrompt,
  composeReply,
  decideIntakeAction,
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
  diagnosticFeeCents: 14900,
  serviceArea: "the Central Coast",
  nowLabel: "Sunday, August 9, 6:28 PM",
  isFirstReply: false,
  ...overrides,
});

const decide = (tool: string, input: Record<string, unknown>, customerText = "my outlet stopped working") =>
  decideIntakeAction({ decision: { tool, input }, customerText, context: context() });

/**
 * The intake a customer has actually been through.
 *
 * Spread into a confirm_visit whenever a test is about something other than
 * whether the questions were asked — three answers and a delivery preference
 * are what a booking now requires, on this path as much as on the phone.
 */
const INTERVIEWED = {
  answer_scope: "Just the kitchen.",
  answer_onset: "Since last night.",
  answer_breaker: "One breaker tripped, will not reset.",
  delivery_preference: "text",
};

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
    ...INTERVIEWED,
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
    decideIntakeAction({ decision: null, customerText: "hello", context: context() }).reply,
  ];
  for (const reply of replies) {
    assert.doesNotMatch(reply, /https?:\/\/|www\.|\.com/i, reply);
  }
});

test("the model is only ever shown windows that are really open", () => {
  const prompt = buildIntakeSystemPrompt(context());
  assert.match(prompt, /2026-08-11T15:00:00\.000Z/);
  assert.match(prompt, /Never invent or adjust a time/);
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


test("a text booking is not made until the customer has been asked something", () => {
  // This is what the text path did for its whole life: a name, an address, a
  // window, and nothing else. The electrician arrived knowing the street and
  // one sentence, while the identical booking taken by phone arrived with the
  // scope, the breaker state and whether there was a dog.
  const action = decide("confirm_visit", {
    contact_name: "Ada Lovelace",
    description: "no power in the kitchen",
    address_line_1: "123 Maple St",
    city: "Santa Maria",
    postal_code: "93454",
    slot_start: "2026-08-11T20:00:00.000Z",
    urgency: "routine",
  });

  assert.equal(action.kind, "ask");
  // The remedy and the message are the same string over SMS: it asks the
  // question rather than reporting that a question is missing.
  assert.match(action.reply, /whole house, one room, or a single outlet/i);
});

test("the questions are asked one at a time, in order", () => {
  const first = decide("confirm_visit", {
    contact_name: "Ada", description: "no power", address_line_1: "1 A St",
    city: "Nipomo", postal_code: "93444",
    slot_start: "2026-08-11T20:00:00.000Z", urgency: "routine",
    answer_scope: "Just the kitchen.",
  });

  assert.equal(first.kind, "ask");
  // Scope answered, so onset is next — not a repeat and not all of them at
  // once. A text asking three things gets one answer.
  assert.match(first.reply, /When did it start/i);
  assert.doesNotMatch(first.reply, /breaker panel/i);
});

test("three answers is enough, and then the delivery question is the last gate", () => {
  const base = {
    contact_name: "Ada", description: "no power", address_line_1: "1 A St",
    city: "Nipomo", postal_code: "93444",
    slot_start: "2026-08-11T20:00:00.000Z", urgency: "routine",
    answer_scope: "Kitchen.", answer_onset: "Last night.", answer_breaker: "Tripped.",
  };

  const asksDelivery = decide("confirm_visit", base);
  assert.equal(asksDelivery.kind, "ask");
  assert.match(asksDelivery.reply, /text, email, or both/i);

  const booked = decide("confirm_visit", { ...base, delivery_preference: "email" });
  assert.equal(booked.kind, "book");
  if (booked.kind !== "book") return;
  assert.equal(booked.deliveryPreference, "email");
  assert.equal(booked.intakeAnswers.length, 3);
});

test("a blank answer is not an answer", () => {
  // A question with no answer is the shape of an interview, not one.
  const action = decide("confirm_visit", {
    contact_name: "Ada", description: "no power", address_line_1: "1 A St",
    city: "Nipomo", postal_code: "93444",
    slot_start: "2026-08-11T20:00:00.000Z", urgency: "routine",
    answer_scope: "  ", answer_onset: "", answer_breaker: "Tripped.",
    delivery_preference: "text",
  });

  assert.equal(action.kind, "ask");
});

test("an unrecognised delivery preference is not accepted as one", () => {
  const action = decide("confirm_visit", {
    contact_name: "Ada", description: "no power", address_line_1: "1 A St",
    city: "Nipomo", postal_code: "93444",
    slot_start: "2026-08-11T20:00:00.000Z", urgency: "routine",
    answer_scope: "Kitchen.", answer_onset: "Last night.", answer_breaker: "Tripped.",
    delivery_preference: "carrier pigeon",
  });

  assert.equal(action.kind, "ask");
  assert.match(action.reply, /text, email, or both/i);
});

test("proposing a window still needs no interview", () => {
  // The questions are owed before a job exists, not before a time can be
  // offered. Refusing to quote a window until five questions are answered
  // would make the assistant unusable.
  const action = decide("propose_visit", {
    contact_name: "Ada", description: "no power", address_line_1: "1 A St",
    city: "Nipomo", postal_code: "93444",
    slot_start: "2026-08-11T20:00:00.000Z", urgency: "routine",
  });

  assert.equal(action.kind, "propose");
});

test("the prompt tells the model what it will be held to", () => {
  // The gate refuses a booking that skipped the questions. If the prompt does
  // not carry them, the model cannot know what it is being refused for and the
  // conversation loops.
  const prompt = buildIntakeSystemPrompt(context());

  assert.match(prompt, /breaker panel/i);
  assert.match(prompt, /delivery_preference/);
  assert.match(prompt, /one question per message/i);
});
