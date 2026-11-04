import { headers } from "next/headers";

import { originFromHeaders } from "@/lib/booking-checkout";
import { currentContext } from "@/lib/request-context";
import { paymentsOnboardingUrl } from "@/lib/stripe-connect";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Setting up payments: off to Stripe's onboarding for this business's own
 * account. The Set up payments button posts here, and Stripe sends the owner
 * back here when an onboarding link has expired, for a fresh one.
 *
 * Owner only. Whose money it is, and which bank it is paid out to, is the
 * owner's decision.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function start(): Promise<Response> {
  const origin = originFromHeaders(await headers());
  const back = (why: string) => Response.redirect(`${origin}/settings/payments?payments=${why}`, 303);

  const context = await currentContext();
  if (!context) return Response.redirect(`${origin}/login?next=/settings/payments`, 303);
  if (context.role !== "owner") return back("owner_only");

  const { data } = await getSupabaseAdmin()
    .from("organizations")
    .select("name")
    .eq("id", context.organizationId)
    .maybeSingle();

  const result = await paymentsOnboardingUrl({
    organizationId: context.organizationId,
    businessName: typeof data?.name === "string" ? data.name : "",
    email: context.email,
    origin,
  });
  if ("error" in result) return back("error");
  return Response.redirect(result.url, 303);
}

export const GET = start;
export const POST = start;
