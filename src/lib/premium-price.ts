import "server-only";

import { getStripe } from "@/lib/stripe";

/**
 * What Premium costs, as Stripe has it, so the account page never quotes a
 * different price from the one checkout charges. Null when no price is set
 * (STRIPE_PREMIUM_PRICE_ID) or Stripe cannot be asked.
 */
export async function premiumPriceLabel(): Promise<string | null> {
  const priceId = process.env.STRIPE_PREMIUM_PRICE_ID;
  const stripe = getStripe();
  if (!priceId || !stripe) return null;
  try {
    const price = await stripe.prices.retrieve(priceId);
    if (typeof price.unit_amount !== "number") return null;
    const amount = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (price.currency || "usd").toUpperCase(),
      maximumFractionDigits: price.unit_amount % 100 === 0 ? 0 : 2,
    }).format(price.unit_amount / 100);
    const interval = price.recurring?.interval;
    return interval ? `${amount} a ${interval}` : amount;
  } catch (error) {
    console.error("premium price could not be read", { message: String(error).slice(0, 200) });
    return null;
  }
}
