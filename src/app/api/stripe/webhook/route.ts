import type Stripe from "stripe";

import { handleInvoiceCheckoutEvent } from "@/lib/invoice-online-pay";
import { fulfillPaidBooking, releaseExpiredBooking } from "@/lib/stripe-booking";
import { getStripe } from "@/lib/stripe";
import { syncPaymentAccount } from "@/lib/stripe-connect";
import {
  fulfillSubscriptionCheckout,
  syncStripeSubscription,
} from "@/lib/stripe-subscription";

export const runtime = "nodejs";

/**
 * Stripe's events, from two destinations on Volteira's platform account:
 *
 * - "Your account" (`STRIPE_WEBHOOK_SECRET`): Volteira's own memberships.
 * - "Connected accounts" (`STRIPE_CONNECT_WEBHOOK_SECRET`): each business's own
 *   charges (booking deposits and invoice payments) and its account's setup.
 *   These carry `event.account`.
 *
 * Each destination signs with its own secret, so an event is believed when
 * either one verifies it.
 */
function verify(stripe: Stripe, rawBody: string, signature: string): Stripe.Event | null {
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(
    (secret): secret is string => Boolean(secret),
  );
  for (const secret of secrets) {
    try {
      return stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      // Try the other destination's secret.
    }
  }
  return null;
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const signature = request.headers.get("stripe-signature");

  if (!stripe || (!process.env.STRIPE_WEBHOOK_SECRET && !process.env.STRIPE_CONNECT_WEBHOOK_SECRET)) {
    return Response.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }
  if (!signature) {
    return Response.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  const event = verify(stripe, await request.text(), signature);
  if (!event) {
    return Response.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }
  const connectedAccount = event.account ?? undefined;

  // A business's Stripe account changed: setup finished, details overdue, or
  // charges turned off.
  if (event.type === "account.updated") {
    try {
      await syncPaymentAccount(event.data.object);
    } catch {
      return Response.json({ error: "Payment account sync failed." }, { status: 500 });
    }
    return Response.json({ received: true });
  }

  // An invoice paid online, by bank or card. Its checkouts are tagged, so the
  // booking and subscription handlers below never see one.
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded" ||
    event.type === "checkout.session.async_payment_failed" ||
    event.type === "checkout.session.expired"
  ) {
    try {
      if (await handleInvoiceCheckoutEvent(event.type, event.data.object, connectedAccount)) {
        return Response.json({ received: true });
      }
    } catch (error) {
      console.error("invoice payment webhook failed", { type: event.type, message: String(error).slice(0, 300) });
      return Response.json({ error: "Invoice payment update failed." }, { status: 500 });
    }
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    try {
      // A booking is only confirmed by the very checkout attached to it, so a
      // deposit is believed from whichever account it was charged on.
      await fulfillPaidBooking(event.data.object);
      // Memberships are Volteira's own, never a connected account's.
      if (!connectedAccount) await fulfillSubscriptionCheckout(event.data.object);
    } catch {
      return Response.json({ error: "Checkout fulfillment failed." }, { status: 500 });
    }
  }

  if (event.type === "checkout.session.expired") {
    try {
      await releaseExpiredBooking(event.data.object);
    } catch {
      return Response.json({ error: "Booking hold release failed." }, { status: 500 });
    }
  }

  if (
    !connectedAccount &&
    (event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted")
  ) {
    try {
      await syncStripeSubscription(event.data.object);
    } catch {
      return Response.json({ error: "Subscription sync failed." }, { status: 500 });
    }
  }

  return Response.json({ received: true });
}
