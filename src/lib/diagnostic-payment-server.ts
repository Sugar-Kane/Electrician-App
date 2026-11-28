import "server-only";

import type Stripe from "stripe";

import { recordActivity } from "@/lib/activity";
import { emailSender } from "@/lib/booking-confirmation";
import {
  DIAGNOSTIC_AUTHORIZATION_VERSION,
  authorizationText,
  collectionRefusal,
  creditNotice,
  displayState,
  effectiveDiagnosticPolicy,
  money,
  redactPaymentSecrets,
  settingsFromRow,
  textFingerprint,
  type AuthorizationState,
  type CollectionInput,
  type DisplayState,
  type EffectivePolicy,
  type Language,
} from "@/lib/diagnostic-payment-policy";
import { bookingLinkFor, diagnosticNotice, type NoticeKind } from "@/lib/diagnostic-payment-messages";
import { sendEmail } from "@/lib/email";
import { getStripe } from "@/lib/stripe";
import { paymentAccountFor, readyPaymentAccount, volteiraFeeCents } from "@/lib/stripe-connect";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient, type FlexibleSupabaseClient } from "@/lib/supabase/flexible";
import { sendSms } from "@/lib/twilio";

/**
 * Deferred diagnostic payments: the Stripe side.
 *
 * Booking: the customer ticks an unticked box agreeing to the exact
 * authorization text (recordDiagnosticAuthorization), then saves a card in
 * Stripe Checkout in *setup* mode on the business's own connected account
 * (startDiagnosticSetupCheckout). No PaymentIntent and no hold is made. The
 * webhook confirms the booking when the SetupIntent succeeds
 * (fulfillSetupBooking).
 *
 * Completion: once the diagnostic is documented complete, the authorized
 * amount (never more) is charged off-session (collectDiagnosticPayment). Every
 * eligibility rule is checked here for an honest message and again in the
 * database function `claim_diagnostic_charge`, under a row lock, before Stripe
 * is called with an idempotency key. The result is believed only from Stripe
 * (the PaymentIntent, or a signature-verified webhook).
 *
 * Failure: the customer gets a secure link to pay their completed bill and
 * save a new card (startDiagnosticRecovery). The voice agent has no route here.
 */

type Row = Record<string, unknown>;
type Admin = ReturnType<typeof getSupabaseAdmin>;

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function language(value: unknown): Language {
  return value === "es" ? "es" : "en";
}

function origin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
}

/** Errors that are safe to show and log: no card data, no Stripe ids or secrets. */
function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return redactPaymentSecrets(message).slice(0, 300);
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export async function loadDiagnosticPolicy(organizationId: string, database: Admin | FlexibleSupabaseClient = getSupabaseAdmin()): Promise<EffectivePolicy> {
  const db = asFlexibleClient(database as Admin);
  const [{ data: settings }, { data: organization }] = await Promise.all([
    db.from("service_settings").select("*").eq("organization_id", organizationId).maybeSingle(),
    db.from("organizations").select("base_state").eq("id", organizationId).maybeSingle(),
  ]);
  return effectiveDiagnosticPolicy(settingsFromRow(settings as Row | null, text((organization as Row | null)?.base_state)));
}

