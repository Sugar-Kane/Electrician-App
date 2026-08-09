import type { IntakeContext } from "@/lib/sms-intake";
// An explicit .ts specifier, so the tests can run this module directly under
// Node's type stripping the way the other import-free modules do.
import { RECORDING_NOTICE } from "./voice-intake.ts";

/**
 * Configuring a Grok realtime voice session to answer the business phone.
 *
 * The `<Gather>` receptionist works, but it hears one transcribed sentence at a
 * time and reads a synthesised sentence back, which is why a caller giving an
 * address got it read back wrong. A realtime model holds the audio itself: it
 * hears the address as speech, and it can be told in advance which words to
 * expect.
 *
 * What it must not hold is the decision. The booking tools it is given are the
 * MCP endpoint in this app, so every write still goes through
 * `decideIntakeAction` — the model runs the conversation, the server runs the
 * rules.
 *
 * Import-free apart from types and one shared constant, so the instructions and
 * the term list can be tested without a session.
 */

export const GROK_REALTIME_URL = "wss://api.x.ai/v1/realtime";
export const GROK_VOICE_MODEL = "grok-voice-latest";

/** μ-law at 8 kHz: exactly what a telephone carries, so nothing is resampled. */
export const TELEPHONY_AUDIO_FORMAT = { type: "audio/pcmu", rate: 8000 } as const;

/** At most this many keyterms are accepted per session. */
export const MAX_KEYTERMS = 100;

/**
 * Words worth telling the model to expect.
 *
 * Speech recognition fails on exactly the vocabulary this business runs on:
 * street suffixes, panel parts, and the town names in its service area. A term
 * list is the cheapest fix available — it costs nothing per call and it is the
 * difference between "18 Palm Street" and whatever the transcriber guessed.
 */
const TRADE_TERMS = [
  "breaker",
  "breaker box",
  "panel",
  "sub panel",
  "load center",
  "GFCI",
  "AFCI",
  "outlet",
  "receptacle",
  "amp",
  "amperage",
  "voltage",
  "meter",
  "meter base",
  "fuse",
  "junction box",
  "conduit",
  "romex",
  "three way switch",
  "recessed lighting",
  "ceiling fan",
  "EV charger",
  "tripped",
  "flickering",
  "buzzing",
  "arcing",
  "sparking",
  "no power",
  "half the house",
];

const ADDRESS_TERMS = [
  "Street",
  "Avenue",
  "Road",
  "Drive",
  "Lane",
  "Court",
  "Boulevard",
  "Place",
  "Way",
  "Circle",
  "Terrace",
  "Apartment",
  "Unit",
  "Suite",
  "North",
  "South",
  "East",
  "West",
];

const SCHEDULING_TERMS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "morning",
  "afternoon",
  "diagnostic",
  "arrival window",
  "reschedule",
];

/**
 * The term list for one call, most specific first.
 *
 * Ordered so that if the list has to be cut to fit, what survives is the part
 * no general model could guess: this business's own name and the towns it
 * serves.
 */
export function buildKeyterms(input: {
  businessName: string;
  /** Towns in the service area, most common first. */
  serviceAreaTowns?: string[];
}): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const term of [
    input.businessName,
    ...(input.serviceAreaTowns ?? []),
    ...TRADE_TERMS,
    ...ADDRESS_TERMS,
    ...SCHEDULING_TERMS,
  ]) {
    const trimmed = term.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    terms.push(trimmed);
  }

  return terms.slice(0, MAX_KEYTERMS);
}

/**
 * What the model is told before it says a word.
 *
 * Written for a model that owns the microphone, which changes the emphasis:
 * the tools are described as the only way anything becomes real, and the
 * hazard rule is stated as a thing to do rather than a thing to classify.
 */
export function buildRealtimeInstructions(context: IntakeContext): string {
  return [
    `You are answering the phone for ${context.businessName}, an electrical contractor serving ${context.serviceArea}.`,
    `Open with exactly: "Thanks for calling ${context.businessName}. ${RECORDING_NOTICE} How can I help?"`,
    "",
    "You are speaking out loud to someone who cannot see anything. Be brief, warm, and ordinary. One question at a time.",
    "",
    "Nothing you say books anything. The tools are the only way something happens:",
    "- list_open_slots before you offer any time. Never invent, round, or adjust a window.",
    "- book_visit once they have described the problem, given a street address and city, and agreed to a window you offered. Read the result back before you tell them it is booked — it can refuse.",
    "- request_callback when a visit cannot be booked, or they ask to speak to a person.",
    "- flag_emergency the moment they mention fire, smoke, a burning smell, someone shocked, a downed line, or water near anything electrical. Do this before anything else, and do not book.",
    "",
    "Rules:",
    `- The diagnostic visit costs ${context.diagnosticFee}. Never quote any other price and never estimate a repair cost.`,
    "- Read addresses and names back to the caller before you use them. If you are unsure of a word, ask rather than guessing.",
    "- Never ask for card details, and never read out a web address.",
    "- If a tool result starts with NOT BOOKED, something was refused. Say so plainly and do the thing the result asks for.",
  ].join("\n");
}

export type RealtimeToolConfig = {
  type: "mcp";
  server_label: string;
  server_url: string;
  allowed_tools: string[];
  authorization?: string;
};

/**
 * The booking tools, as a remote MCP server the model connects to itself.
 *
 * `server_url` is per call: it carries the signed token that says which
 * business and which caller this session may act for, so the identity is not
 * something the model can be talked into changing.
 */
export function buildMcpTool(input: {
  serverUrl: string;
  allowedTools: string[];
  bearerToken?: string;
}): RealtimeToolConfig {
  return {
    type: "mcp",
    server_label: "booking",
    server_url: input.serverUrl,
    allowed_tools: input.allowedTools,
    ...(input.bearerToken ? { authorization: input.bearerToken } : {}),
  };
}

/**
 * The `session.update` payload for one call.
 *
 * The envelope's exact nesting is the one part of this file taken from xAI's
 * realtime schema rather than from our own rules; everything inside it —
 * instructions, keyterms, the tool block — is built and tested above, so a
 * schema correction is a change to this function alone.
 */
export function buildSessionUpdate(input: {
  context: IntakeContext;
  mcpServerUrl: string;
  allowedTools: string[];
  bearerToken?: string;
  serviceAreaTowns?: string[];
  voice?: string;
}) {
  return {
    type: "session.update",
    session: {
      instructions: buildRealtimeInstructions(input.context),
      audio: {
        input: {
          format: TELEPHONY_AUDIO_FORMAT,
          // Let the model decide when the caller has stopped talking. Fixed
          // timeouts are what make an automated line feel like an interrogation.
          turn_detection: { type: "server_vad" },
          keyterms: buildKeyterms({
            businessName: input.context.businessName,
            serviceAreaTowns: input.serviceAreaTowns,
          }),
        },
        output: {
          format: TELEPHONY_AUDIO_FORMAT,
          voice: input.voice ?? "Rex",
        },
      },
      tools: [
        buildMcpTool({
          serverUrl: input.mcpServerUrl,
          allowedTools: input.allowedTools,
          bearerToken: input.bearerToken,
        }),
      ],
    },
  };
}
