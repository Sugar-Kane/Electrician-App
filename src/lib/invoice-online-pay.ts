import "server-only";

import type Stripe from "stripe";

import { recordActivity } from "@/lib/activity";
import {
  canMoveAttempt,
  checkOnlinePayment,
  methodFromStripeType,
  onlineEventAction,
  type OnlineAttemptStatus,
  type OnlinePayCheck,
} from "@/lib/invoice-online-payment";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";

/**
 * Paying an invoice online from the customer's invoice link, by bank (ACH) or
 * card, through Stripe Checkout; and what Stripe later says about it.
 *
 * Service role throughout: the customer has no session, only the invoice's
 * unguessable link, and the webhook has neither. Every read is by that link or
 * by the checkout Stripe signed, never by an id somebody typed.
 *
 * Money lands in the Stripe account this deployment runs on, the same one the
 * booking deposits go to. A checkout is tagged `purpose: invoice_payment`, so
 * the booking and subscription handlers pass it by and these handle nothing
 * else.
 */

const PURPOSE = "invoice_payment";
/** Long enough to fetch a checkbook or a bank login; Stripe's longest is 24 hours. */
const CHECKOUT_HOURS = 23;

type Database = ReturnType<typeof getSupabaseAdmin>;

export type InvoiceForPayment = {
  id: string;
  organizationId: string;
  jobId: string | null;
  invoiceNumber: string;
  businessName: string;
  customerEmail: string;
  check: OnlinePayCheck;
  /** The newest attempt, for the page to say how it went. */
  latest: { status: OnlineAttemptStatus; amountCents: number; method: string | null } | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function onlinePaymentsEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** The invoice behind a customer's link, and whether it can be paid online now. */
export async function invoiceForPayment(token: string, database: Database = getSupabaseAdmin()): Promise<InvoiceForPayment | null> {
  const { data } = await database
    .from("invoices")
    .select(
      `id, organization_id, job_id, invoice_number, status, total_cents, balance_due_cents, last_sent_at,
       organizations ( name ), jobs ( customers ( email ) )`,
    )
    .eq("preview_token", token)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;

  const { data: attemptRows } = await database
    .from("invoice_online_payments")
    .select("status, amount_cents, method")
    .eq("invoice_id", text(row.id))
    .order("created_at", { ascending: false })
    .limit(20);
  const attempts = ((attemptRows ?? []) as Record<string, unknown>[]).map((attempt) => ({
    status: text(attempt.status) as OnlineAttemptStatus,
    amountCents: Number(attempt.amount_cents) || 0,
    method: text(attempt.method) || null,
  }));

  const organization = (row.organizations ?? null) as Record<string, unknown> | null;
  const job = (row.jobs ?? null) as Record<string, unknown> | null;
  const customer = (job?.customers ?? null) as Record<string, unknown> | null;

  return {
    id: text(row.id),
    organizationId: text(row.organization_id),
    jobId: text(row.job_id) || null,
    invoiceNumber: String(row.invoice_number ?? ""),
    businessName: text(organization?.name) || "Your electrician",
    customerEmail: text(customer?.email),
    check: checkOnlinePayment({
      status: text(row.status),
      lastSentAt: text(row.last_sent_at) || null,
      totalCents: Number(row.total_cents) || 0,
      balanceDueCents: row.balance_due_cents === null || row.balance_due_cents === undefined ? null : Number(row.balance_due_cents),
      attempts,
    }),
    latest: attempts[0] ?? null,
  };
}

export type InvoiceCheckoutResult = { url: string } | { error: "unavailable" | "not_payable" | "processing" };

/** A Stripe checkout for what is owed on this invoice, offering bank (ACH) and card. */
export async function startInvoiceCheckout(input: { token: string; origin: string }): Promise<InvoiceCheckoutResult> {
  const stripe = getStripe();
  if (!stripe || !input.origin) return { error: "unavailable" };

  const database = getSupabaseAdmin();
  const invoice = await invoiceForPayment(input.token, database);
  if (!invoice) return { error: "unavailable" };
  if (!invoice.check.ok) return { error: invoice.check.reason === "processing" ? "processing" : "not_payable" };
  const amountCents = invoice.check.amountCents;

  // A second tap on Pay returns to the checkout already open for this amount,
  // rather than opening another one the customer could also pay.
  const { data: open } = await database
    .from("invoice_online_payments")
    .select("checkout_session_id")
    .eq("invoice_id", invoice.id)
    .eq("status", "open")
    .eq("amount_cents", amountCents)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const openId = text((open as Record<string, unknown> | null)?.checkout_session_id);
  if (openId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(openId);
      if (session.status === "open" && session.url) return { url: session.url };
    } catch {
      // Gone or unreadable: a new checkout below.
    }
  }

  const back = `${input.origin}/invoice/${encodeURIComponent(input.token)}`;
  const metadata = { purpose: PURPOSE, invoice_id: invoice.id, organization_id: invoice.organizationId };
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    // Bank first: for a bill of hundreds or thousands of dollars it is the
    // cheaper way to pay, and Stripe verifies the account instantly by bank
    // sign-in where it can, so the customer isn't waiting on test deposits.
    payment_method_types: ["us_bank_account", "card"],
    payment_method_options: {
      us_bank_account: { verification_method: "automatic" },
    },
    customer_email: invoice.customerEmail || undefined,
    expires_at: Math.floor(Date.now() / 1_000) + CHECKOUT_HOURS * 3_600,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: `Invoice INV-${invoice.invoiceNumber}`,
            description: invoice.businessName,
          },
        },
      },
    ],
    metadata,
    payment_intent_data: {
      description: `${invoice.businessName} invoice INV-${invoice.invoiceNumber}`,
      metadata,
    },
    success_url: `${back}?paid=1`,
    cancel_url: back,
  };

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(params);
  } catch (error) {
    // An account without bank payments turned on still takes cards, rather
    // than leaving the customer with no way to pay at all.
    const message = String((error as { message?: unknown })?.message ?? error);
    if (!/us_bank_account/i.test(message)) {
      console.error("invoice checkout failed", { invoiceId: invoice.id, message: message.slice(0, 300) });
      return { error: "unavailable" };
    }
    console.error("invoice checkout: bank payments unavailable, offering card only", { message: message.slice(0, 300) });
    try {
      session = await stripe.checkout.sessions.create({ ...params, payment_method_types: ["card"], payment_method_options: undefined });
    } catch (retry) {
      console.error("invoice checkout failed", { invoiceId: invoice.id, message: String(retry).slice(0, 300) });
      return { error: "unavailable" };
    }
  }

  const { error: insertError } = await database.from("invoice_online_payments").insert({
    organization_id: invoice.organizationId,
    invoice_id: invoice.id,
    job_id: invoice.jobId,
    checkout_session_id: session.id,
    amount_cents: amountCents,
    status: "open",
  });
  // A checkout the webhook cannot match to an invoice is money nobody can
  // account for, so it is closed rather than shown.
  if (insertError || !session.url) {
    console.error("invoice checkout not recorded", { invoiceId: invoice.id, code: insertError?.code });
    await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
    return { error: "unavailable" };
  }
  return { url: session.url };
}

