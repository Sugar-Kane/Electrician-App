import { headers } from "next/headers";

import { originFromHeaders, startBookingCheckout } from "@/lib/booking-checkout";
import { getBookingPaymentIntent } from "@/lib/public-booking";

/**
 * The link a text message carries.
 *
 * A customer who books by text has no account, no session and no form to
 * submit — they have a phone and one unguessable token. Tapping it starts the
 * same Stripe checkout the web booking page starts, against the same booking,
 * for the same fee.
 *
 * A route rather than a page, because there is nothing to look at: the whole
 * job is to work out whether this booking still wants paying and send the
 * person to Stripe. Every way that can fail lands them on their own booking
 * page with a word about why, which is the only screen they can read without
 * signing in to anything.
 */

export const runtime = "nodejs";
// Never cached. Two people tapping the same link a day apart must each get a
// live answer about a booking whose state has moved on.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const origin = originFromHeaders(await headers());

  const back = (why: string) =>
    Response.redirect(
      `${origin || ""}/booking/${encodeURIComponent(token)}${why ? `?pay=${why}` : ""}`,
      303,
    );

  // A malformed token is not a lookup, it is a scan. Nothing is queried for it.
  if (!UUID.test(token) || !origin) return back("unavailable");

  const intent = await getBookingPaymentIntent(token);
  if (!intent) return back("unavailable");

  // Already settled, one way or another. Both land on the booking page, which
  // is the screen that can actually say what state it is in.
  if (intent.already_paid) return back("");
  if (intent.status !== "awaiting_payment") return back("expired");

  const checkout = await startBookingCheckout({
    bookingToken: token,
    feeCents: intent.fee_cents,
    email: intent.email ?? undefined,
    organizationId: intent.organization_id,
    slug: intent.organization_slug,
    emergency: intent.priority === "emergency",
    diagnosticMinutes: intent.diagnostic_minutes,
    origin,
  });

  if ("error" in checkout) {
    console.error(`booking pay: ${checkout.error}`, { token });
    return back("unavailable");
  }

  return Response.redirect(checkout.url, 303);
}
