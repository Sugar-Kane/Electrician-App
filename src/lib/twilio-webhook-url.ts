/**
 * The URLs a Twilio webhook might have been signed against.
 *
 * Twilio signs the exact URL it was configured with. Reconstructing that string
 * on the server is where this goes wrong: behind Vercel's proxy `request.url`
 * can carry an internal host, and a `NEXT_PUBLIC_APP_URL` that says
 * `volteira.com` while Twilio was given `www.volteira.com` differs by four
 * characters — enough for the signature never to match.
 *
 * A mismatch used to mean a 403, which Twilio treats as a failed handler: the
 * phone silently fell through to the fallback and every caller was routed away
 * from the app. The fix is to check the signature against every spelling the
 * request could plausibly have arrived under.
 *
 * Trying several candidates does not weaken the check. Each one is still an
 * HMAC against the account auth token, so a forged Host header buys an attacker
 * nothing without that secret.
 *
 * Import-free so the reconstruction can be tested directly.
 */

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function webhookUrlCandidates(input: {
  /** NEXT_PUBLIC_APP_URL, if configured. */
  configuredOrigin?: string;
  /** The URL as this process sees it. */
  requestUrl: string;
  /** x-forwarded-proto / x-forwarded-host / host, as received. */
  forwardedProto?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
}): string[] {
  let parsed: URL;
  try {
    parsed = new URL(input.requestUrl);
  } catch {
    return [];
  }

  const path = `${parsed.pathname}${parsed.search}`;
  const candidates: string[] = [];

  const configured = input.configuredOrigin ? normalizeOrigin(input.configuredOrigin) : "";
  if (configured) {
    candidates.push(`${configured}${path}`);
    // www and the bare domain are the same site to a human and different
    // strings to an HMAC. Whichever one is configured, accept the other.
    try {
      const configuredUrl = new URL(configured);
      const flipped = configuredUrl.host.startsWith("www.")
        ? configuredUrl.host.slice(4)
        : `www.${configuredUrl.host}`;
      candidates.push(`${configuredUrl.protocol}//${flipped}${path}`);
    } catch {
      // A malformed NEXT_PUBLIC_APP_URL is not worth failing a call over.
    }
  }

  // What the proxy says the caller asked for. On Vercel this is the public
  // hostname even when request.url is internal.
  const forwardedHost = input.forwardedHost?.split(",")[0]?.trim();
  const host = forwardedHost || input.host?.trim();
  if (host) {
    const proto = (input.forwardedProto?.split(",")[0]?.trim() || "https").replace(/:$/, "");
    candidates.push(`${proto}://${host}${path}`);
  }

  candidates.push(input.requestUrl);

  return [...new Set(candidates.filter(Boolean))];
}

/**
 * The public origin a webhook request arrived on.
 *
 * Used for the URLs handed back to Twilio mid-call. Deriving them from the
 * request rather than from configuration means a wrong NEXT_PUBLIC_APP_URL
 * cannot strand a caller halfway through a conversation.
 */
export function publicOrigin(input: {
  requestUrl: string;
  forwardedProto?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
  fallbackOrigin?: string;
}): string {
  const forwardedHost = input.forwardedHost?.split(",")[0]?.trim();
  const host = forwardedHost || input.host?.trim();
  if (host) {
    const proto = (input.forwardedProto?.split(",")[0]?.trim() || "https").replace(/:$/, "");
    return `${proto}://${host}`;
  }

  try {
    return new URL(input.requestUrl).origin;
  } catch {
    return input.fallbackOrigin ? normalizeOrigin(input.fallbackOrigin) : "";
  }
}
