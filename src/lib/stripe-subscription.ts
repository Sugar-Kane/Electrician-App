import "server-only";

import type Stripe from "stripe";

import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";

function isoFromUnix(value: number | null | undefined) {
  return value ? new Date(value * 1000).toISOString() : null;
}

async function organizationIdFor(subscription: Stripe.Subscription) {
  if (subscription.metadata.organization_id) return subscription.metadata.organization_id;

  const database = asFlexibleClient(getSupabaseAdmin());
  const existing = await database
    .from("organization_subscriptions")
    .select("organization_id")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();
  return typeof existing.data?.organization_id === "string"
    ? existing.data.organization_id
    : null;
}

export async function syncStripeSubscription(subscription: Stripe.Subscription) {
  const organizationId = await organizationIdFor(subscription);
  if (!organizationId) return false;

  const item = subscription.items.data[0];
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const database = asFlexibleClient(getSupabaseAdmin());
  const { error } = await database.from("organization_subscriptions").upsert(
    {
      organization_id: organizationId,
      provider: "stripe",
      plan: "premium",
      status: subscription.status,
      seats: item?.quantity ?? 1,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: item?.price.id ?? null,
      current_period_end: isoFromUnix(item?.current_period_end),
      cancel_at_period_end: subscription.cancel_at_period_end,
      trial_ends_at: isoFromUnix(subscription.trial_end),
    },
    { onConflict: "organization_id" },
  );
  if (error) throw error;
  return true;
}

export async function fulfillSubscriptionCheckout(session: Stripe.Checkout.Session) {
  if (
    session.mode !== "subscription" ||
    session.metadata?.purpose !== "volterra_subscription"
  ) {
    return false;
  }

  const stripe = getStripe();
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  if (!stripe || !subscriptionId) return false;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await syncStripeSubscription(subscription);
  return true;
}