/** Whether a business's diagnostic fee waits for completion. Fails closed (true). */
export async function collectsAfterCompletion(organizationId: string): Promise<boolean> {
  try {
    return (await loadDiagnosticPolicy(organizationId)).collectAt === "after_completion";
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Booking: authorization and card setup
// ---------------------------------------------------------------------------

export async function recordDiagnosticAuthorization(input: {
  bookingToken: string;
  via: "web" | "sms" | "voice" | "portal";
  language: Language;
  businessName: string;
  feeCents: number;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ id: string; text: string } | { error: string }> {
  const agreed = authorizationText({ businessName: input.businessName, feeCents: input.feeCents, language: input.language });
  const { data, error } = await getSupabaseAdmin().rpc("record_diagnostic_authorization" as never, {
    p_booking_token: input.bookingToken,
    p_via: input.via,
    p_language: input.language,
    p_agreement_text: agreed,
    p_agreement_version: DIAGNOSTIC_AUTHORIZATION_VERSION,
    p_agreement_fingerprint: textFingerprint(agreed),
    p_ip: input.ip ?? null,
    p_user_agent: input.userAgent ?? null,
  } as never);
  if (error || typeof data !== "string") {
    console.error("diagnostic authorization not recorded", safeMessage(error));
    return { error: "Your authorization could not be saved. Please try again." };
  }
  return { id: data, text: agreed };
}

/** The business's Stripe Customer for this person, reused when one is on file. */
async function stripeCustomerFor(input: {
  stripe: Stripe;
  accountId: string;
  organizationId: string;
  customerId?: string | null;
  bookingToken: string;
  email?: string;
  name?: string;
  phone?: string;
}): Promise<string> {
  if (input.customerId) {
    const { data } = await getSupabaseAdmin()
      .from("stripe_customers" as never)
      .select("stripe_customer_id")
      .eq("organization_id", input.organizationId)
      .eq("customer_id", input.customerId)
      .eq("stripe_account_id", input.accountId)
      .maybeSingle();
    const existing = text((data as Row | null)?.stripe_customer_id);
    if (existing) return existing;
  }
  const customer = await input.stripe.customers.create(
    {
      email: input.email || undefined,
      name: input.name || undefined,
      phone: input.phone || undefined,
      metadata: { organization_id: input.organizationId, booking_token: input.bookingToken },
    },
    { stripeAccount: input.accountId, idempotencyKey: `diagnostic-customer-${input.bookingToken}` },
  );
  return customer.id;
}

export type CheckoutResult = { url: string } | { error: string };

export async function startDiagnosticSetupCheckout(input: {
  bookingToken: string;
  authorizationId: string;
  authorizationText: string;
  organizationId: string;
  slug: string;
  businessName: string;
  feeCents: number;
  email?: string;
  name?: string;
  phone?: string;
  customerId?: string | null;
  origin: string;
  expiresAt?: string;
  language?: Language;
}): Promise<CheckoutResult> {
  const stripe = getStripe();
  if (!stripe) return { error: "Payments are not configured." };
  if (!input.origin) return { error: "This deployment has no public address." };
  const account = await readyPaymentAccount(input.organizationId);
  if (!account) return { error: "This business has not set up payments yet." };
  const onAccount = { stripeAccount: account.accountId };

  const requested = input.expiresAt ? Date.parse(input.expiresAt) : Number.NaN;
  const latest = Math.floor(Date.now() / 1_000) + 24 * 60 * 60 - 60;
  const earliest = Math.floor(Date.now() / 1_000) + 31 * 60;
  const expiresAt = Math.max(
    earliest,
    Math.min(Number.isFinite(requested) ? Math.floor(requested / 1_000) : latest, latest),
  );

  try {
    const customer = await stripeCustomerFor({
      stripe,
      accountId: account.accountId,
      organizationId: input.organizationId,
      customerId: input.customerId,
      bookingToken: input.bookingToken,
      email: input.email,
      name: input.name,
      phone: input.phone,
    });
    const back = `${input.origin}/booking/${encodeURIComponent(input.bookingToken)}`;
    const metadata = {
      purpose: "diagnostic_authorization",
      booking_token: input.bookingToken,
      authorization_id: input.authorizationId,
      organization_id: input.organizationId,
      organization_slug: input.slug,
    };
    const session = await stripe.checkout.sessions.create(
      {
        mode: "setup",
        ui_mode: "hosted_page",
        customer,
        // Cards: the payment method that can be charged off-session later.
        payment_method_types: ["card"],
        locale: input.language === "es" ? "es-419" : "auto",
        expires_at: expiresAt,
        setup_intent_data: {
          description: `${input.businessName}: authorization to charge ${money(input.feeCents)} after the diagnostic service is completed. Nothing charged today.`,
          metadata,
        },
        custom_text: {
          submit: { message: input.authorizationText.slice(0, 1200) },
        },
        metadata,
        success_url: `${input.origin}/book/${encodeURIComponent(input.slug)}/confirmation?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${back}?pay=canceled`,
      },
      { idempotencyKey: `diagnostic-setup-${input.authorizationId}`, ...onAccount },
    );

    const database = getSupabaseAdmin();
    const { data: attached } = await database.rpc("attach_diagnostic_setup_checkout" as never, {
      p_authorization_id: input.authorizationId,
      p_checkout_session_id: session.id,
      p_stripe_customer_id: customer,
      p_stripe_account_id: account.accountId,
    } as never);
    const { data: onBooking } = await database.rpc("attach_public_booking_checkout", {
      p_booking_token: input.bookingToken,
      p_checkout_session_id: session.id,
    });
    if (!session.url || attached !== true || onBooking !== true) {
      await stripe.checkout.sessions.expire(session.id, undefined, onAccount).catch(() => undefined);
      return { error: "The appointment hold could not be completed." };
    }
    return { url: session.url };
  } catch (error) {
    console.error("diagnostic setup checkout failed", safeMessage(error));
    return { error: "Secure payment method setup could not be started." };
  }
}

/**
 * A setup Checkout finished. Believed only from a signature-verified webhook
 * (or the return page re-reading the session from Stripe), and only for the
 * account it happened on.
 */
export async function fulfillSetupBooking(session: Stripe.Checkout.Session, connectedAccount?: string): Promise<string | null> {
  const token = session.metadata?.booking_token;
  const organizationId = session.metadata?.organization_id;
  if (session.mode !== "setup" || session.metadata?.purpose !== "diagnostic_authorization" || !token || !organizationId) return null;
  if (session.status !== "complete") return null;

  const account = await paymentAccountFor(organizationId);
  if (!account || (connectedAccount && connectedAccount !== account.accountId)) {
    console.error("diagnostic setup on an account that is not the business's");
    return null;
  }
  const stripe = getStripe();
  if (!stripe) return null;
  const setupIntentId = typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
  if (!setupIntentId) return null;
  const intent = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] }, { stripeAccount: account.accountId });
  if (intent.status !== "succeeded" || !intent.payment_method) return null;
  const method = typeof intent.payment_method === "string" ? null : intent.payment_method;
  const methodId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method.id;
  const customerId = typeof intent.customer === "string" ? intent.customer : intent.customer?.id ?? "";

  const { data, error } = await getSupabaseAdmin().rpc("confirm_public_booking_setup" as never, {
    p_booking_token: token,
    p_checkout_session_id: session.id,
    p_setup_intent_id: intent.id,
    p_payment_method_id: methodId,
    p_stripe_customer_id: customerId,
    p_stripe_account_id: account.accountId,
    p_brand: method?.card?.brand ?? "",
    p_last4: method?.card?.last4 ?? "",
    p_completed_at: new Date((intent.created ?? Date.now() / 1000) * 1000).toISOString(),
  } as never);
  if (error) throw new Error(`setup confirmation failed: ${safeMessage(error)}`);
  const jobId = typeof data === "string" ? data : null;
  await notifyBooking(token, jobId ? "setup_saved" : null);
  return jobId;
}

