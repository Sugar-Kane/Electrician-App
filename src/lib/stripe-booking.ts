import "server-only";

import type Stripe from "stripe";

import { sendJobEventMessage } from "@/lib/automatic-messages";
import {
  confirmPublicBookingPayment,
  expirePublicBookingCheckout,
  getPublicBookingConfirmation,
} from "@/lib/public-booking";

export async function fulfillPaidBooking(session: Stripe.Checkout.Session) {
  const bookingToken = session.metadata?.booking_token;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? "";

  if (
    session.mode !== "payment" ||
    session.payment_status !== "paid" ||
    !bookingToken ||
    !session.amount_total ||
    !session.currency
  ) {
    return null;
  }

  const jobId = await confirmPublicBookingPayment({
    bookingToken,
    checkoutSessionId: session.id,
    paymentIntentId,
    amountCents: session.amount_total,
    currency: session.currency,
  });

  // The booking is already paid and the job already exists by this point, so a
  // messaging failure must not throw: it would fail the Stripe webhook and earn
  // a retry that re-runs fulfillment. sendJobEventMessage swallows its own
  // errors and reports the outcome instead.
  if (jobId) await sendJobEventMessage({ jobId, trigger: "job_confirmed" });

  return getPublicBookingConfirmation(bookingToken, session.id);
}

export async function releaseExpiredBooking(session: Stripe.Checkout.Session) {
  const bookingToken = session.metadata?.booking_token;
  if (!bookingToken) return false;

  return expirePublicBookingCheckout(bookingToken, session.id);
}
