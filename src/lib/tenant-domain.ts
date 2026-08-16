/**
 * Telling one of our hostnames from an electrician's.
 *
 * A customer booking on `book.acmeelectric.com` must reach the same page a
 * customer on `/book/acme-electric` reaches. The routing decision happens in
 * middleware, on every request including static assets, so it has to be a
 * string comparison and nothing else — no database, no network.
 *
 * Getting it wrong in either direction is bad in a different way. Reading one of
 * our own hosts as a tenant's rewrites the whole dashboard to a booking page.
 * Reading a tenant's as ours serves them a 404 on the domain they just pointed
 * at us and paid for.
 *
 * Import-free, so the awkward hosts — a port, a trailing dot, a forwarded list,
 * an IPv6 literal — can be tested without a server.
 */

/** Hosts that are the product itself rather than somebody's booking page. */
const PLATFORM_SUFFIXES = [".vercel.app", ".localhost"];
const PLATFORM_EXACT = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"];

/**
 * One hostname, lowercased and stripped of everything that is not the name.
 *
 * Returns "" for anything that cannot be a hostname, which callers treat as a
 * platform host — the safe direction, because it serves the app rather than
 * rewriting a request nobody can explain to a booking page.
 */
export function normaliseHost(raw: string | null | undefined): string {
  let host = (raw ?? "").trim().toLowerCase();
  if (host === "") return "";

  // `x-forwarded-host` is a list when more than one proxy has touched the
  // request. The first entry is the one the browser asked for.
  const firstEntry = host.split(",")[0];
  host = (firstEntry ?? "").trim();
  if (host === "") return "";

  // A scheme should never appear here, but a misconfigured proxy can send one
  // and `new URL()` is not available to a pure function that must not throw.
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");

  // Anything after the authority is not the host.
  const cut = host.search(/[/?#]/);
  if (cut !== -1) host = host.slice(0, cut);

  // An IPv6 literal keeps its brackets and its colons; everything else loses
  // the port. Splitting on ":" unconditionally would turn "[::1]:3000" into "[".
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    host = close === -1 ? host : host.slice(0, close + 1);
  } else {
    const portAt = host.indexOf(":");
    if (portAt !== -1) host = host.slice(0, portAt);
  }

  // A fully-qualified name may end in a dot. "acme.com." and "acme.com" are the
  // same host, and only one of them matches a row.
  host = host.replace(/\.+$/, "");

  // Nothing that is not plausibly a hostname. Bracketed IPv6 is allowed through
  // because it is checked against the exact list below.
  if (!/^\[?[a-z0-9._:-]+\]?$/.test(host)) return "";

  return host;
}

/**
 * Whether this host is the app rather than a tenant's booking domain.
 *
 * `appUrl` is `NEXT_PUBLIC_APP_URL`, whatever the deployment calls itself. It is
 * passed in rather than read from the environment so the awkward cases can be
 * tested and so middleware stays a pure function of its inputs.
 */
export function isPlatformHost(host: string, appUrl: string | null | undefined): boolean {
  const normalised = normaliseHost(host);
  // Unparseable. Serving the app is the recoverable mistake.
  if (normalised === "") return true;

  if (PLATFORM_EXACT.includes(normalised)) return true;
  if (PLATFORM_SUFFIXES.some((suffix) => normalised.endsWith(suffix))) return true;

  const configured = normaliseHost((appUrl ?? "").replace(/^[a-z][a-z0-9+.-]*:\/\//, ""));
  if (configured !== "" && normalised === configured) return true;

  return false;
}

/**
 * The booking host for a request, or "" when it is an ordinary app request.
 *
 * Prefers `x-forwarded-host`: behind a proxy, `host` is whatever the proxy calls
 * itself internally, and the name the customer typed is the one that identifies
 * the tenant.
 */
export function bookingHostFor(input: {
  host: string | null | undefined;
  forwardedHost: string | null | undefined;
  appUrl: string | null | undefined;
}): string {
  const host = normaliseHost(input.forwardedHost) || normaliseHost(input.host);
  if (host === "") return "";
  return isPlatformHost(host, input.appUrl) ? "" : host;
}

/**
 * Whether a hostname a tenant typed is one they can actually point at us.
 *
 * Subdomains only. An apex needs A records rather than a CNAME, and pointing an
 * apex here would take over the electrician's whole website rather than adding a
 * booking page to it — which is not a DNS inconvenience, it is their site going
 * dark.
 *
 * The two-label test is deliberately naive about public suffixes: `acme.co.uk`
 * has three labels and is an apex, and this accepts it. Rejecting it correctly
 * needs the public suffix list, which is a dependency and a monthly update for a
 * mistake DNS will refuse anyway — the CNAME simply never verifies, and the
 * settings screen says so.
 */
export type HostCheck = { ok: true; hostname: string } | { ok: false; error: string };

export function checkBookingHostname(raw: string): HostCheck {
  const hostname = normaliseHost(raw);

  if (hostname === "") return { ok: false, error: "Enter a domain like book.yourcompany.com." };
  if (hostname.length > 253) return { ok: false, error: "That domain is too long." };

  const labels = hostname.split(".");
  if (labels.length < 3) {
    return {
      ok: false,
      error:
        "Use a subdomain like book.yourcompany.com. Pointing your main domain here would replace your website.",
    };
  }

  for (const label of labels) {
    if (label.length === 0 || label.length > 63) {
      return { ok: false, error: "That does not look like a domain." };
    }
    // Letters, digits and inner hyphens. This is the hostname rule, and a label
    // that breaks it is one no certificate will ever be issued for.
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) {
      return { ok: false, error: "That does not look like a domain." };
    }
  }

  if (isPlatformHost(hostname, null)) {
    return { ok: false, error: "That domain belongs to the app." };
  }

  return { ok: true, hostname };
}
