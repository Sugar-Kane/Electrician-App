import { toE164 } from "./phone-format.ts";
import { hangupTwiml, transferTwiml } from "./voice-intake.ts";

export type ActiveTwilioCall = {
  sid: string;
  from: string;
  to: string;
  startedAt: string | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Select the live inbound parent leg, never the child SIP leg to xAI. */
export function activeInboundCall(
  payload: unknown,
  input: { from: string; to: string },
): ActiveTwilioCall | null {
  const from = toE164(input.from);
  const to = toE164(input.to);
  if (!from || !to || typeof payload !== "object" || payload === null)
    return null;

  const calls = (payload as { calls?: unknown }).calls;
  if (!Array.isArray(calls)) return null;

  const matches = calls
    .filter(
      (call): call is Record<string, unknown> =>
        typeof call === "object" && call !== null,
    )
    .filter(
      (call) =>
        /^CA[a-f0-9]{32}$/i.test(text(call.sid)) &&
        text(call.status) === "in-progress" &&
        text(call.direction) === "inbound" &&
        !text(call.parent_call_sid) &&
        toE164(text(call.from)) === from &&
        toE164(text(call.to)) === to,
    )
    .sort(
      (left, right) =>
        Date.parse(text(right.start_time)) - Date.parse(text(left.start_time)),
    );

  const call = matches[0];
  return call
    ? {
        sid: text(call.sid),
        from: toE164(text(call.from)),
        to: toE164(text(call.to)),
        startedAt: text(call.start_time) || null,
      }
    : null;
}

export function transferActionUrl(input: {
  origin: string;
  callSid: string;
  requestId: string;
  language: string;
}): string {
  try {
    const url = new URL("/api/twilio/transfer", input.origin);
    if (url.protocol !== "https:") return "";
    url.searchParams.set("call", input.callSid);
    url.searchParams.set("request", input.requestId);
    url.searchParams.set("lang", input.language === "es" ? "es" : "en");
    return url.toString();
  } catch {
    return "";
  }
}

export function liveTransferTwiml(input: {
  to: string;
  callerId: string;
  actionUrl: string;
  language: string;
}): string {
  const to = toE164(input.to);
  const callerId = toE164(input.callerId);
  if (!to || !callerId || !input.actionUrl.startsWith("https://")) return "";

  return transferTwiml({
    say:
      input.language === "es"
        ? "Un momento mientras le comunico con el electricista."
        : "One moment while I connect you with the electrician.",
    to,
    callerId,
    actionUrl: input.actionUrl,
    timeoutSeconds: 20,
    language: input.language,
  });
}

export function transferCompleted(status: string): boolean {
  return status.toLowerCase() === "completed";
}

export function missedTransferTwiml(language: string): string {
  return hangupTwiml(
    language === "es"
      ? "Lo siento, el electricista no pudo contestar. Ya tenemos sus datos y le llamaremos en breve."
      : "Sorry, the electrician could not answer. We have your details and will call you back shortly.",
    language,
  );
}
