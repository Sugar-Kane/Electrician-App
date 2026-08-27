import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { publicOrigin, webhookUrlCandidates } from "@/lib/twilio-webhook-url";
import {
  activeInboundCall,
  type ActiveTwilioCall,
} from "@/lib/twilio-transfer";

/**
 * Twilio REST access over fetch.
 *
 * Deliberately not the twilio SDK: sending one message and validating one
 * signature is a few lines each, and the SDK is a large dependency to carry for
 * that. If webhooks, media, or Conversations arrive later, revisit.
 */

type TwilioCredentials = { accountSid: string; authToken: string };

function credentials(): TwilioCredentials | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return { accountSid, authToken };
}

export function isTwilioConfigured() {
  return credentials() !== null;
}

export function matchesTwilioAccountSid(accountSid: string) {
  return credentials()?.accountSid === accountSid;
}

function twilioAuthorization(auth: TwilioCredentials) {
  return `Basic ${Buffer.from(`${auth.accountSid}:${auth.authToken}`).toString("base64")}`;
}

export type TwilioCallDetails = {
  sid: string;
  from: string;
  to: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
};

function asIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Read the authoritative phone numbers and timing for a signed CallSid. */
export async function fetchTwilioCall(
  callSid: string,
): Promise<TwilioCallDetails | null> {
  const auth = credentials();
  if (!auth) return null;

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${auth.accountSid}/Calls/${callSid}.json`,
      {
        headers: { Authorization: twilioAuthorization(auth) },
        cache: "no-store",
      },
    );
    if (!response.ok) return null;

    const payload = (await response.json()) as Record<string, unknown>;
    const duration =
      typeof payload.duration === "string" && /^\d+$/.test(payload.duration)
        ? Number(payload.duration)
        : null;

    return {
      sid: typeof payload.sid === "string" ? payload.sid : "",
      from: typeof payload.from === "string" ? payload.from : "",
      to: typeof payload.to === "string" ? payload.to : "",
      status: typeof payload.status === "string" ? payload.status : "completed",
      startedAt: asIsoDate(payload.start_time),
      endedAt: asIsoDate(payload.end_time),
      durationSeconds: Number.isSafeInteger(duration) ? duration : null,
    };
  } catch {
    return null;
  }
}

/** Find the parent leg Twilio still controls for a caller currently speaking to xAI. */
export async function findActiveInboundTwilioCall(input: {
  from: string;
  to: string;
}): Promise<ActiveTwilioCall | null> {
  const auth = credentials();
  if (!auth) return null;

  const query = new URLSearchParams({
    From: input.from,
    To: input.to,
    Status: "in-progress",
    PageSize: "20",
  });

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${auth.accountSid}/Calls.json?${query}`,
      {
        headers: { Authorization: twilioAuthorization(auth) },
        cache: "no-store",
      },
    );
    if (!response.ok) return null;
    return activeInboundCall(await response.json(), input);
  } catch {
    return null;
  }
}

export type TwilioRedirectResult =
  | { ok: true; callSid: string; status: string }
  | { ok: false; errorCode: string; errorDetail: string };

/** Replace the TwiML on a live call, which ends the xAI leg and starts the transfer. */
export async function redirectTwilioCall(input: {
  callSid: string;
  twiml: string;
}): Promise<TwilioRedirectResult> {
  const auth = credentials();
  if (!auth) {
    return {
      ok: false,
      errorCode: "not_configured",
      errorDetail: "Twilio is not configured.",
    };
  }

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${auth.accountSid}/Calls/${input.callSid}.json`,
      {
        method: "POST",
        headers: {
          Authorization: twilioAuthorization(auth),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ Twiml: input.twiml }),
      },
    );
    const payload = (await response.json()) as {
      sid?: string;
      status?: string;
      code?: number;
      message?: string;
    };
    if (!response.ok || !payload.sid) {
      return {
        ok: false,
        errorCode: String(payload.code ?? response.status),
        errorDetail: payload.message ?? "Twilio could not redirect the call.",
      };
    }
    return {
      ok: true,
      callSid: payload.sid,
      status: payload.status ?? "in-progress",
    };
  } catch {
    return {
      ok: false,
      errorCode: "network_error",
      errorDetail: "Could not reach Twilio.",
    };
  }
}

/** Fetch recording bytes without ever putting Twilio credentials in a browser. */
export async function fetchTwilioRecordingMedia(input: {
  recordingSid: string;
  range?: string | null;
}): Promise<Response | null> {
  const auth = credentials();
  if (!auth) return null;

  const headers: Record<string, string> = {
    Authorization: twilioAuthorization(auth),
  };
  if (input.range) headers.Range = input.range;

  try {
    return await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${auth.accountSid}/Recordings/${input.recordingSid}.mp3`,
      { headers, cache: "no-store" },
    );
  } catch {
    return null;
  }
}

