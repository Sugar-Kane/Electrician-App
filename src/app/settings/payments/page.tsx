import type { Metadata } from "next";

import { FieldPageShell } from "@/components/field-page-shell";
import { PaymentsCard, type PaymentsCardState } from "./payments-card";
import { PLATFORM_FEE_BASIS_POINTS } from "@/lib/invoice-math";
import { currentContext } from "@/lib/request-context";
import { refreshPaymentAccount } from "@/lib/stripe-connect";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Get paid online | Volteira" };

/**
 * Taking customers' money online: the business's own Stripe account.
 *
 * Its own page, one tap from Settings and from the account menu, because it is
 * the setting people come looking for and it used to be a card halfway down
 * the integrations page.
 */
export default async function PaymentsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ payments?: string }>;
}) {
  const query = await searchParams;
  const context = await currentContext();

  // Back from Stripe's onboarding: ask Stripe how it went rather than waiting
  // for its webhook, so the page is right the moment the owner lands here.
  if (context && query.payments === "return") await refreshPaymentAccount(context.organizationId);

  const row = context
    ? ((await getSupabaseAdmin()
        .from("stripe_connect_accounts")
        .select("onboarding_status, charges_enabled, currently_due, past_due")
        .eq("organization_id", context.organizationId)
        .maybeSingle()).data as Record<string, unknown> | null)
    : null;
  const state: PaymentsCardState = !row
    ? "none"
    : row.onboarding_status === "disabled"
      ? "disabled"
      : row.charges_enabled === true
        ? "active"
        : row.onboarding_status === "restricted"
          ? "restricted"
          : "pending";
  const due = new Set([
    ...(Array.isArray(row?.currently_due) ? (row.currently_due as string[]) : []),
    ...(Array.isArray(row?.past_due) ? (row.past_due as string[]) : []),
  ]).size;
  const feePercent = `${PLATFORM_FEE_BASIS_POINTS / 100}%`;

  return (
    <FieldPageShell
      backHref="/settings"
      title="Get paid online"
      eyebrow="Settings"
      description="Let customers pay invoices and booking deposits by card or bank transfer."
    >
      {context ? (
        <PaymentsCard
          state={state}
          dueCount={due}
          canManage={context.role === "owner"}
          notice={query.payments}
          feePercent={feePercent}
        />
      ) : null}

      <section className="mt-4 rounded-panel border border-line bg-surface p-5 sm:p-6">
        <h2 className="text-base font-semibold">How it works</h2>
        <ol className="mt-3 space-y-3 text-sm leading-6 text-ink-muted">
          <li>
            <span className="font-semibold text-ink">1. Set up once.</span> Tap Set up payments and fill in your
            business, your ID and the bank account you want paid into. Stripe asks for these, not Volteira. It takes about
            10 minutes.
          </li>
          <li>
            <span className="font-semibold text-ink">2. Send invoices as usual.</span> Every invoice link gets a Pay button.
            Customers pay by card, or by bank transfer, which costs less and clears in 3–5 business days.
          </li>
          <li>
            <span className="font-semibold text-ink">3. Get paid automatically.</span> The invoice is marked paid on its own,
            and Stripe sends the money to your bank. Stripe&apos;s fee and Volteira&apos;s {feePercent} come out of each
            payment.
          </li>
        </ol>
      </section>
    </FieldPageShell>
  );
}
