import type Stripe from "stripe";

import { handleInvoiceCheckoutEvent } from "@/lib/invoice-online-pay";
import { fulfillPaidBooking, releaseExpiredBooking } from "@/lib/stripe-booking";
import { getStripe } from "@/lib/stripe";
import {
  fulfillSubscriptionCheckout,
  syncStripeSubscription,
} from "@/lib/stripe-subscription";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");

  if (!stripe || !webhookSecret) {
    return Response.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }
  if (!signature) {
    return Response.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const rawBody = await request.text();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return Response.json({ error: "Invalid Stripe signature." }, { status: 400 });
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
      if (await handleInvoiceCheckoutEvent(event.type, event.data.object)) {
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
      await fulfillPaidBooking(event.data.object);
      await fulfillSubscriptionCheckout(event.data.object);
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
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    try {
      await syncStripeSubscription(event.data.object);
    } catch {
      return Response.json({ error: "Subscription sync failed." }, { status: 500 });
    }
  }

  return Response.json({ received: true });
}