export async function confirmWithoutPaymentMethod(bookingToken: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin().rpc("confirm_public_booking_without_payment_method" as never, {
    p_booking_token: bookingToken,
  } as never);
  if (error) throw new Error(safeMessage(error));
  return typeof data === "string" ? data : null;
}

// ---------------------------------------------------------------------------
// Completion and collection
// ---------------------------------------------------------------------------

export type JobDiagnosticPayment = {
  policy: EffectivePolicy;
  authorizationState: AuthorizationState | null;
  display: DisplayState;
  amountCents: number;
  brand: string;
  last4: string;
  acceptedAt: string;
  completedAt: string;
  findings: string;
  repairContract: string;
  refusal: string | null;
  lastFailure: string;
  bookingToken: string;
};

async function collectionFacts(database: Admin, organizationId: string, jobId: string) {
  const db = asFlexibleClient(database);
  const [{ data: job }, { data: auths }, { data: contracts }, account, policy] = await Promise.all([
    db
      .from("jobs")
      .select("id, organization_id, status, diagnostic_paid, diagnostic_fee_cents, diagnostic_completed_at, diagnostic_findings, diagnostic_repair_contract")
      .eq("organization_id", organizationId)
      .eq("id", jobId)
      .maybeSingle(),
    db
      .from("diagnostic_payment_authorizations")
      .select("id, organization_id, state, amount_cents, stripe_payment_method_id, stripe_account_id, payment_method_brand, payment_method_last4, accepted_at, last_failure_code, booking_request_id, booking_requests ( public_token )")
      .eq("organization_id", organizationId)
      .eq("job_id", jobId)
      .order("created_at", { ascending: false }),
    db.from("contracts").select("status, kind, total_cents").eq("organization_id", organizationId).eq("job_id", jobId),
    paymentAccountFor(organizationId, database),
    loadDiagnosticPolicy(organizationId, database),
  ]);
  const rows = (auths ?? []) as Row[];
  const live = rows.find((row) => !["revoked", "cancelled", "expired"].includes(text(row.state))) ?? rows[0] ?? null;
  return { job: job as Row | null, authorization: live, contracts: (contracts ?? []) as Row[], account, policy };
}

