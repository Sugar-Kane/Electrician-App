/**
 * Whether a state-changing request came from this app's own pages.
 *
 * Browsers send Origin on every cross-site POST. Session cookies are
 * SameSite=Lax already; this refuses a forged form or fetch outright, even
 * from a browser or proxy that doesn't honour that. Import-free.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
