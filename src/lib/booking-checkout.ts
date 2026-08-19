import "server-only";

import { attachCheckoutToBooking } from "@/lib/public-booking";
import { getStripe } from "@/lib/stripe";

/**
 * Turning a held booking into a Stripe checkout.
 *
 * Lifted out of the web booking action so the same code serves the link a text
 * message carries. The two paths reach it differently — a form submission and a
 * tapped URL — and the thing they must not do differently is what gets charged,
 * what the customer is told they are paying for, and which booking the money
 * lands against.
 *
 * The session is attached to the booking before the customer ever sees it: an
 * unattached session is money the webhook cannot match to an appointment, and
 * the attach failing is a reason to abandon the checkout rather than to hope.
 */

export type CheckoutResult = { url: string } | { error: string };

/** The origin to build return URLs from, preferring what the request actually used. */
export function originFromHeaders(requestHeaders: Headers): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const origin = requestHeaders.get("origin");
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const candidate = origin || configured || (host ? `${protocol}://${host}` : "");

  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
  } catch {
    return "";
  }
}

export async function startBookingCheckout(input: {
  /** The booking's own unguessable token, and the key the webhook matches on. */
  bookingToken: string;
  feeCents: number;
  /** Prefills the receipt address. Absent for a booking taken by text. */
  email?: string;
  organizationId: string;
  /** Where the customer is sent back to, on this business's booking page. */
  slug: string;
  emergency: boolean;
  diagnosticMinutes: number;
  origin: string;
  /** Carried into the payment intent for reconciliation. */
  intakeId?: string;
}): Promise<CheckoutResult> {
  const stripe = getStripe();
  if (!stripe) return { error: "Payments are not configured." };
  if (!input.origin) return { error: "This deployment has no public address." };
  if (!input.feeCents || input.feeCents <= 0) return { error: "There is nothing to pay." };

  const back = `${input.origin}/booking/${encodeURIComponent(input.bookingToken)}`;

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: input.email || undefined,
        // Half an hour, the same as the hold the slot is under. A checkout that
        // outlives the reservation invites paying for a time already given away.
        expires_at: Math.floor(Date.now() / 1_000) + 30 * 60,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: input.feeCents,
              product_data: {
                name: input.emergency
                  ? "Emergency electrical diagnostic"
                  : "Onsite electrical diagnostic",
                description: `${input.diagnosticMinutes} minutes onsite. Diagnostic fee is credited toward approved repair work.`,
              },
            },
          },
        ],
        metadata: {
          booking_token: input.bookingToken,
          booking_intake_id: input.intakeId ?? "",
          organization_id: input.organizationId,
          organization_slug: input.slug,
        },
        payment_intent_data: {
          metadata: {
            booking_intake_id: input.intakeId ?? "",
            organization_id: input.organizationId,
          },
        },
        success_url: `${input.origin}/book/${encodeURIComponent(input.slug)}/confirmation?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${back}?pay=canceled`,
      },
      {
        // Two taps on the same texted link produce one checkout, not two.
        idempotencyKey: `booking-checkout-${input.bookingToken}`,
      },
    );

    if (!session.url || !(await attachCheckoutToBooking(input.bookingToken, session.id))) {
      await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
      return { error: "The appointment hold could not be completed." };
    }

    return { url: session.url };
  } catch {
    return { error: "Secure checkout could not be started." };
  }
}