function collectionInput(
  facts: Awaited<ReturnType<typeof collectionFacts>>,
  via: CollectionInput["via"],
  actor: { role: string | null; canBill: boolean },
): CollectionInput | null {
  const { job, authorization, account, policy } = facts;
  if (!job) return null;
  const amount = Number(authorization?.amount_cents ?? 0);
  return {
    via,
    actorRole: actor.role,
    actorCanBill: actor.canBill,
    policy,
    job: {
      organizationId: text(job.organization_id),
      status: text(job.status),
      canceled: text(job.status) === "canceled",
      diagnosticPaid: job.diagnostic_paid === true,
      diagnosticCompletedAt: text(job.diagnostic_completed_at) || null,
      diagnosticFindings: text(job.diagnostic_findings),
      repairContract: (text(job.diagnostic_repair_contract) || null) as CollectionInput["job"]["repairContract"],
      largerSignedContract: facts.contracts.some(
        (contract) => text(contract.status) === "signed" && text(contract.kind) === "agreement" && Number(contract.total_cents ?? 0) > amount,
      ),
    },
    authorization: authorization
      ? {
          organizationId: text(authorization.organization_id),
          state: text(authorization.state) as AuthorizationState,
          amountCents: amount,
          hasPaymentMethod: Boolean(text(authorization.stripe_payment_method_id)),
          stripeAccountId: text(authorization.stripe_account_id),
        }
      : null,
    account: account ? { stripeAccountId: account.accountId, chargesEnabled: account.ready } : null,
    requestedCents: amount,
    openCharge: text(authorization?.state) === "processing",
  };
}

/** Everything the job screen and the MCP tools show about the diagnostic payment. */
export async function getJobDiagnosticPaymentStatus(organizationId: string, jobId: string, actor: { role: string | null; canBill: boolean }): Promise<JobDiagnosticPayment | null> {
  const database = getSupabaseAdmin();
  const facts = await collectionFacts(database, organizationId, jobId);
  const input = collectionInput(facts, "app", actor);
  if (!input || !facts.job) return null;
  const refusal = collectionRefusal(input);
  const state = (text(facts.authorization?.state) || null) as AuthorizationState | null;
  const booking = facts.authorization?.booking_requests as Row | Row[] | null | undefined;
  const bookingRow = Array.isArray(booking) ? booking[0] : booking;
  return {
    policy: facts.policy,
    authorizationState: state,
    display: displayState({ authorizationState: state, diagnosticCompleted: Boolean(input.job.diagnosticCompletedAt), eligible: refusal === null }),
    amountCents: Number(facts.authorization?.amount_cents ?? facts.job.diagnostic_fee_cents ?? 0),
    brand: text(facts.authorization?.payment_method_brand),
    last4: text(facts.authorization?.payment_method_last4),
    acceptedAt: text(facts.authorization?.accepted_at),
    completedAt: text(facts.job.diagnostic_completed_at),
    findings: text(facts.job.diagnostic_findings),
    repairContract: text(facts.job.diagnostic_repair_contract),
    refusal,
    lastFailure: text(facts.authorization?.last_failure_code),
    bookingToken: text(bookingRow?.public_token),
  };
}

export type CollectionResult = { ok: true; state: AuthorizationState; message: string } | { ok: false; message: string };

/**
 * Charge the authorized amount for a completed diagnostic, off-session.
 *
 * `actorId` must already be resolved from a session or a verified MCP
 * credential; it is passed to the database, which checks the member's role
 * itself. `via: "auto"` is the business's own automatic collection.
 */
