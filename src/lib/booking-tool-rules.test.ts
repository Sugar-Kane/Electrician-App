import test from "node:test";
import assert from "node:assert/strict";

import {
  BOOKING_TOOLS,
  INTAKE_QUESTIONS,
  MINIMUM_INTAKE_ANSWERS,
  buildDecision,
  callerEmail,
  callerPhone,
  customerWords,
  deliveryPreference,
  describeOutcome,
  intakeAnswers,
  intakeShortfall,
  slotList,
} from "./booking-tool-rules.ts";
import { decideIntakeAction, type IntakeContext } from "./sms-intake.ts";

const SLOT = {
  start: "2026-08-11T15:00:00+00:00",
  end: "2026-08-11T17:00:00+00:00",
  label: "Tue Aug 11, 8:00-10:00 AM",
};

const CONTEXT: IntakeContext = {
  businessName: "Volterra Electric",
  businessPhone: "(805) 555-0142",
  offeredSlots: [SLOT],
  diagnosticFee: "$95",
  diagnosticFeeCents: 9500,
  serviceArea: "50 miles of the shop",
  nowLabel: "Sunday, August 9, 6:28 PM",
  isFirstReply: false,
};

/** The whole chain a tool call goes through, minus the database. */
function run(name: string, args: Record<string, unknown>, context = CONTEXT) {
  const decision = buildDecision(name, args);
  assert.ok(decision, `${name} should propose something`);
  const action = decideIntakeAction({
    decision,
    customerText: customerWords(args),
    context,
  });
  return { action, result: describeOutcome({ name, action, context, phone: "+18055550142" }) };
}

const BOOKABLE = {
  contact_name: "Dana Reyes",
  description: "The kitchen outlets stopped working after the breaker tripped.",
  address_line_1: "18 Palm Street",
  city: "Santa Maria",
  postal_code: "93454",
  slot_start: SLOT.start,
  urgency: "routine",
};

/** A booking that has been through the whole conversation. */
const COMPLETE = {
  ...BOOKABLE,
  caller_phone: "209-819-9985",
  caller_email: "",
  answer_scope: "Just the kitchen.",
  answer_onset: "Started last night, nothing changed.",
  answer_breaker: "One breaker tripped and it will not reset.",
  answer_property: "",
  answer_access: "",
  caller_confirmed: "yes",
  delivery_preference: "both",
};

test("a booking is refused until the customer actually says yes", () => {
  // The failure that started this: she booked without ever asking.
  const refusal = intakeShortfall({ ...COMPLETE, caller_confirmed: "no" });
  assert.match(refusal, /^NOT BOOKED/);
  assert.match(refusal, /go ahead and book/i);
});

test("a booking is refused until the intake questions were actually asked", () => {
  const refusal = intakeShortfall({ ...COMPLETE, answer_onset: "", answer_breaker: "" });
  assert.match(refusal, /^NOT BOOKED/);
  assert.match(refusal, new RegExp(String(MINIMUM_INTAKE_ANSWERS)));
  assert.match(refusal, /get_intake_questions/);
});

test("a question with no answer is not an answer", () => {
  // Otherwise the model can satisfy the gate by sending whitespace back.
  const blank = { ...COMPLETE, answer_scope: "  ", answer_onset: " ", answer_breaker: "" };
  assert.deepEqual(intakeAnswers(blank), []);
  assert.match(intakeShortfall(blank), /^NOT BOOKED/);
});

test("a booking is refused until they have said how to send the link", () => {
  const refusal = intakeShortfall({ ...COMPLETE, delivery_preference: "carrier pigeon" });
  assert.match(refusal, /text, email, or both/i);
});

test("a complete conversation passes the gate", () => {
  assert.equal(intakeShortfall(COMPLETE), "");
  assert.equal(intakeAnswers(COMPLETE).length, 3);
  assert.equal(deliveryPreference(COMPLETE), "both");
});

test("the booking result tells her to say the deposit and what happens next", () => {
  const decision = buildDecision("book_visit", COMPLETE)!;
  const action = decideIntakeAction({ decision, customerText: "no power", context: CONTEXT });
  const result = describeOutcome({
    name: "book_visit",
    action,
    context: CONTEXT,
    phone: "+12098199985",
    deliveryPreference: "both",
  });

  assert.match(result.text, /\$95 deposit/);
  assert.match(result.text, /call you later today/i);
  assert.match(result.text, /by text and email/);
  assert.match(result.text, /do not take card details/i);
});

test("every intake answer is a flat string, never a nested object", () => {
  // A nested schema is the thing a tool API is most likely to reject, and a
  // rejected tool is a silent failure: the model simply stops having it.
  const tool = BOOKING_TOOLS.find((candidate) => candidate.name === "book_visit")!;
  const properties = tool.inputSchema.properties as Record<string, { type: string }>;

  for (const [name, schema] of Object.entries(properties)) {
    assert.equal(schema.type, "string", `${name} is ${schema.type}`);
  }
  for (const entry of INTAKE_QUESTIONS) {
    assert.ok(properties[`answer_${entry.key}`], entry.key);
  }
});

test("the questions are the business's, and short enough to ask out loud", () => {
  assert.ok(INTAKE_QUESTIONS.length >= MINIMUM_INTAKE_ANSWERS);
  assert.ok(INTAKE_QUESTIONS.length <= 6, "a phone call, not an interrogation");
  for (const entry of INTAKE_QUESTIONS) {
    assert.ok(entry.question.endsWith("?"), entry.question);
  }
});

