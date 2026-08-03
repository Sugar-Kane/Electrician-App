import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getSafeNextPath } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/server";

function redirectTo(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const nextPath = getSafeNextPath(requestUrl.searchParams.get("next"));

  try {
    const supabase = await createClient();
    const result = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : tokenHash && type
        ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        : { error: new Error("The confirmation link is incomplete.") };

    if (!result.error) return redirectTo(request, nextPath);
  } catch {
    // The login page presents a safe, user-facing callback error.
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("error", "That sign-in link is invalid or has expired. Please try again.");
  loginUrl.searchParams.set("next", nextPath);
  return NextResponse.redirect(loginUrl, 303);
}