export async function collectDiagnosticPayment(input: {
  organizationId: string;
  jobId: string;
  via: "app" | "mcp" | "auto";
  actorId?: string | null;
  actor?: { role: string | null; canBill: boolean };
}): Promise<CollectionResult> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, message: "Payments are not configured." };
  const database = getSupabaseAdmin();

  // Honest messages first; the database re-checks everything under a lock.
  const facts = await collectionFacts(database, input.organizationId, input.jobId);
  // A staff collection must say who is asking; the database checks the role again.
  const pre = collectionInput(facts, input.via, input.actor ?? { role: null, canBill: false });
  if (!pre) return { ok: false, message: "That job was not found." };
  const refusal = collectionRefusal(pre);
  if (refusal) return { ok: false, message: refusal };

  const { data: claimed, error } = await database.rpc("claim_diagnostic_charge" as never, {
    p_job_id: input.jobId,
    p_amount_cents: pre.requestedCents,
    p_via: input.via,
    p_actor: input.actorId ?? null,
  } as never);
  const claim = (Array.isArray(claimed) ? claimed[0] : null) as Row | null;
  if (error || !claim) return { ok: false, message: error?.message ? safeMessage(error) : "The payment could not be started." };

  const chargeId = text(claim.charge_id);
  const accountId = text(claim.stripe_account_id);
  const amount = Number(claim.amount_cents);
  let outcome: "succeeded" | "failed" | "requires_action" = "failed";
  let paymentIntentId: string | null = null;
  let failureCode = "";
  let failureMessage = "";

  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount,
        currency: "usd",
        customer: text(claim.stripe_customer_id),
        payment_method: text(claim.stripe_payment_method_id),
        off_session: true,
        confirm: true,
        description: "Completed electrical diagnostic service (authorized deferred charge)",
        application_fee_amount: volteiraFeeCents(amount) || undefined,
        metadata: {
          purpose: "diagnostic_charge",
          diagnostic_charge_id: chargeId,
          authorization_id: text(claim.authorization_id),
          organization_id: input.organizationId,
          job_id: input.jobId,
        },
      },
      { stripeAccount: accountId, idempotencyKey: text(claim.idempotency_key) },
    );
    paymentIntentId = intent.id;
    outcome = intent.status === "succeeded" ? "succeeded" : intent.status === "requires_action" ? "requires_action" : "failed";
    if (intent.status === "processing") {
      // Cards settle synchronously; anything else waits for the webhook.
      return { ok: true, state: "processing", message: "The payment is processing. You will see the result here." };
    }
  } catch (caught) {
    const stripeError = caught as { code?: string; decline_code?: string; message?: string; raw?: { payment_intent?: { id?: string; status?: string } } };
    paymentIntentId = stripeError.raw?.payment_intent?.id ?? null;
    failureCode = stripeError.decline_code || stripeError.code || "payment_failed";
    failureMessage = safeMessage(stripeError.message ?? "");
    outcome = stripeError.code === "authentication_required" || stripeError.raw?.payment_intent?.status === "requires_action" ? "requires_action" : "failed";
  }

  const { data: state, error: recordError } = await database.rpc("record_diagnostic_charge_result" as never, {
    p_charge_id: chargeId,
    p_outcome: outcome,
    p_payment_intent_id: paymentIntentId,
    p_amount_cents: amount,
    p_failure_code: failureCode || null,
    p_failure_message: failureMessage || null,
  } as never);
  if (recordError) {
    // The webhook will reconcile it; never retry the charge from here.
    console.error("diagnostic charge result not recorded", safeMessage(recordError));
  }

  await notifyCharge(chargeId, outcome);
  if (outcome === "succeeded") return { ok: true, state: "succeeded", message: `Collected the authorized ${money(amount)}. A receipt is on its way to the customer.` };
  if (outcome === "requires_action") {
    return { ok: true, state: (text(state) || "requires_action") as AuthorizationState, message: "The customer's bank wants them to confirm this payment. They have been sent a secure link." };
  }
  return { ok: true, state: (text(state) || "failed") as AuthorizationState, message: "The card was declined. The customer has been sent a secure link to update their payment method." };
}

/**
 * Record a diagnostic as complete (database checks the role and findings), then
 * collect automatically when the business has that on and the rules allow it.
 */
export async function completeDiagnostic(input: {
  /** The signed-in member's own client, so auth.uid() is theirs; or the admin client with actorId. */
  database: FlexibleSupabaseClient;
  organizationId: string;
  jobId: string;
  outcome: "diagnostic_only" | "fix_now" | "schedule_later";
  findings: string;
  separateRepairContract: boolean;
  actorId?: string | null;
}): Promise<{ ok: true; message: string; collected?: CollectionResult } | { ok: false; message: string }> {
  const { data, error } = await input.database.rpc("complete_diagnostic_service", {
    p_job_id: input.jobId,
    p_outcome: input.outcome,
    p_findings: input.findings,
    p_separate_repair_contract: input.separateRepairContract,
    p_actor: input.actorId ?? null,
  });
  if (error) return { ok: false, message: safeMessage(error) };
  const result = (data ?? {}) as Row;
  const policy = await loadDiagnosticPolicy(input.organizationId);
  const repair = text(result.repair_contract);
  let collected: CollectionResult | undefined;
  if (policy.collectAt === "after_completion" && policy.autoCollect && (repair === "none" || repair === "separate")) {
    collected = await collectDiagnosticPayment({ organizationId: input.organizationId, jobId: input.jobId, via: "auto" });
  }
  const message =
    repair === "same_contract" || repair === "undetermined"
      ? "Diagnostic completed. The fee is billed with the repair once that contracted work is complete."
      : collected
        ? `Diagnostic completed. ${collected.message}`
        : "Diagnostic completed.";
  return { ok: true, message, collected };
}

