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

/** A stable human name makes the automated greeting feel like an introduction. */
export const RECEPTIONIST_NAME = "Sofia";

/** How many misunderstandings before a person takes over. */
export const MAX_FAILED_TURNS = 2;

export function buildGreeting(businessName: string): string {
  return `Hi, this is ${RECEPTIONIST_NAME} with ${businessName}. ${RECORDING_NOTICE} How can I help you today?`;
}

function isSpanish(language: string): boolean {
  return language === "es";
}

function slotSpoken(action: Extract<IntakeAction, { kind: "book" | "propose" }>): string {
  const label = isSpanish(action.language) ? action.slot.labels?.es ?? action.slot.label : action.slot.label;
  return spoken(label);
}

/**
 * Whether the caller has asked for a human.
 *
 * Matched generously: someone who wants a person and is made to argue with an
 * automated system is a customer the business has already lost.
 */
export function wantsHuman(text: string): boolean {
  return /\b(human|person|real person|someone else|representative|agent|operator|talk to (nick|the electrician|somebody|someone)|speak (to|with) (a|an|someone|nick)|customer service|manager|stop|this is useless|humano|persona|representante|agente|operador|hablar con (alguien|una persona|un humano|el electricista)|servicio al cliente|gerente)\b/i.test(
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
 * The order is the point: a request for a person is honoured before the system
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

  if (wantsHuman(input.callerText)) {
    return input.canTransfer
      ? {
          kind: "transfer",
          say: isSpanish(action.language)
            ? "Por supuesto. Le comunico ahora."
            : "Of course. Connecting you now.",
        }
      : {
          kind: "hangup",
          say: isSpanish(action.language)
            ? "Entiendo. He anotado que desea que le llamen, y alguien le devolverá la llamada en breve. Gracias por llamar."
            : "I understand. I have noted that you would like a call back, and someone will phone you shortly. Thanks for calling.",
        };
  }

  if (action.kind === "book") {
    return {
      kind: "hangup",
      say: isSpanish(action.language)
        ? `Su cita está reservada para ${slotSpoken(action)}. Le enviaremos un mensaje cuando el técnico vaya en camino. Gracias por llamar a ${context.businessName}.`
        : `You are booked for ${slotSpoken(action)}. We will text you when the technician is on the way. Thanks for calling ${context.businessName}.`,
    };
  }

  if (action.kind === "callback") {
    return {
      kind: "hangup",
      say: isSpanish(action.language)
        ? "Ya tengo sus datos y alguien le llamará en breve. Gracias por llamar."
        : "I have taken your details and someone will call you back shortly. Thanks for calling.",
    };
  }

  if (action.kind === "propose") {
    return {
      kind: "listen",
      say: isSpanish(action.language)
        ? `Podemos ir ${slotSpoken(action)}. La visita de diagnóstico cuesta ${context.diagnosticFee}. ¿Quiere que reserve esa cita?`
        : `We can come ${slotSpoken(action)}. The diagnostic visit is ${context.diagnosticFee}. Would you like me to book that?`,
    };
  }

  // Still gathering. Give up on the third failure rather than looping a caller
  // through a system that clearly is not understanding them.
  if (input.failedTurns >= MAX_FAILED_TURNS) {
    return input.canTransfer
      ? {
          kind: "transfer",
          say: isSpanish(action.language)
            ? "Permítame comunicarle con el electricista."
            : "Let me put you through to the electrician.",
        }
      : {
          kind: "hangup",
          say: isSpanish(action.language)
            ? "Lo siento, estoy teniendo dificultades para entenderle. Ya tengo su número y alguien le llamará en breve."
            : "Sorry — I am having trouble with this one. I have noted your number and someone will call you back shortly.",
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

function voiceAttributes(language: string = "en"): string {
  return isSpanish(language)
    ? 'voice="Polly.Lupe" language="es-US"'
    : 'voice="Polly.Joanna" language="en-US"';
}

function silenceMessage(language: string): string {
  return isSpanish(language)
    ? "Lo siento, no escuché nada. Llame de nuevo cuando esté listo."
    : "Sorry, I did not catch that. Please call back when you are ready.";
}

/** Speak, then listen for the caller's next sentence. */
export function listenTwiml(input: { say: string; actionUrl: string; language?: string }): string {
  const voice = voiceAttributes(input.language);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `<Gather input="speech" speechTimeout="3" speechModel="deepgram_nova-3" language="multi" action="${escapeXml(input.actionUrl)}" method="POST">`,
    `<Say ${voice}>${escapeXml(input.say)}</Say>`,
    "</Gather>",
    // Reached only when the caller says nothing at all.
    `<Say ${voice}>${escapeXml(silenceMessage(input.language ?? "en"))}</Say>`,
    "<Hangup/>",
    "</Response>",
  ].join("");
}

export function hangupTwiml(say: string, language: string = "en"): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `<Say ${voiceAttributes(language)}>${escapeXml(say)}</Say>`,
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
  language?: string;
}): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `<Say ${voiceAttributes(input.language)}>${escapeXml(input.say)}</Say>`,
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
    "- Reply entirely in the language the caller just used. A Spanish caller gets Spanish on the first reply; stay in Spanish unless they switch or ask you to switch.",
    "- Report that latest language accurately in the tool call, and never mix English and Spanish in one spoken reply.",
    "- Use confirm_visit when the caller agrees to a window you already offered out loud.",
  ].join("\n");
}
