import test from "node:test";
import assert from "node:assert/strict";

import {
  BOOKING_TOOLS,
  buildDecision,
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

test("a hazard in the description stops a booking the model wanted to make", () => {
  // The model called book_visit. The customer's own words say otherwise, and
  // the words win.
  const { action, result } = run("book_visit", {
    ...BOOKABLE,
    description: "There is water coming into the breaker box from the roof leak.",
  });

  assert.equal(action.kind, "escalate");
  assert.match(result.text, /^NOT BOOKED/);
  assert.match(result.text, /911/);
});

test("a callback about a burning smell is an emergency, not a callback", () => {
  const { action, result } = run("request_callback", {
    contact_name: "Dana Reyes",
    description: "There is a burning smell coming from the panel.",
    urgency: "routine",
  });

  assert.equal(action.kind, "escalate");
  assert.match(result.text, /911/);
});

test("an ordinary water heater call is still bookable", () => {
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

test("flag_emergency escalates on the model's word alone", () => {
  // No regex fires on this one. If the model says it is an emergency, it is.
  const { action, result } = run("flag_emergency", {
    description: "The customer says the meter enclosure is making a loud buzzing noise.",
  });

  assert.equal(action.kind, "escalate");
  assert.match(result.text, /911/);
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

test("a transfer nobody answered becomes a callback, not a dropped customer", () => {
  const { action, result } = run("transfer_to_person", {
    reason: "The caller wants to speak to Nick about a quote.",
  });

  assert.equal(action.kind, "callback");
  assert.equal(result.isError, true);
  assert.match(result.text, /^NOT TRANSFERRED/);
  assert.match(result.text, /could not put them through/);
});

test("a connected transfer says so and tells the model to stop talking", () => {
  const decision = buildDecision("transfer_to_person", { reason: "wants a person" })!;
  const action = decideIntakeAction({ decision, customerText: "wants a person", context: CONTEXT });
  const result = describeOutcome({
    name: "transfer_to_person",
    action,
    context: CONTEXT,
    phone: "+18055550142",
    transferred: true,
  });

  assert.equal(result.isError, undefined);
  assert.match(result.text, /Transferring now/);
});

test("a transfer request that describes a fire is an emergency first", () => {
  // Being put on hold for a transfer is the wrong thing to happen to someone
  // who needs to hang up and dial 911.
  const { action, result } = run("transfer_to_person", {
    reason: "There is smoke coming out of the panel and they want someone now.",
  });

  assert.equal(action.kind, "escalate");
  assert.match(result.text, /911/);
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