// ---------------------------------------------------------------------------
// Recovery, revocation
// ---------------------------------------------------------------------------

/** A Checkout for exactly the authorized amount of a completed, unpaid diagnostic. */
export async function startDiagnosticRecovery(bookingToken: string, requestOrigin: string): Promise<CheckoutResult> {
  const stripe = getStripe();
  if (!stripe || !requestOrigin) return { error: "Payments are not configured." };
  const database = getSupabaseAdmin();
  const { data: booking } = await asFlexibleClient(database)
    .from("booking_requests")
    .select("id, organization_id, created_job_id, email, language")
    .eq("public_token", bookingToken)
    .maybeSingle();
  const row = booking as Row | null;
  const jobId = text(row?.created_job_id);
  const organizationId = text(row?.organization_id);
  if (!jobId || !organizationId) return { error: "There is nothing to pay on this booking." };

  const facts = await collectionFacts(database, organizationId, jobId);
  const pre = collectionInput(facts, "recovery", { role: null, canBill: false });
  const refusal = pre ? collectionRefusal(pre) : "Not found.";
  if (refusal || !["failed", "requires_action"].includes(text(facts.authorization?.state))) {
    return { error: refusal ?? "There is no payment to recover." };
  }

  const { data: claimed, error } = await database.rpc("claim_diagnostic_charge" as never, {
    p_job_id: jobId,
    p_amount_cents: pre!.requestedCents,
    p_via: "recovery",
  } as never);
  const claim = (Array.isArray(claimed) ? claimed[0] : null) as Row | null;
  if (error || !claim) return { error: error ? safeMessage(error) : "The payment could not be started." };
  const chargeId = text(claim.charge_id);
  const amount = Number(claim.amount_cents);
  const accountId = text(claim.stripe_account_id);
  const policy = facts.policy;

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        ui_mode: "hosted_page",
        customer: text(claim.stripe_customer_id) || undefined,
        payment_method_types: ["card"],
        locale: text(row?.language) === "es" ? "es-419" : "auto",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: { name: `${policy.serviceName} (completed)` },
            },
          },
        ],
        payment_intent_data: {
          // Saves the card they pay with as the one on file.
          setup_future_usage: "off_session",
          application_fee_amount: volteiraFeeCents(amount) || undefined,
          receipt_email: text(row?.email) || undefined,
          metadata: { purpose: "diagnostic_charge", diagnostic_charge_id: chargeId, organization_id: organizationId, job_id: jobId },
        },
        metadata: { purpose: "diagnostic_recovery", diagnostic_charge_id: chargeId, organization_id: organizationId },
        success_url: `${requestOrigin}/booking/${encodeURIComponent(bookingToken)}?pay=recovered`,
        cancel_url: `${requestOrigin}/booking/${encodeURIComponent(bookingToken)}?pay=canceled`,
      },
      { stripeAccount: accountId, idempotencyKey: `diagnostic-recovery-${chargeId}` },
    );
    await asFlexibleClient(database).from("diagnostic_charges").update({ stripe_checkout_session_id: session.id }).eq("id", chargeId);
    if (!session.url) throw new Error("no checkout url");
    return { url: session.url };
  } catch (caught) {
    await database.rpc("record_diagnostic_charge_result" as never, { p_charge_id: chargeId, p_outcome: "canceled", p_failure_code: "recovery_not_started" } as never);
    console.error("diagnostic recovery checkout failed", safeMessage(caught));
    return { error: "Secure payment could not be started." };
  }
}

