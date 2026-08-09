/**
 * The receptionist that answers the phone.
 *
 * Everything about *what the caller wants* is decided by the shared intake
 * rules — same tools, same hazard detection, same "only offer a window the
 * scheduler really has". This module is what changes when the words arrive as
 * speech instead of a text message: how they are spoken back, when to hand the
 * call to a person, and the TwiML that carries it.
 *
 * Import-free so the escalation and escaping rules can be tested directly.
 */

import type { IntakeAction, IntakeContext } from "@/lib/sms-intake";

/**
 * California is a two-party consent state, and so are several of its
 * neighbours. Every caller hears this before they say anything.
 */
export const RECORDING_NOTICE = "This call may be recorded or transcribed.";

/** How many misunderstandings before a person takes over. */
export const MAX_FAILED_TURNS = 2;

export function buildGreeting(businessName: string): string {
  return `Thanks for calling ${businessName}. ${RECORDING_NOTICE} I can book an electrician for you. What is the problem?`;
}

/**
 * Whether the caller has asked for a human.
 *
 * Matched generously: someone who wants a person and is made to argue with an
 * automated system is a customer the business has already lost.
 */
export function wantsHuman(text: string): boolean {
  return /\b(human|person|real person|someone else|representative|agent|operator|talk to (nick|the electrician|somebody|someone)|speak (to|with) (a|an|someone|nick)|customer service|manager|stop|this is useless)\b/i.test(
    text,
  );
}

export type VoiceStep =
  | { kind: "listen"; say: string }
  | { kind: "transfer"; say: string }
  | { kind: "hangup"; say: string };

/**
 * What the call should do next.
 *
 * The order is the point: a hazard ends the call with 911 before anything
 * else can happen, and a request for a person is honoured before the system
 * tries to be clever.
 */
export function decideVoiceStep(input: {
  action: IntakeAction;
  callerText: string;
  failedTurns: number;
  canTransfer: boolean;
  context: IntakeContext;
}): VoiceStep {
  const { action, context } = input;

  if (action.kind === "escalate") {
    // Nothing is booked and nobody is transferred: the caller needs emergency
    // services, and keeping them on this line delays that.
    return {
      kind: "hangup",
      say: `This sounds like an emergency. Please hang up and call 9 1 1 right away. If a power line is down, call your utility as well. Do not touch the electrical panel. ${context.businessName} will follow up once you are safe.`,
    };
  }

  if (wantsHuman(input.callerText)) {
    return input.canTransfer
      ? { kind: "transfer", say: "Of course. Connecting you now." }
      : {
          kind: "hangup",
          say: "I understand. I have noted that you would like a call back, and someone will phone you shortly. Thanks for calling.",
        };
  }

  if (action.kind === "book") {
    return {
      kind: "hangup",
      say: `You are booked for ${spoken(action.slot.label)}. We will text you when the technician is on the way. Thanks for calling ${context.businessName}.`,
    };
  }

  if (action.kind === "callback") {
    return {
      kind: "hangup",
      say: "I have taken your details and someone will call you back shortly. Thanks for calling.",
    };
  }

  if (action.kind === "propose") {
    return {
      kind: "listen",
      say: `We can come ${spoken(action.slot.label)}. The diagnostic visit is ${context.diagnosticFee}. Would you like me to book that?`,
    };
  }

  // Still gathering. Give up on the third failure rather than looping a caller
  // through a system that clearly is not understanding them.
  if (input.failedTurns >= MAX_FAILED_TURNS) {
    return input.canTransfer
      ? { kind: "transfer", say: "Let me put you through to the electrician." }
      : {
          kind: "hangup",
          say: "Sorry — I am having trouble with this one. I have noted your number and someone will call you back shortly.",
        };
  }

  return { kind: "listen", say: action.reply };
}

/**
 * Make a written line speakable.
 *
 * Times read as "8:00-10:00 AM" out loud become "eight hundred dash ten
 * hundred"; a phone number without spacing is read as one long integer.
 */
export function spoken(value: string): string {
  return value
    .replace(/(\d)\s*[-–]\s*(\d)/g, "$1 to $2")
    .replace(/\bAM\b/g, "A M")
    .replace(/\bPM\b/g, "P M")
    .trim();
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const VOICE = 'voice="Polly.Joanna"';

/** Speak, then listen for the caller's next sentence. */
export function listenTwiml(input: { say: string; actionUrl: string }): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `<Gather input="speech" speechTimeout="auto" language="en-US" action="${escapeXml(input.actionUrl)}" method="POST">`,
    `<Say ${VOICE}>${escapeXml(input.say)}</Say>`,
    "</Gather>",
    // Reached only when the caller says nothing at all.
    `<Say ${VOICE}>Sorry, I did not catch that. Please call back when you are ready.</Say>`,
    "<Hangup/>",
    "</Response>",
  ].join("");
}

export function hangupTwiml(say: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `<Say ${VOICE}>${escapeXml(say)}</Say>`,
    "<Hangup/>",
    "</Response>",
  ].join("");
}

/**
 * Hand the call to a person.
 *
 * `action` fires when the dial ends without being answered, so an unanswered
 * transfer becomes a callback rather than a hang-up.
 */
export function transferTwiml(input: {
  say: string;
  to: string;
  callerId: string;
  actionUrl: string;
  timeoutSeconds?: number;
}): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `<Say ${VOICE}>${escapeXml(input.say)}</Say>`,
    `<Dial timeout="${input.timeoutSeconds ?? 20}" callerId="${escapeXml(input.callerId)}" action="${escapeXml(input.actionUrl)}" method="POST">`,
    `<Number>${escapeXml(input.to)}</Number>`,
    "</Dial>",
    "</Response>",
  ].join("");
}

/**
 * The instructions the model runs under on a phone call.
 *
 * Built on the shared intake prompt, with the differences that matter out
 * loud: one question at a time, and no assumption the caller can see anything.
 */
export function voiceInstructions(): string {
  return [
    "",
    "This is a phone call, not a text message:",
    "- The caller cannot see anything. Never refer to links, buttons, or writing anything down.",
    "- Ask for one thing at a time. Two questions in one breath do not work on the phone.",
    "- Speech recognition makes mistakes. If an address or name looks garbled, ask them to repeat it rather than booking on a guess.",
    "- Use confirm_visit when the caller agrees to a window you already offered out loud.",
  ].join("\n");
}
