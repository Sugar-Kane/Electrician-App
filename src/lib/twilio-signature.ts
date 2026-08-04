import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Twilio's `X-Twilio-Signature` header.
 *
 * Twilio signs the full request URL with the POST parameters appended in
 * lexicographic key order, HMAC-SHA1 under the account auth token, base64.
 * Implemented here rather than pulling in the Twilio SDK for one function.
 *
 * The URL must be the one Twilio actually called, including scheme, host, and
 * query string. Behind a proxy the request's own host header can differ from
 * the public URL Twilio dialed, which is why the public base URL is configured
 * explicitly rather than reconstructed from headers an attacker can set.
 */
export function verifyTwilioSignature(input: {
  authToken: string;
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): boolean {
  if (!input.signature) return false;

  const payload = Object.keys(input.params)
    .sort()
    .reduce((accumulated, key) => accumulated + key + input.params[key], input.url);

  const expected = createHmac("sha1", input.authToken).update(Buffer.from(payload, "utf8")).digest("base64");
  const provided = Buffer.from(input.signature, "utf8");
  const computed = Buffer.from(expected, "utf8");

  // timingSafeEqual throws on a length mismatch, so compare lengths first.
  return provided.length === computed.length && timingSafeEqual(provided, computed);
}

/**
 * Resolves the public URL Twilio signed against, from the configured base URL
 * plus the route's own path. Returns null when the base URL is unset, so the
 * caller fails closed rather than verifying against a spoofable host header.
 */
export function publicWebhookUrl(pathname: string): string | null {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}${pathname}`;
}

/** Compares a shared secret in constant time. */
export function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
