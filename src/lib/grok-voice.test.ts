import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VOICE,
  MAX_KEYTERMS,
  TELEPHONY_AUDIO_FORMAT,
  buildKeyterms,
  buildMcpTool,
  buildRealtimeInstructions,
  buildSessionUpdate,
  realtimeUrlForCall,
} from "./grok-voice.ts";
import { BOOKING_TOOL_NAMES } from "./booking-tool-rules.ts";
import { RECORDING_NOTICE } from "./voice-intake.ts";
import type { IntakeContext } from "./sms-intake.ts";

const CONTEXT: IntakeContext = {
  businessName: "Volterra Electric",
  businessPhone: "(805) 555-0142",
  offeredSlots: [],
  diagnosticFee: "$95",
  diagnosticFeeCents: 9500,
  serviceArea: "50 miles of the shop",
  nowLabel: "Sunday, August 9, 6:28 PM",
  isFirstReply: false,
  language: "en",
  languageSource: "detected",
};

test("every caller is told the call may be recorded, in the first thing said", () => {
  // Two-party consent. This is not a nicety that can drift out of the prompt.
  const instructions = buildRealtimeInstructions(CONTEXT);
  assert.ok(instructions.includes(RECORDING_NOTICE));
  assert.match(instructions, /Open with exactly/);
});

test("Maya introduces herself personally and asks how she can help today", () => {
  const instructions = buildRealtimeInstructions({
    ...CONTEXT,
    businessName: "Pacific Plains Electric",
  });

  assert.match(
    instructions,
    /Hi, this is Maya with Pacific Plains Electric\..*How can I help you today\?/,
  );
});

test("the first Spanish caller turn gets a Spanish reply and stays Spanish", () => {
  const instructions = buildRealtimeInstructions(CONTEXT);

  assert.match(instructions, /Spanish caller gets Spanish|speak Spanish, answer in natural conversational Spanish/i);
  assert.match(instructions, /that very first turn/i);
  assert.match(instructions, /unless the caller switches languages/i);
  assert.match(instructions, /Never mix English and Spanish/i);
});

test("the instructions say the model's words book nothing", () => {
  const instructions = buildRealtimeInstructions(CONTEXT);
  assert.match(instructions, /Nothing you say books anything/);
  assert.match(instructions, /Never invent, round, or adjust a window/);
});

test("the diagnostic fee is the only price the model is given", () => {
  const instructions = buildRealtimeInstructions({ ...CONTEXT, diagnosticFee: "$120" });
  assert.match(instructions, /\$120/);
  assert.match(instructions, /Never quote any other price/);
});

test("nothing in the instructions asks a caller to look at something", () => {
  const instructions = buildRealtimeInstructions(CONTEXT);
  assert.doesNotMatch(instructions, /https?:\/\//);
  assert.match(instructions, /cannot see anything/);
});

test("the business name and its towns come first in the term list", () => {
  const terms = buildKeyterms({
    businessName: "Volterra Electric",
    serviceAreaTowns: ["Santa Maria", "Orcutt", "Nipomo"],
  });

  assert.deepEqual(terms.slice(0, 4), ["Volterra Electric", "Santa Maria", "Orcutt", "Nipomo"]);
});

test("the term list never exceeds what a session accepts", () => {
  const towns = Array.from({ length: 200 }, (_, index) => `Town ${index}`);
  const terms = buildKeyterms({ businessName: "Volterra Electric", serviceAreaTowns: towns });

  assert.equal(terms.length, MAX_KEYTERMS);
  // What survives the cut is the part no general model could guess.
  assert.equal(terms[0], "Volterra Electric");
  assert.equal(terms[1], "Town 0");
});

test("a town repeated in the business name is not listed twice", () => {
  const terms = buildKeyterms({ businessName: "Orcutt", serviceAreaTowns: ["orcutt", "Nipomo"] });
  assert.deepEqual(terms.slice(0, 2), ["Orcutt", "Nipomo"]);
});

test("street suffixes are in the term list, because addresses are what got misheard", () => {
  const terms = buildKeyterms({ businessName: "Volterra Electric" });
  for (const term of ["Street", "Avenue", "Boulevard", "breaker", "GFCI"]) {
    assert.ok(terms.includes(term), term);
  }
});

test("the MCP tool carries the per-call URL and nothing that identifies the tenant", () => {
  const tool = buildMcpTool({
    serverUrl: "https://www.volteira.com/api/mcp/signed.token",
    allowedTools: BOOKING_TOOL_NAMES,
  });

  assert.equal(tool.type, "mcp");
  assert.equal(tool.server_url, "https://www.volteira.com/api/mcp/signed.token");
  assert.deepEqual(tool.allowed_tools, BOOKING_TOOL_NAMES);
  assert.equal(tool.authorization, undefined);
});

test("a bearer token is sent only when there is one", () => {
  const withToken = buildMcpTool({
    serverUrl: "https://x.test/api/mcp/t",
    allowedTools: [],
    bearerToken: "Bearer abc",
  });
  assert.equal(withToken.authorization, "Bearer abc");

  assert.ok(
    !("authorization" in buildMcpTool({ serverUrl: "https://x.test/api/mcp/t", allowedTools: [] })),
  );
});

test("the model decides when the caller has finished talking", () => {
  const update = buildSessionUpdate({
    context: CONTEXT,
    mcpServerUrl: "https://x.test/api/mcp/t",
    allowedTools: BOOKING_TOOL_NAMES,
  });
  assert.deepEqual(update.session.turn_detection, { type: "server_vad" });
});

test("voice and instructions sit flat on the session, as the SIP guide shows", () => {
  const update = buildSessionUpdate({
    context: CONTEXT,
    mcpServerUrl: "https://x.test/api/mcp/t",
    allowedTools: BOOKING_TOOL_NAMES,
  });

  assert.equal(update.type, "session.update");
  assert.equal(update.session.voice, DEFAULT_VOICE);
  assert.equal(update.session.voice, update.session.voice.toLowerCase());
  assert.ok(update.session.instructions.includes(CONTEXT.businessName));
});

test("telephony audio is 8 kHz mu-law, for a session where we carry the media", () => {
  // Not sent over SIP — the trunk negotiates the codec and xAI bridges it.
  assert.equal(TELEPHONY_AUDIO_FORMAT.rate, 8000);
  assert.equal(TELEPHONY_AUDIO_FORMAT.type, "audio/pcmu");
});

test("a call already ringing is joined by its id", () => {
  assert.equal(
    realtimeUrlForCall("0000-1111"),
    "wss://api.x.ai/v1/realtime?call_id=0000-1111",
  );
});

test("the session is given the booking tools and only the booking tools", () => {
  const update = buildSessionUpdate({
    context: CONTEXT,
    mcpServerUrl: "https://x.test/api/mcp/t",
    allowedTools: BOOKING_TOOL_NAMES,
  });

  assert.equal(update.session.tools.length, 1);
  assert.deepEqual(update.session.tools[0]!.allowed_tools, [
    "list_open_slots",
    "get_intake_questions",
    "book_visit",
    "request_callback",
  ]);
});