async function paymentMethodOf(stripe: Stripe, session: Stripe.Checkout.Session): Promise<{ method: "bank" | "card"; paymentIntentId: string; failure: string }> {
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? "";
  if (!paymentIntentId) return { method: "card", paymentIntentId: "", failure: "" };
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["payment_method"] });
    const paymentMethod = intent.payment_method && typeof intent.payment_method === "object" ? intent.payment_method : null;
    const type = paymentMethod?.type ?? intent.payment_method_types?.[0] ?? null;
    return {
      method: methodFromStripeType(type),
      paymentIntentId,
      failure: intent.last_payment_error?.message ?? "",
    };
  } catch {
    // Only a checkout that offered nothing but cards can be assumed a card.
    return { method: session.payment_method_types?.includes("us_bank_account") ? "bank" : "card", paymentIntentId, failure: "" };
  }
}

/**
 * Stripe's word on an invoice checkout. False when the checkout was not an
 * invoice payment, so the webhook hands it to the other handlers.
 *
 * Throws on a database failure, so Stripe retries the event; every step is
 * safe to repeat.
 */
export async function handleInvoiceCheckoutEvent(eventType: string, session: Stripe.Checkout.Session): Promise<boolean> {
  if (session.metadata?.purpose !== PURPOSE || session.mode !== "payment") return false;
  const action = onlineEventAction(eventType, session.payment_status);
  if (action === "ignore") return true;

  const stripe = getStripe();
  const database = getSupabaseAdmin();
  const { data: attemptRow, error: readError } = await database
    .from("invoice_online_payments")
    .select("id, organization_id, invoice_id, job_id, status, amount_cents")
    .eq("checkout_session_id", session.id)
    .maybeSingle();
  if (readError) throw new Error(`invoice payment lookup failed: ${readError.message}`);
  if (!attemptRow) {
    console.error("invoice checkout event for an unknown checkout", { session: session.id, eventType });
    return true;
  }
  const attempt = attemptRow as Record<string, unknown>;
  const from = text(attempt.status) as OnlineAttemptStatus;
  const organizationId = text(attempt.organization_id);
  const invoiceId = text(attempt.invoice_id);
  const jobId = text(attempt.job_id) || null;
  const activity = asFlexibleClient(database);

  if (action === "expired") {
    if (canMoveAttempt(from, "expired")) {
      await database.from("invoice_online_payments").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", text(attempt.id)).eq("status", from);
    }
    return true;
  }

  const paid = stripe ? await paymentMethodOf(stripe, session) : { method: "card" as const, paymentIntentId: "", failure: "" };
  const amountCents = session.amount_total ?? (Number(attempt.amount_cents) || 0);

  if (action === "processing") {
    if (!canMoveAttempt(from, "processing")) return true;
    const { error } = await database
      .from("invoice_online_payments")
      .update({ status: "processing", method: paid.method, payment_intent_id: paid.paymentIntentId || null, updated_at: new Date().toISOString() })
      .eq("id", text(attempt.id))
      .eq("status", from);
    if (error) throw new Error(`invoice payment update failed: ${error.message}`);
    await recordActivity(activity, {
      organizationId,
      eventType: "invoice.payment_processing",
      label: "Bank payment started",
      jobId,
      metadata: { amount_cents: amountCents, method: paid.method, invoice_id: invoiceId },
    });
    return true;
  }

  if (action === "failed") {
    if (!canMoveAttempt(from, "failed")) return true;
    const { error } = await database
      .from("invoice_online_payments")
      .update({ status: "failed", failure_reason: paid.failure.slice(0, 300) || null, updated_at: new Date().toISOString() })
      .eq("id", text(attempt.id))
      .eq("status", from);
    if (error) throw new Error(`invoice payment update failed: ${error.message}`);
    await recordActivity(activity, {
      organizationId,
      eventType: "invoice.payment_failed",
      label: "Bank payment failed",
      jobId,
      metadata: { amount_cents: amountCents, method: paid.method, invoice_id: invoiceId, ...(paid.failure ? { note: paid.failure.slice(0, 200) } : {}) },
    });
    return true;
  }

  // settle
  if (!canMoveAttempt(from, "succeeded")) return true;
  const { data: settled, error } = await database.rpc("settle_invoice_online_payment", {
    p_checkout_session_id: session.id,
    p_payment_intent_id: paid.paymentIntentId,
    p_method: paid.method,
    p_amount_cents: amountCents,
  });
  if (error) throw new Error(`invoice payment settle failed: ${error.message}`);
  const result = (Array.isArray(settled) ? settled[0] : settled) as
    | { status?: string; overpaid_cents?: number; newly_recorded?: boolean }
    | null;
  if (!result?.newly_recorded) return true;

  await recordActivity(activity, {
    organizationId,
    eventType: result.status === "paid" ? "invoice.paid" : "invoice.partially_paid",
    label: result.status === "paid" ? "Invoice paid online" : "Part payment made online",
    jobId,
    metadata: { amount_cents: amountCents, method: paid.method, via: "online", invoice_id: invoiceId },
  });
  if ((result.overpaid_cents ?? 0) > 0) {
    await recordActivity(activity, {
      organizationId,
      eventType: "invoice.overpaid",
      label: "Paid more than was owed",
      jobId,
      metadata: { amount_cents: result.overpaid_cents, invoice_id: invoiceId, note: "Refund the difference from Stripe." },
    });
  }
  return true;
}
