/**
 * Which pages anybody may open without signing in, and where everybody else
 * is sent.
 *
 * The product is behind a login — robots.txt has said so for months — but
 * nothing enforced it. A visitor with no session was shown the demo workspace:
 * a dashboard with a business name, an owner's name and a day's figures, an
 * account menu and a Sign out button. Somebody who had just signed out saw
 * exactly what they saw signed in, and reasonably concluded that signing out
 * had not worked.
 *
 * The public pages are the ones a customer or a stranger is sent to: the front
 * page, the demo, booking, paying the booking deposit, signing a contract,
 * accepting an invitation, the journal, a business's terms and privacy pages,
 * signing in and up, and the routes Twilio, Stripe and Google call. Everything
 * else is the business's own work and needs somebody signed in to see it.
 *
 * Import-free, so the rule can be tested without a request.
 */

/** Whole sections that are public, by their leading segment. */
const PUBLIC_SECTIONS = ["api", "auth", "book", "booking", "contract", "invite", "journal", "legal"];

/**
 * Single public pages and files.
 *
 * The home page is one of them, because it is two pages: the front page for a
 * visitor, and the dashboard for somebody signed in. The page decides which.
 *
 * The demo is another: a sample job a visitor can walk through before they
 * have an account, which is the whole point of it. It reads and writes
 * nothing, so there is nothing behind it to protect. So is /welcome, the front
 * page built ahead of time, which the proxy serves to a visitor asking for `/`.
 */
const PUBLIC_PAGES = new Set([
  "/",
  "/welcome",
  "/demo",
  "/login",
  "/signup",
  "/robots.txt",
  "/sitemap.xml",
  "/icon.svg",
  "/favicon.ico",
]);

export function isPublicPath(pathname: string): boolean {
  const path = (pathname || "/").replace(/\/+$/, "") || "/";
  if (PUBLIC_PAGES.has(path)) return true;
  const section = path.split("/")[1] ?? "";
  return PUBLIC_SECTIONS.includes(section);
}

/**
 * Where a signed-out visitor to a private page goes: the sign-in page, which
 * sends them back to what they asked for once they are in. The home page is
 * where signing in lands anyway, so it is not repeated.
 */
export function signInPath(pathname: string, search = ""): string {
  const asked = `${pathname || "/"}${search}`;
  return asked === "/" ? "/login" : `/login?next=${encodeURIComponent(asked)}`;
}