test("a complete booking into an offered window is booked", () => {
  const { action, result } = run("book_visit", BOOKABLE);

  assert.equal(action.kind, "book");
  assert.equal(result.isError, undefined);
  assert.match(result.text, /Booked: Tue Aug 11, 8:00-10:00 AM/);
  assert.match(result.text, /18 Palm Street/);
});

test("a window the model invented is refused, and the real ones are handed back", () => {
  // The failure that matters most: a model that promises a time nobody has.
  const { action, result } = run("book_visit", {
    ...BOOKABLE,
    slot_start: "2026-08-11T09:00:00+00:00",
  });

  assert.equal(action.kind, "ask");
  assert.equal(result.isError, true);
  assert.match(result.text, /^NOT BOOKED\./);
  assert.match(result.text, /slot_start: 2026-08-11T15:00:00\+00:00/);
});

test("an ordinary water heater call is bookable", () => {
  const { action } = run("book_visit", {
    ...BOOKABLE,
    description: "The water heater element needs replacing.",
  });
  assert.equal(action.kind, "book");
});

test("a booking with no street address asks for one instead", () => {
  const { result } = run("book_visit", { ...BOOKABLE, address_line_1: "", city: "" });

  assert.equal(result.isError, true);
  assert.match(result.text, /^NOT BOOKED\./);
  assert.match(result.text, /street address/i);
});

test("an urgent callback is described as urgent to the model", () => {
  const { result } = run("request_callback", {
    contact_name: "Dana Reyes",
    description: "Half the house has no power and I need someone today.",
    urgency: "urgent",
  });

  assert.match(result.text, /as soon as possible/);
  assert.match(result.text, /Do not promise a specific time/);
});

test("with nothing open the model is told to take a callback, not to improvise", () => {
  const empty = { ...CONTEXT, offeredSlots: [] };
  assert.match(slotList(empty), /request_callback/);
  assert.doesNotMatch(slotList(empty), /slot_start/);
});

test("the open windows are listed with the exact value needed to book them", () => {
  const listed = slotList(CONTEXT);
  assert.match(listed, /Tue Aug 11, 8:00-10:00 AM/);
  assert.match(listed, /slot_start: 2026-08-11T15:00:00\+00:00/);
  assert.match(listed, /\$95/);
});

test("every refusal says so before it says anything else", () => {
  // A model skimming the first line must never read a refusal as a booking.
  for (const args of [
    { ...BOOKABLE, slot_start: "made up" },
    { ...BOOKABLE, address_line_1: "", city: "" },
  ]) {
    const { result } = run("book_visit", args);
    assert.ok(result.text.startsWith("NOT BOOKED"), result.text);
  }
});

test("the caller's number is asked for, since one URL serves every call", () => {
  // A console-configured MCP server is static, so the caller has to be named.
  for (const name of ["book_visit", "request_callback"]) {
    const tool = BOOKING_TOOLS.find((candidate) => candidate.name === name)!;
    const required = tool.inputSchema.required as string[];
    assert.ok(required.includes("caller_phone"), name);
  }

  assert.equal(callerPhone({ caller_phone: " +1 805 555 0142 " }), "+1 805 555 0142");
  assert.equal(callerPhone({}), "");
});

test("the schema asks for little and the server enforces the rest", () => {
  // The connector went silent when `required` grew to ten entries. Enforcement
  // lives in intakeShortfall, which refuses in words the model can act on.
  const tool = BOOKING_TOOLS.find((candidate) => candidate.name === "book_visit")!;
  const required = tool.inputSchema.required as string[];

  assert.ok(required.length <= 6, `${required.length} required properties`);
  for (const optional of ["caller_email", "caller_confirmed", "delivery_preference", "answer_scope"]) {
    assert.ok(!required.includes(optional), `${optional} should not be required`);
  }
  assert.match(tool.description, /how they want their booking link/i);
});

test("both spellings of a yes are accepted", () => {
  // The schema says "yes"; a model that sends a real boolean is still right.
  assert.equal(intakeShortfall({ ...COMPLETE, caller_confirmed: "yes" }), "");
  assert.equal(intakeShortfall({ ...COMPLETE, caller_confirmed: true }), "");
  assert.match(intakeShortfall({ ...COMPLETE, caller_confirmed: "maybe" }), /^NOT BOOKED/);
});

test("declining the email does not block the booking", () => {
  const { action } = run("book_visit", { ...BOOKABLE, caller_email: "" });
  assert.equal(action.kind, "book");
  assert.equal(callerEmail({ caller_email: "  adam@gmail.com " }), "adam@gmail.com");
  assert.equal(callerEmail({}), "");
});

test("list_open_slots proposes nothing, so it can never write", () => {
  assert.equal(buildDecision("list_open_slots", {}), null);
  assert.equal(buildDecision("something_else", {}), null);
});

test("every tool takes an object and refuses arguments it does not know", () => {
  for (const tool of BOOKING_TOOLS) {
    assert.equal(tool.inputSchema.type, "object", tool.name);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.ok(Array.isArray(tool.inputSchema.required), tool.name);
  }
});

test("no tool lets the model name the business or the customer", () => {
  // Those come from the signed URL. If they were arguments, a customer's own
  // words could talk the model into booking against another tenant.
  const forbidden = /organization|tenant|customer_id|business/i;
  for (const tool of BOOKING_TOOLS) {
    const properties = Object.keys(
      (tool.inputSchema.properties as Record<string, unknown>) ?? {},
    );
    for (const property of properties) {
      assert.doesNotMatch(property, forbidden, `${tool.name}.${property}`);
    }
  }
});
