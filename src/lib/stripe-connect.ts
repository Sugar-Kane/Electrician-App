import "server-only";

import type Stripe from "stripe";

import { platformFeeCents } from "@/lib/invoice-math";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Each business takes its customers' money into its own Stripe account.
 *
 * Volteira's Stripe account is the platform. A business (Nick's, say)
 * connects a Stripe account of its own from Settings, and from then on a
 * customer's booking deposit and invoice payment are charged on that account
 * directly: the money is the business's, Stripe's processing fee comes out of
 * the business's side as it would with any card reader, and Volteira's
 * percentage is taken as an application fee on the way through.
 *
 * Until a business has connected an account that Stripe lets take charges,
 * nothing is collected online for it: invoices say to call, and a booking
 * that would need a deposit is left as a request for a person.
 */

export type PaymentAccount = {
  accountId: string;
  /** Stripe lets it take charges: onboarding is finished and nothing is overdue. */
  ready: boolean;
};

type Database = ReturnType<typeof getSupabaseAdmin>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The business's connected account, ready or not. Null when it has never started. */
export async function paymentAccountFor(
  organizationId: string,
  database: Database = getSupabaseAdmin(),
): Promise<PaymentAccount | null> {
  if (!organizationId) return null;
  const { data } = await database
    .from("stripe_connect_accounts")
    .select("stripe_account_id, charges_enabled, onboarding_status")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const row = (data ?? null) as Record<string, unknown> | null;
  const accountId = text(row?.stripe_account_id);
  if (!accountId) return null;
  return { accountId, ready: row?.charges_enabled === true && row?.onboarding_status !== "disabled" };
}

/** A connected account that can take a charge now, or null. */
export async function readyPaymentAccount(organizationId: string): Promise<PaymentAccount | null> {
  if (!getStripe()) return null;
  const account = await paymentAccountFor(organizationId);
  return account?.ready ? account : null;
}

/** Volteira's share of a customer payment, taken as Stripe's application fee. */
export function volteiraFeeCents(amountCents: number): number {
  return platformFeeCents(amountCents);
}

function onboardingStatus(account: Stripe.Account): "pending" | "restricted" | "active" | "disabled" {
  if (account.requirements?.disabled_reason?.startsWith("rejected")) return "disabled";
  if (account.charges_enabled && account.payouts_enabled) return "active";
  if (account.details_submitted) return "restricted";
  return "pending";
}

/** What Stripe says about a connected account, kept on the business's row. */
export async function syncPaymentAccount(account: Stripe.Account): Promise<boolean> {
  const database = getSupabaseAdmin();
  const status = onboardingStatus(account);
  const { data, error } = await database
    .from("stripe_connect_accounts")
    .update({
      onboarding_status: status,
      charges_enabled: account.charges_enabled === true,
      payouts_enabled: account.payouts_enabled === true,
      details_submitted: account.details_submitted === true,
      currently_due: account.requirements?.currently_due ?? [],
      eventually_due: account.requirements?.eventually_due ?? [],
      past_due: account.requirements?.past_due ?? [],
      disabled_reason: account.requirements?.disabled_reason ?? null,
      onboarding_completed_at: status === "active" ? new Date().toISOString() : null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_account_id", account.id)
    .select("organization_id");
  if (error) throw new Error(`payment account sync failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Read the account from Stripe now and keep what it says. */
export async function refreshPaymentAccount(organizationId: string): Promise<PaymentAccount | null> {
  const stripe = getStripe();
  const known = await paymentAccountFor(organizationId);
  if (!stripe || !known) return known;
  try {
    const account = await stripe.accounts.retrieve(known.accountId);
    await syncPaymentAccount(account);
    return { accountId: account.id, ready: account.charges_enabled === true };
  } catch (error) {
    console.error("payment account refresh failed", { organizationId, message: String(error).slice(0, 200) });
    return known;
  }
}

/**
 * Stripe's onboarding page for this business: its own account, opened the
 * first time, then the link to finish whatever Stripe still needs.
 */
export async function paymentsOnboardingUrl(input: {
  organizationId: string;
  businessName: string;
  email: string;
  origin: string;
}): Promise<{ url: string } | { error: string }> {
  const stripe = getStripe();
  if (!stripe) return { error: "Payments are not configured on this deployment." };
  if (!input.origin) return { error: "This deployment has no public address." };

  const database = getSupabaseAdmin();
  let accountId = (await paymentAccountFor(input.organizationId, database))?.accountId ?? "";

  if (!accountId) {
    try {
      const account = await stripe.accounts.create({
        country: "US",
        email: input.email || undefined,
        business_profile: { name: input.businessName || undefined, mcc: "1731" },
        // The business's own Stripe account and dashboard. It pays Stripe's
        // processing fees on its own charges, and Stripe, not Volteira, is
        // responsible for its balance going negative.
        controller: {
          stripe_dashboard: { type: "full" },
          fees: { payer: "account" },
          losses: { payments: "stripe" },
        },
        metadata: { organization_id: input.organizationId },
      });
      accountId = account.id;
    } catch (error) {
      console.error("payment account create failed", { message: String(error).slice(0, 300) });
      return { error: "Stripe could not start the setup. Try again in a minute." };
    }

    const { error } = await database.from("stripe_connect_accounts").insert({
      organization_id: input.organizationId,
      stripe_account_id: accountId,
      onboarding_status: "pending",
      fee_payer: "account",
    });
    if (error) {
      console.error("payment account not recorded", { code: error.code, accountId });
      return { error: "The new Stripe account could not be saved. Try again." };
    }
  }

  try {
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${input.origin}/settings/payments/start`,
      return_url: `${input.origin}/settings/integrations?payments=return#payments`,
    });
    return { url: link.url };
  } catch (error) {
    console.error("payment onboarding link failed", { message: String(error).slice(0, 300) });
    return { error: "Stripe could not open the setup page. Try again in a minute." };
  }
}
