import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_KEYTERMS,
  TELEPHONY_AUDIO_FORMAT,
  buildKeyterms,
  buildMcpTool,
  buildRealtimeInstructions,
  buildSessionUpdate,
} from "./grok-voice.ts";
import { BOOKING_TOOL_NAMES } from "./booking-tool-rules.ts";
import { RECORDING_NOTICE } from "./voice-intake.ts";
import type { IntakeContext } from "./sms-intake.ts";

const CONTEXT: IntakeContext = {
  businessName: "Volterra Electric",
  businessPhone: "(805) 555-0142",
  offeredSlots: [],
  diagnosticFee: "$95",
  serviceArea: "50 miles of the shop",
  isFirstReply: false,
};

test("every caller is told the call may be recorded, in the first thing said", () => {
  // Two-party consent. This is not a nicety that can drift out of the prompt.
  const instructions = buildRealtimeInstructions(CONTEXT);
  assert.ok(instructions.includes(RECORDING_NOTICE));
  assert.match(instructions, /Open with exactly/);
});

test("the instructions say the model's words book nothing", () => {
  const instructions = buildRealtimeInstructions(CONTEXT);
  assert.match(instructions, /Nothing you say books anything/);
  assert.match(instructions, /Never invent, round, or adjust a window/);
  assert.match(instructions, /flag_emergency/);
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

test("the session speaks the telephone's own audio format in both directions", () => {
  // 8 kHz μ-law end to end: no resampling, and no quality lost to a conversion
  // that only exists because a default was left alone.
  const update = buildSessionUpdate({
    context: CONTEXT,
    mcpServerUrl: "https://x.test/api/mcp/t",
    allowedTools: BOOKING_TOOL_NAMES,
  });

  assert.deepEqual(update.session.audio.input.format, TELEPHONY_AUDIO_FORMAT);
  assert.deepEqual(update.session.audio.output.format, TELEPHONY_AUDIO_FORMAT);
  assert.equal(TELEPHONY_AUDIO_FORMAT.rate, 8000);
});

test("the model decides when the caller has finished talking", () => {
  const update = buildSessionUpdate({
    context: CONTEXT,
    mcpServerUrl: "https://x.test/api/mcp/t",
    allowedTools: BOOKING_TOOL_NAMES,
  });
  assert.deepEqual(update.session.audio.input.turn_detection, { type: "server_vad" });
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
    "book_visit",
    "request_callback",
    "flag_emergency",
  ]);
});
