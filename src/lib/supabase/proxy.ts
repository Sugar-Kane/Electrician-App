import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";
import { isPublicPath, signInPath } from "@/lib/public-paths";

export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data } = await supabase.auth.getClaims();

  /*
   * Nobody signed in, asking for the business's own pages: sign in first.
   *
   * Without this a visitor with no session was shown the demo workspace — a
   * dashboard with an owner's name, a business and a day's figures, an account
   * menu and a Sign out button — so somebody who had just signed out saw what
   * they saw signed in. The public pages are listed in public-paths.ts.
   *
   * Only pages and the requests that fetch them. A form posted to a server
   * action is left to the action, which already answers "You are not signed
   * in": a redirect in its place would be read as the action's result.
   */
  const fetchingPage = request.method === "GET" || request.method === "HEAD";
  if (!data?.claims && fetchingPage && !isPublicPath(request.nextUrl.pathname)) {
    const destination = new URL(signInPath(request.nextUrl.pathname, request.nextUrl.search), request.url);
    const redirect = NextResponse.redirect(destination);
    // Anything the refresh above wrote — a spent session being cleared — goes
    // with it, or the browser keeps presenting the cookie that just failed.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}
