/**
 * The page Content Security Policy: scripts run only when they carry this
 * request's nonce, or were loaded by a script that did ('strict-dynamic').
 * Injected markup (a <script> tag, an onclick, a javascript: URL) does not run.
 *
 * - 'unsafe-eval' and blob: are there for the Google Maps JavaScript API,
 *   which Google's strict-CSP guidance lists them for. The router switches
 *   pages without reloading, so a map page keeps whichever policy the first
 *   page had; they cannot be limited to map pages.
 * - https: and 'unsafe-inline' are ignored by every browser that understands
 *   nonces and 'strict-dynamic'; they keep very old browsers working.
 * - Only scripts, plugins, <base> and framing are restricted. Images, styles,
 *   fonts and connections stay open: Maps, Supabase, Stripe and blob storage
 *   all need them, and none of them run code.
 *
 * Import-free so it can be tested on its own.
 */
export function contentSecurityPolicy(input: { nonce: string; preview: boolean }): string {
  const frameAncestors = input.preview ? "'self' https://vercel.live" : "'none'";
  return [
    `script-src 'self' 'nonce-${input.nonce}' 'strict-dynamic' 'unsafe-eval' blob: https: 'unsafe-inline'`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join("; ");
}

/** A fresh, unguessable nonce for one response. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