export type TwilioSendResult =
  | { ok: true; providerMessageId: string; status: string }
  | { ok: false; errorCode: string; errorDetail: string };

/**
 * Send one SMS through a tenant's Messaging Service.
 *
 * The Messaging Service is the tenant's, the credentials are the platform's:
 * that is the ISV shape the schema already assumes, with each tenant owning a
 * messaging service, brand, and campaign under one Twilio account.
 */
export async function sendSms(input: {
  to: string;
  body: string;
  messagingServiceSid: string;
  statusCallbackUrl?: string;
}): Promise<TwilioSendResult> {
  const auth = credentials();
  if (!auth) {
    return {
      ok: false,
      errorCode: "not_configured",
      errorDetail: "Twilio credentials are not configured for this deployment.",
    };
  }

  const form = new URLSearchParams({
    To: input.to,
    Body: input.body,
    MessagingServiceSid: input.messagingServiceSid,
  });
  if (input.statusCallbackUrl)
    form.set("StatusCallback", input.statusCallbackUrl);

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${auth.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: twilioAuthorization(auth),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      },
    );

    const payload = (await response.json()) as {
      sid?: string;
      status?: string;
      code?: number;
      message?: string;
    };

    if (!response.ok || !payload.sid) {
      return {
        ok: false,
        // 21610 is the STOP list. It means a customer opted out at the carrier
        // without us seeing the inbound, so the local ledger is behind.
        errorCode: String(payload.code ?? response.status),
        errorDetail: payload.message ?? "Twilio rejected the message.",
      };
    }

    return {
      ok: true,
      providerMessageId: payload.sid,
      status: payload.status ?? "queued",
    };
  } catch {
    return {
      ok: false,
      errorCode: "network_error",
      errorDetail: "Could not reach Twilio.",
    };
  }
}

/**
 * Verify that a webhook really came from Twilio.
 *
 * Without this the inbound endpoint is an open door: anyone who knows the URL
 * could post a fake STOP for another customer, or inject messages into a
 * tenant's thread. Twilio signs the full URL plus the sorted POST body with the
 * account auth token.
 */
export function verifyTwilioSignature(input: {
  signature: string | null;
  /** Every URL the request could have been signed against. */
  url: string | string[];
  params: Record<string, string>;
}): boolean {
  const auth = credentials();
  if (!auth || !input.signature) return false;

  const urls = Array.isArray(input.url) ? input.url : [input.url];
  const provided = Buffer.from(input.signature);

  return urls.some((url) => {
    const payload = Object.keys(input.params)
      .sort()
      .reduce((accumulator, key) => accumulator + key + input.params[key], url);

    const expected = Buffer.from(
      createHmac("sha1", auth.authToken)
        .update(Buffer.from(payload, "utf-8"))
        .digest("base64"),
    );
    if (expected.length !== provided.length) return false;
    return timingSafeEqual(expected, provided);
  });
}

/**
 * The URLs this webhook request might have been signed against.
 *
 * Wraps the pure reconstruction with the headers Vercel actually sets.
 */
export function twilioWebhookUrls(request: Request): string[] {
  return webhookUrlCandidates({
    configuredOrigin: process.env.NEXT_PUBLIC_APP_URL,
    requestUrl: request.url,
    forwardedProto: request.headers.get("x-forwarded-proto"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    host: request.headers.get("host"),
  });
}

/** The public origin this webhook arrived on, for URLs handed back to Twilio. */
export function twilioPublicOrigin(request: Request): string {
  return publicOrigin({
    requestUrl: request.url,
    forwardedProto: request.headers.get("x-forwarded-proto"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    host: request.headers.get("host"),
    fallbackOrigin: process.env.NEXT_PUBLIC_APP_URL,
  });
}
