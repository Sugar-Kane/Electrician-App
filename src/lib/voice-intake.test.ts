import test from "node:test";
import assert from "node:assert/strict";

import { decideIntakeAction, type IntakeAction, type IntakeContext } from "./sms-intake.ts";
import {
  buildGreeting,
  decideVoiceStep,
  escapeXml,
  hangupTwiml,
  listenTwiml,
  MAX_FAILED_TURNS,
  RECORDING_NOTICE,
  spoken,
  transferTwiml,
  voiceInstructions,
  wantsHuman,
} from "./voice-intake.ts";

const context: IntakeContext = {
  businessName: "Pacific Plains Electric",
  businessPhone: "(805) 626-7761",
  offeredSlots: [
    { start: "2026-08-11T15:00:00.000Z", end: "2026-08-11T17:00:00.000Z", label: "Tue Aug 11, 8:00-10:00 AM" },
  ],
  diagnosticFee: "$100",
  diagnosticFeeCents: 10000,
  serviceArea: "the Central Coast",
  nowLabel: "Sunday, August 9, 6:28 PM",
  isFirstReply: false,
  language: "en",
  languageSource: "detected",
};

const action = (tool: string, input: Record<string, unknown>, callerText = "no power in the kitchen") =>
  decideIntakeAction({ decision: { tool, input }, customerText: callerText, context });

const step = (input: {
  action: IntakeAction;
  callerText: string;
  failedTurns?: number;
  canTransfer?: boolean;
}) =>
  decideVoiceStep({
    action: input.action,
    callerText: input.callerText,
    failedTurns: input.failedTurns ?? 0,
    canTransfer: input.canTransfer ?? true,
    context,
  });

test("every caller is told the call may be recorded, before they say anything", () => {
  // California is a two-party consent state. This line is not optional.
  const greeting = buildGreeting("Pacific Plains Electric");
  assert.match(greeting, /may be recorded/i);
  assert.ok(
    greeting.indexOf(RECORDING_NOTICE) < greeting.indexOf("What is the problem"),
    "the notice must come before the first question",
  );
});

test("asking for a person beats anything the model wanted to do", () => {
  for (const phrase of [
    "can I talk to a real person",
    "let me speak to Nick",
    "give me a human",
    "I want an operator",
  ]) {
    assert.equal(wantsHuman(phrase), true, phrase);
    const result = step({
      action: action("propose_visit", {
        contact_name: "Ada", description: "no power", address_line_1: "1 A St",
        city: "Nipomo", postal_code: "93444", slot_start: "2026-08-11T15:00:00.000Z", urgency: "routine",
      }),
      callerText: phrase,
    });
    assert.equal(result.kind, "transfer", phrase);
  }
});

test("ordinary answers are not mistaken for asking to escalate", () => {
  assert.equal(wantsHuman("no power in my kitchen"), false);
  assert.equal(wantsHuman("Tuesday morning works"), false);
  assert.equal(wantsHuman("my name is Nicola"), false);
});

test("with nobody to transfer to, the caller is promised a call back rather than dropped", () => {
  const result = step({
    action: action("ask_for", { missing: ["address"], question: "What is the address?" }),
    callerText: "I want to talk to a person",
    canTransfer: false,
  });
  assert.equal(result.kind, "hangup");
  assert.match(result.say, /call (you )?back/i);
});

test("a caller who is not being understood is handed over, not looped", () => {
  const asking = action("ask_for", { missing: ["address"], question: "What is the service address?" });

  assert.equal(step({ action: asking, callerText: "mumble", failedTurns: 0 }).kind, "listen");
  assert.equal(
    step({ action: asking, callerText: "mumble", failedTurns: MAX_FAILED_TURNS }).kind,
    "transfer",
  );
});

test("an offered window is read out and the call keeps listening", () => {
  const result = step({
    action: action("propose_visit", {
      contact_name: "Ada", description: "no power", address_line_1: "1 A St",
      city: "Nipomo", postal_code: "93444", slot_start: "2026-08-11T15:00:00.000Z", urgency: "routine",
    }),
    callerText: "no power in the kitchen at 1 A Street Nipomo",
  });
  assert.equal(result.kind, "listen");
  assert.match(result.say, /\$100/);
  assert.match(result.say, /book that/i);
});

test("a booked call says the time and hangs up", () => {
  const result = step({
    action: action("confirm_visit", {
      contact_name: "Ada", description: "no power", address_line_1: "1 A St",
      city: "Nipomo", postal_code: "93444", slot_start: "2026-08-11T15:00:00.000Z", urgency: "routine",
      // A booking now requires the interview on every path, so a call that
      // reaches confirm_visit has been through it.
      answer_scope: "Just the kitchen.", answer_onset: "Since last night.",
      answer_breaker: "One tripped, will not reset.", delivery_preference: "text",
    }, "yes please book it"),
    callerText: "yes please book it",
  });
  assert.equal(result.kind, "hangup");
  assert.match(result.say, /booked for/i);
});

test("times and abbreviations are turned into something speakable", () => {
  assert.equal(spoken("Tue Aug 11, 8:00-10:00 AM"), "Tue Aug 11, 8:00 to 10:00 A M");
  assert.equal(spoken("1:00-3:00 PM"), "1:00 to 3:00 P M");
});

test("anything the caller said is escaped before it becomes XML", () => {
  // A caller's words reach TwiML. Unescaped, a stray ampersand is a broken
  // call, and a stray tag is worse.
  assert.equal(escapeXml(`Bob & "Sons" <script>`), "Bob &amp; &quot;Sons&quot; &lt;script&gt;");

  const twiml = hangupTwiml('Booked for Bob & "Sons" <b>');
  assert.match(twiml, /Bob &amp; &quot;Sons&quot; &lt;b&gt;/);
  assert.doesNotMatch(twiml.replace(/<\/?(Response|Say|Hangup|\?xml)[^>]*>/g, ""), /<[a-z]/i);
});

test("the listen step always gives the caller a way out of silence", () => {
  const twiml = listenTwiml({ say: "What is the problem?", actionUrl: "https://x.test/api/twilio/voice?turn=2" });
  assert.match(twiml, /<Gather input="speech"/);
  assert.match(twiml, /speechTimeout="auto"/);
  assert.match(twiml, /action="https:\/\/x\.test\/api\/twilio\/voice\?turn=2"/);
  // Twilio falls through the Gather when nothing is said; without this the
  // caller sits on an open line listening to nothing.
  assert.match(twiml, /<Hangup\/>/);
});

test("an unanswered transfer becomes a callback rather than a dead line", () => {
  const twiml = transferTwiml({
    say: "Connecting you now.",
    to: "+18055550100",
    callerId: "+18056267761",
    actionUrl: "https://x.test/api/twilio/voice?step=after-dial",
  });
  assert.match(twiml, /<Dial timeout="20"/);
  assert.match(twiml, /action="[^"]*after-dial"/);
  assert.match(twiml, /<Number>\+18055550100<\/Number>/);
});

test("the phone instructions rule out anything the caller cannot see", () => {
  const instructions = voiceInstructions();
  assert.match(instructions, /cannot see/i);
  assert.match(instructions, /one thing at a time/i);
  assert.match(instructions, /Speech recognition makes mistakes/i);
});
