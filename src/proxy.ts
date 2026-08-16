import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";
import { bookingHostFor } from "@/lib/tenant-domain";

/**
 * Two jobs, and the order between them matters.
 *
 * This file moved here from the repository root, and the move is a fix rather
 * than tidying. Next resolves the proxy convention next to `app`, which in this
 * project is `src/app` — so a `proxy.ts` at the root is never loaded, and the
 * session refresh below has silently not been running. Measured, not guessed:
 * the request timings print a `proxy.ts` segment only when the file is under
 * `src`, and a diagnostic branch added to the root copy never once responded.
 *
 * Every request to the product refreshes the Supabase session, which is what
 * this file has always meant to do. A request arriving on an electrician's own domain
 * — `book.acmeelectric.com` pointed here with a CNAME — is a member of the
 * public looking to book, and is sent to that tenant's booking page instead.
 *
 * The booking branch returns before `updateSession`, deliberately. A customer
 * booking a diagnostic has no session to refresh, and running it would set our
 * auth cookies on a domain the electrician owns — cookies nothing on that
 * hostname will ever read, on a page that only needs the anonymous key.
 *
 * The host lookup itself is a string comparison and nothing more. Resolving the
 * tenant here would put a database query in front of every page load in the
 * product, so the rewritten route does that where the framework can cache it.
 *
 * A rewrite rather than a redirect: the customer stays on their electrician's
 * hostname, which is the entire point, and the page stays a top-level document
 * on a name we hold a certificate for. That is also why none of this needs an
 * exception to the `frame-ancestors 'none'` header in `next.config.ts` that
 * keeps the SMS consent checkbox honest.
 */
export async function proxy(request: NextRequest) {
  const bookingHost = bookingHostFor({
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  });

  // API routes keep their canonical meaning on every hostname. Twilio and
  // Stripe call them by the app's own URL, and a tenant domain has no business
  // rewriting them into a booking page.
  const isApi = request.nextUrl.pathname.startsWith("/api/");

  if (bookingHost !== "" && !isApi) {
    const url = request.nextUrl.clone();
    url.pathname = `/book/by-host${
      request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname
    }`;

    // On the *request*. A header set on the response goes to the browser and
    // never reaches the page being rendered, which is the whole reason it is
    // being set.
    const headers = new Headers(request.headers);
    headers.set("x-booking-host", bookingHost);

    return NextResponse.rewrite(url, { request: { headers } });
  }

  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
