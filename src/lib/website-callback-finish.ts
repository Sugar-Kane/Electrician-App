import "server-only";

import { sendCallbackOutcomeAlert } from "@/lib/booking-notifications";
import { loadIntakeContext } from "@/lib/intake-shared";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { callbackNeedsOwner, type CallbackOutcome } from "@/lib/website-intake";

type Database = ReturnType<typeof getSupabaseAdmin>;

/**
 * Settle how a call back ended, once.
 *
 * Moving the request into its final outcome is the once-only claim: Twilio may
 * deliver a status more than once, and a machine verdict and the call's end
 * both report on the same call. Only the delivery that makes the move tells
 * the owner. They hear about it when nobody was reached, or when Maya reached
 * the customer and nothing came of it; a booking or a callback request
 * announces itself.
 *
 * Returns false when another delivery already settled it.
 */
export async function finishWebsiteCallback(input: {
  database: Database;
  callSid: string;
  outcome: CallbackOutcome;
}): Promise<boolean> {
  const { data: claimed } = await input.database
    .from("booking_requests")
    .update({ callback_outcome: input.outcome })
    .eq("callback_call_sid", input.callSid)
    .in("callback_outcome", ["calling", "answered"])
    .select("id, organization_id, contact_name, phone, intent, status, arrival_window_start")
    .maybeSingle();
  if (!claimed) return false;

  const handOff = callbackNeedsOwner(input.outcome, {
    booked: Boolean(claimed.arrival_window_start) || !["new", "needs_review"].includes(String(claimed.status)),
    handedOff: claimed.intent === "callback",
  });
  if (handOff) {
    try {
      const loaded = await loadIntakeContext({
        database: input.database,
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
  return true;
}