/** The customer withdraws the authorization; the saved card is detached from Stripe. */
export async function revokeDiagnosticAuthorization(bookingToken: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc("revoke_diagnostic_authorization" as never, { p_booking_token: bookingToken } as never);
  const row = (Array.isArray(data) ? data[0] : null) as Row | null;
  if (error || !row) return false;
  const stripe = getStripe();
  const method = text(row.stripe_payment_method_id);
  const account = text(row.stripe_account_id);
  if (stripe && method && account) {
    await stripe.paymentMethods.detach(method, undefined, { stripeAccount: account }).catch((caught) => {
      console.error("payment method detach failed", safeMessage(caught));
    });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/**
 * Diagnostic events from a connected account. Returns true when the event was
 * one of ours (handled), false to let the caller try its other handlers.
 */
export async function handleDiagnosticStripeEvent(event: Stripe.Event, connectedAccount?: string): Promise<boolean> {
  const database = getSupabaseAdmin();

  if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed" || event.type === "payment_intent.requires_action" || event.type === "payment_intent.canceled") {
    const intent = event.data.object;
    if (intent.metadata?.purpose !== "diagnostic_charge" || !intent.metadata?.diagnostic_charge_id) return false;
    const organizationId = intent.metadata.organization_id ?? "";
    const account = await paymentAccountFor(organizationId);
    if (!account || account.accountId !== connectedAccount) {
      console.error("diagnostic charge event from an account that is not the business's");
      return true;
    }
    const outcome =
      event.type === "payment_intent.succeeded"
        ? "succeeded"
        : event.type === "payment_intent.requires_action"
          ? "requires_action"
          : event.type === "payment_intent.canceled"
            ? "canceled"
            : "failed";
    const methodId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id ?? null;
    let brand: string | null = null;
    let last4: string | null = null;
    if (outcome === "succeeded" && methodId && getStripe()) {
      const method = await getStripe()!.paymentMethods.retrieve(methodId, undefined, { stripeAccount: account.accountId }).catch(() => null);
      brand = method?.card?.brand ?? null;
      last4 = method?.card?.last4 ?? null;
    }
    const { error } = await database.rpc("record_diagnostic_charge_result" as never, {
      p_charge_id: intent.metadata.diagnostic_charge_id,
      p_outcome: outcome,
      p_payment_intent_id: intent.id,
      p_amount_cents: intent.amount_received || intent.amount,
      p_failure_code: intent.last_payment_error?.decline_code || intent.last_payment_error?.code || null,
      p_failure_message: intent.last_payment_error?.message ? safeMessage(intent.last_payment_error.message) : null,
      p_occurred_at: new Date(event.created * 1000).toISOString(),
      p_payment_method_id: outcome === "succeeded" && intent.setup_future_usage ? methodId : null,
      p_brand: brand,
      p_last4: last4,
    } as never);
    if (error) throw new Error(safeMessage(error));
    if (outcome !== "canceled") await notifyCharge(intent.metadata.diagnostic_charge_id, outcome);
    return true;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.mode === "setup" && session.metadata?.purpose === "diagnostic_authorization") {
      await fulfillSetupBooking(session, connectedAccount);
      return true;
    }
    // A recovery payment is recorded from its PaymentIntent event.
    return session.metadata?.purpose === "diagnostic_recovery";
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object;
    if (session.metadata?.purpose === "diagnostic_authorization") {
      await database.rpc("expire_diagnostic_setup" as never, { p_checkout_session_id: session.id } as never);
      await database.rpc("expire_public_booking_checkout", { p_booking_token: session.metadata.booking_token ?? "", p_checkout_session_id: session.id });
      return true;
    }
    if (session.metadata?.purpose === "diagnostic_recovery" && session.metadata.diagnostic_charge_id) {
      await database.rpc("record_diagnostic_charge_result" as never, { p_charge_id: session.metadata.diagnostic_charge_id, p_outcome: "canceled", p_failure_code: "recovery_expired" } as never);
      return true;
    }
    return false;
  }

  if (event.type === "payment_method.detached" && connectedAccount) {
    await database.rpc("diagnostic_payment_method_detached" as never, { p_stripe_account_id: connectedAccount, p_payment_method_id: event.data.object.id } as never);
    return false;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Customer notices
// ---------------------------------------------------------------------------

type Recipient = {
  organizationId: string;
  customerId: string;
  phone: string;
  email: string;
  language: Language;
  token: string;
  businessName: string;
  feeCents: number;
  messagingServiceSid: string;
  failedNotices: boolean;
};

async function recipientForBooking(database: Admin, where: { token?: string; bookingId?: string }): Promise<Recipient | null> {
  const db = asFlexibleClient(database);
  let query = db.from("booking_requests").select("id, organization_id, customer_id, phone, email, language, public_token, deposit_cents");
  query = where.token ? query.eq("public_token", where.token) : query.eq("id", where.bookingId ?? "");
  const { data } = await query.maybeSingle();
  const row = data as Row | null;
  if (!row) return null;
  const organizationId = text(row.organization_id);
  const [{ data: organization }, { data: messaging }, policy] = await Promise.all([
    db.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    db.from("messaging_settings").select("messaging_service_sid").eq("organization_id", organizationId).maybeSingle(),
    loadDiagnosticPolicy(organizationId, database),
  ]);
  return {
    organizationId,
    customerId: text(row.customer_id),
    phone: text(row.phone),
    email: text(row.email),
    language: language(row.language),
    token: text(row.public_token),
    businessName: text((organization as Row | null)?.name) || "Your electrician",
    feeCents: Number(row.deposit_cents ?? policy.feeCents),
    messagingServiceSid: text((messaging as Row | null)?.messaging_service_sid),
    failedNotices: policy.sendFailedPaymentNotices,
  };
}

async function deliver(recipient: Recipient, kind: NoticeKind) {
  const link = bookingLinkFor(origin(), recipient.token);
  const notice = diagnosticNotice({ kind, businessName: recipient.businessName, feeCents: recipient.feeCents, link, language: recipient.language });
  const credit = kind === "booking_confirmed" ? ` ${creditNotice(recipient.language)}` : "";
  const sent: string[] = [];
  if (recipient.phone && recipient.messagingServiceSid && recipient.customerId) {
    const result = await sendSms({
      organizationId: recipient.organizationId,
      customerId: recipient.customerId,
      to: recipient.phone,
      body: notice.body.slice(0, 480),
      messagingServiceSid: recipient.messagingServiceSid,
    }).catch(() => null);
    if (result?.ok) sent.push("sms");
  }
  if (recipient.email) {
    const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const result = await sendEmail({
      organizationId: recipient.organizationId,
      to: recipient.email,
      subject: notice.subject,
      text: notice.body + credit,
      html: `<p>${escape(notice.body + credit)}</p>`,
      from: emailSender(recipient.businessName, process.env.BOOKING_EMAIL_FROM ?? ""),
      contactButtons: true,
      idempotencyKey: `diagnostic-${kind}-${recipient.token}`,
    }).catch(() => null);
    if (result && "ok" in result && result.ok) sent.push("email");
  }
  await recordActivity(asFlexibleClient(getSupabaseAdmin()), {
    organizationId: recipient.organizationId,
    eventType: `diagnostic.notice_${kind}`,
    label: `Customer notice: ${kind.replace(/_/g, " ")}`,
    customerId: recipient.customerId || undefined,
    metadata: { channels: sent },
  });
}

async function notifyBooking(token: string, kind: NoticeKind | null) {
  if (!kind) return;
  try {
    const recipient = await recipientForBooking(getSupabaseAdmin(), { token });
    if (recipient) await deliver(recipient, kind);
  } catch (caught) {
    console.error("diagnostic booking notice failed", safeMessage(caught));
  }
}

async function notifyCharge(chargeId: string, outcome: "succeeded" | "failed" | "requires_action") {
  try {
    const database = getSupabaseAdmin();
    const { data } = await asFlexibleClient(database)
      .from("diagnostic_charges")
      .select("id, diagnostic_payment_authorizations ( booking_request_id )")
      .eq("id", chargeId)
      .maybeSingle();
    const authorization = (data as Row | null)?.diagnostic_payment_authorizations as Row | Row[] | null | undefined;
    const bookingId = text((Array.isArray(authorization) ? authorization[0] : authorization)?.booking_request_id);
    if (!bookingId) return;
    const recipient = await recipientForBooking(database, { bookingId });
    if (!recipient) return;
    if (outcome !== "succeeded" && !recipient.failedNotices) return;
    await deliver(recipient, outcome === "succeeded" ? "payment_succeeded" : outcome === "requires_action" ? "authentication_required" : "payment_failed");
  } catch (caught) {
    console.error("diagnostic charge notice failed", safeMessage(caught));
  }
}

/** Send (or resend) the setup link for a held booking. Used by the voice tools and the job screen. */
export async function sendSetupRequest(bookingToken: string): Promise<{ sent: boolean }> {
  const recipient = await recipientForBooking(getSupabaseAdmin(), { token: bookingToken });
  if (!recipient) return { sent: false };
  await deliver(recipient, "setup_request");
  return { sent: true };
}

/** Send the recovery link after a failed or unverified payment. Only when a payment really failed. */
export async function sendRecoveryLink(bookingToken: string): Promise<{ sent: boolean; reason?: string }> {
  const database = getSupabaseAdmin();
  const { data } = await database.rpc("get_booking_diagnostic_status" as never, { p_booking_token: bookingToken } as never);
  const status = (Array.isArray(data) ? data[0] : null) as Row | null;
  const state = text(status?.authorization_state);
  if (state !== "failed" && state !== "requires_action") return { sent: false, reason: "No failed payment is on record for this booking." };
  const recipient = await recipientForBooking(database, { token: bookingToken });
  if (!recipient) return { sent: false, reason: "Booking not found." };
  await deliver(recipient, state === "requires_action" ? "authentication_required" : "payment_failed");
  return { sent: true };
}

export { authorizationText, creditNotice };
