import "server-only";

import type Stripe from "stripe";

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

  await confirmPublicBookingPayment({
    bookingToken,
    checkoutSessionId: session.id,
    paymentIntentId,
    amountCents: session.amount_total,
    currency: session.currency,
  });

  return getPublicBookingConfirmation(bookingToken, session.id);
}

export async function releaseExpiredBooking(session: Stripe.Checkout.Session) {
  const bookingToken = session.metadata?.booking_token;
  if (!bookingToken) return false;

  return expirePublicBookingCheckout(bookingToken, session.id);
}
