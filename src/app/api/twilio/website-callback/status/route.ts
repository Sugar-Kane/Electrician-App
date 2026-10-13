import { NextResponse } from "next/server";

import { sendCallbackOutcomeAlert } from "@/lib/booking-notifications";
import { loadIntakeContext } from "@/lib/intake-shared";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isTwilioConfigured, twilioWebhookUrls, verifyTwilioSignature } from "@/lib/twilio";
import { callbackNeedsOwner, callbackOutcomeFor } from "@/lib/website-intake";

/**
 * How a call back ended.
 *
 * Moving the request into its final outcome is the once-only claim: Twilio may
 * deliver this more than once, and only the delivery that makes the move tells
 * the owner. They hear about it when nobody was reached, or when Maya reached
 * the customer and nothing came of it; a booking or a callback request
 * announces itself.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = typeof value === "string" ? value : "";
  });

  if (
    !verifyTwilioSignature({
      signature: request.headers.get("x-twilio-signature"),
      url: twilioWebhookUrls(request),
      params,
    })
  ) {
    return new NextResponse(
      isTwilioConfigured() ? "Invalid signature" : "TWILIO_AUTH_TOKEN is not set on this deployment",
      { status: 403 },
    );
  }

  const outcome = callbackOutcomeFor({ callStatus: params.CallStatus ?? "", answeredBy: params.AnsweredBy ?? "" });
  const callSid = params.CallSid ?? "";
  if (!outcome || !/^CA[0-9a-f]{32}$/.test(callSid)) return NextResponse.json({ ignored: true });

  const database = getSupabaseAdmin();
  const { data: claimed } = await database
    .from("booking_requests")
    .update({ callback_outcome: outcome })
    .eq("callback_call_sid", callSid)
    .in("callback_outcome", ["calling", "answered"])
    .select("id, organization_id, contact_name, phone, intent, status, arrival_window_start")
    .maybeSingle();
  if (!claimed) return NextResponse.json({ ok: true, repeat: true });

  const handOff = callbackNeedsOwner(outcome, {
    booked: Boolean(claimed.arrival_window_start) || !["new", "needs_review"].includes(String(claimed.status)),
    handedOff: claimed.intent === "callback",
  });
  if (handOff) {
    try {
      const loaded = await loadIntakeContext({
        database,
        organizationId: String(claimed.organization_id),
        isFirstReply: false,
      });
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
      await sendCallbackOutcomeAlert({
        requestId: String(claimed.id),
        businessName: loaded.context.businessName,
        owner: loaded.owner,
        messagingServiceSid: loaded.messagingServiceSid,
        facts: {
          contactName: String(claimed.contact_name ?? ""),
          customerPhone: String(claimed.phone ?? ""),
          outcome: handOff,
          link: appUrl ? `${appUrl}/booking-requests` : undefined,
        },
      });
    } catch (error) {
      console.error("call back outcome alert failed", { requestId: claimed.id, error: String(error) });
    }
  }

  return NextResponse.json({ ok: true, outcome });
}
