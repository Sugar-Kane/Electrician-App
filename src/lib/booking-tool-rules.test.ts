import test from "node:test";
import assert from "node:assert/strict";

import {
  BOOKING_TOOLS,
  buildDecision,
  callerEmail,
  callerPhone,
  customerWords,
  describeOutcome,
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
  serviceArea: "50 miles of the shop",
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

test("a booking cannot be made without the email question having been asked", () => {
  // Required so the model has to collect it rather than quietly skipping the
  // question — which is exactly what happened on the first live booking. An
  // empty answer is still an answer; the requirement is that they were asked.
  const tool = BOOKING_TOOLS.find((candidate) => candidate.name === "book_visit")!;
  assert.ok((tool.inputSchema.required as string[]).includes("caller_email"));
  assert.match(tool.description, /offered to email a confirmation/i);
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
