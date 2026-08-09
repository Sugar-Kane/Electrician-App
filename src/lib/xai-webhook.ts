import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifying that an incoming-call webhook really came from xAI.
 *
 * This endpoint is the front door to the phone line: whatever it accepts gets a
 * voice agent pointed at a real business's schedule, with a booking URL minted
 * for it. Unverified, anyone who learned the URL could open a session against
 * any tenant.
 *
 * xAI signs with the `webhook-id` / `webhook-timestamp` / `webhook-signature`
 * header set, which is the Standard Webhooks scheme: HMAC-SHA256 over
 * `{id}.{timestamp}.{body}`, base64, carried as a space-separated list of
 * `v1,<signature>` so a secret can be rotated without dropping deliveries.
 *
 * Two things are deliberate. It is fail-closed: anything it cannot verify is
 * refused, because accepting a forgery is far worse than dropping a call. And
 * it tries the secret both as raw bytes and base64-decoded, since the same
 * scheme is deployed both ways and guessing wrong would silently reject every
 * real call — the exact failure that took this phone line down once already.
 *
 * Import-free so the verification can be tested directly.
 */

/** Replay window. A signature older than this is refused even if it is valid. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

function secretKeys(secret: string): Buffer[] {
  const trimmed = secret.trim();
  if (!trimmed) return [];

  const withoutPrefix = trimmed.replace(/^whsec_/, "");
  const keys = [Buffer.from(withoutPrefix, "utf-8")];

  // The same scheme ships with the secret base64-encoded in some deployments
  // and plain in others, and the headers look identical either way.
  const decoded = Buffer.from(withoutPrefix, "base64");
  if (decoded.length > 0 && decoded.toString("base64").replace(/=+$/, "") === withoutPrefix.replace(/=+$/, "")) {
    keys.push(decoded);
  }

  return keys;
}

function matches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type WebhookHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export function verifyXaiWebhook(input: {
  secret: string;
  headers: WebhookHeaders;
  /** The raw request body, byte for byte. Re-serialised JSON will not verify. */
  body: string;
  now?: Date;
}): boolean {
  const { id, timestamp, signature } = input.headers;
  if (!id || !timestamp || !signature) return false;

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return false;

  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - sentAt) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const keys = secretKeys(input.secret);
  if (keys.length === 0) return false;

  const signed = `${id}.${timestamp}.${input.body}`;

  // A rotation period sends several signatures; any one of them counts.
  const provided = signature
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (part.includes(",") ? part.slice(part.indexOf(",") + 1) : part));

  return keys.some((key) => {
    const expected = createHmac("sha256", key).update(signed, "utf-8").digest("base64");
    return provided.some((candidate) => matches(expected, candidate));
  });
}

export type IncomingCall = {
  callId: string;
  /** The number the customer called from. */
  from: string;
  /** The business number they dialled. */
  to: string;
};

function headerValue(headers: unknown, name: string): string {
  if (!Array.isArray(headers)) return "";
  const match = headers.find(
    (header) =>
      typeof header === "object" &&
      header !== null &&
      String((header as Record<string, unknown>).name ?? "").toLowerCase() === name,
  );
  if (!match) return "";
  const value = (match as Record<string, unknown>).value;
  return typeof value === "string" ? value : "";
}

/**
 * The call in a `realtime.call.incoming` payload, or null.
 *
 * Null for any other event type, and for a call with nothing to route on: a
 * session with no dialled number cannot be matched to a business, and guessing
 * would mean answering the phone as the wrong company.
 */
export function readIncomingCall(payload: unknown): IncomingCall | null {
  if (typeof payload !== "object" || payload === null) return null;
  const event = payload as Record<string, unknown>;
  if (event.type !== "realtime.call.incoming") return null;

  const data = typeof event.data === "object" && event.data !== null
    ? (event.data as Record<string, unknown>)
    : {};

  const callId = typeof data.call_id === "string" ? data.call_id : "";
  const from = sipNumber(headerValue(data.sip_headers, "from"));
  const to = sipNumber(headerValue(data.sip_headers, "to"));

  if (!callId || !from || !to) return null;
  return { callId, from, to };
}

/**
 * The phone number inside a SIP header, in the form the rest of the app uses.
 *
 * A From header is rarely a bare number in the wild — it arrives as
 * `"Jo" <sip:+18055550142@carrier.example>`, and the display name can itself
 * contain digits, so the address is read first and the display name discarded.
 * Everything downstream matches on the last ten digits, but the number is also
 * *stored* on the customer record, and `<sip:...>` is not a phone number
 * anybody can call back.
 */
export function sipNumber(value: string): string {
  if (!value) return "";

  const angled = value.match(/<([^>]*)>/);
  const address = angled ? angled[1]! : value;
  // sip:+18055550142@host;params — the user part is the number.
  const user = address.replace(/^\w+:/, "").split("@")[0] ?? "";

  const digits = user.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}
