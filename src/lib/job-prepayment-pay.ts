import "server-only";

import type Stripe from "stripe";

import { recordActivity } from "@/lib/activity";
import { emailSender, looksLikeEmail } from "@/lib/booking-confirmation";
import { sendCustomerText } from "@/lib/customer-text";
import { sendEmail } from "@/lib/email";
import { emailButton } from "@/lib/email-layout";
import { MIN_ONLINE_CENTS, methodFromStripeType, onlineEventAction } from "@/lib/invoice-online-payment";
import { payLinkCents, paymentLabel, shouldRequestPayment, type PlannedPayment } from "@/lib/payment-plan";
import { loadJobPaymentPlan } from "@/lib/payment-plan-server";
import { getStripe } from "@/lib/stripe";
import { paymentAccountFor, readyPaymentAccount, volteiraFeeCents } from "@/lib/stripe-connect";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { STOPPED_ERROR, sendSms } from "@/lib/twilio";

/**
 * Paying a deposit or an installment online, from the pay link the customer is
 * sent for it, by bank (ACH) or card through Stripe Checkout; asking for it;
 * and what Stripe later says about it.
 *
 * Service role throughout: the customer has no session, only the payment's
 * unguessable link, and the webhook has neither. The charge is made on the
 * business's own connected Stripe account with Volteira's percentage as the
 * application fee, exactly as an invoice payment is (invoice-online-pay.ts).
 * A checkout is tagged `purpose: job_prepayment`, so the invoice, booking and
 * subscription handlers pass it by.
 *
 * Money paid here is a prepayment on the job (job_prepayments). It is put onto
 * the job's invoice as a payment when the invoice is sent, by the database, so
 * nothing is billed twice. Once the invoice is out the invoice asks for what
 * is owed, and a pay link sends the customer there instead.
 *
 * There is no table of checkouts for a pay link: what is open, or on its way
 * by bank, is read back from Stripe, where the checkouts live.
 */

const PURPOSE = "job_prepayment";
const CHECKOUT_HOURS = 23;

type Database = ReturnType<typeof getSupabaseAdmin>;
type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function one(value: unknown): Row {
  return ((Array.isArray(value) ? value[0] : value) ?? {}) as Row;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
}

/** Today's date where the business is, "2026-11-20". */
function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function formatDay(isoDate: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  // Noon UTC, so the day never slips across a time zone.
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(new Date(`${isoDate}T12:00:00Z`));
}

export type PlanPayment = {
  itemId: string;
  organizationId: string;
  jobId: string;
  jobNumber: string;
  customerId: string;
  customerFirstName: string;
  customerEmail: string;
  customerPhone: string;
  businessName: string;
  businessPhone: string;
  timeZone: string;
  payToken: string;
  requestedAt: string | null;
  /** "Deposit", "Payment 2", "Balance". */
  label: string;
  payment: PlannedPayment;
  index: number;
  payments: PlannedPayment[];
  prepaidCents: number;
  /** The link to the job's invoice once it is sent: from then on the invoice asks for what is owed. */
  invoiceToken: string | null;
  /** The business's connected account, when it can take the charge. */
  stripeAccount: string | null;
  /** A signed contract for the job showed the payment schedule. */
  signed: boolean;
};

/** A payment of a job's plan, by its pay link or its id, with everything needed to ask for or take it. */
export async function loadPlanPayment(
  by: { token: string } | { itemId: string },
  database: Database = getSupabaseAdmin(),
): Promise<PlanPayment | null> {
  const query = database.from("job_payment_plan_items").select("id, organization_id, job_id, pay_token, requested_at");
  const { data: itemRow } = await ("token" in by ? query.eq("pay_token", by.token) : query.eq("id", by.itemId)).maybeSingle();
  if (!itemRow) return null;
  const item = itemRow as Row;
  const organizationId = text(item.organization_id);
  const jobId = text(item.job_id);

  const [plan, { data: jobRow }, { data: invoiceRow }, { data: signedRow }] = await Promise.all([
    loadJobPaymentPlan(asFlexibleClient(database), { organizationId, jobId }),
    database
      .from("jobs")
      .select("job_number, customer_id, customers ( first_name, email, phone ), organizations ( name, phone, timezone )")
      .eq("id", jobId)
      .eq("organization_id", organizationId)
      .maybeSingle(),
    database
      .from("invoices")
      .select("preview_token")
      .eq("organization_id", organizationId)
      .eq("job_id", jobId)
      .not("status", "in", "(draft,void)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    database
      .from("contracts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("job_id", jobId)
      .not("signed_at", "is", null)
      .not("payment_schedule", "is", null)
      .limit(1)
      .maybeSingle(),
  ]);
  if (!jobRow || !plan.payments) return null;
  const index = plan.saved.findIndex((saved) => saved.id === text(item.id));
  const payment = plan.payments[index];
  if (index < 0 || !payment) return null;

  const job = jobRow as Row;
  const customer = one(job.customers);
  const organization = one(job.organizations);
  const account = await readyPaymentAccount(organizationId);
  return {
    itemId: text(item.id),
    organizationId,
    jobId,
    jobNumber: job.job_number ? String(job.job_number) : "",
    customerId: text(job.customer_id),
    customerFirstName: text(customer.first_name),
    customerEmail: text(customer.email).trim(),
    customerPhone: text(customer.phone),
    businessName: text(organization.name) || "Your electrician",
    businessPhone: text(organization.phone),
    timeZone: text(organization.timezone) || "America/Los_Angeles",
    payToken: text(item.pay_token),
    requestedAt: text(item.requested_at) || null,
    label: paymentLabel(payment, index),
    payment,
    index,
    payments: plan.payments,
    prepaidCents: plan.prepaidCents,
    invoiceToken: text((invoiceRow as Row | null)?.preview_token) || null,
    stripeAccount: account?.accountId ?? null,
    signed: Boolean(signedRow),
  };
}

/** When the payment is due, in words: "due on signing", "due Dec 1, 2026". */
export function dueWords(payment: Pick<PlannedPayment, "due" | "dueDate">, timeZone: string): string {
  if (payment.due === "on_signing") return "due on signing";
  if (payment.due === "on_completion") return "due on completion of the work";
  return `due ${formatDay(payment.dueDate ?? "", timeZone)}`;
}

type JobCheckouts = { processingCents: number; open: { id: string; url: string; amountCents: number; itemId: string }[] };

/**
 * The job's pay-link checkouts in Stripe from the last month: those still
 * open, and bank payments submitted but not yet cleared. Throws when Stripe
 * can't be read, so a checkout is never opened on a guess.
 */
async function jobCheckouts(stripe: Stripe, stripeAccount: string, jobId: string): Promise<JobCheckouts> {
  const found: JobCheckouts = { processingCents: 0, open: [] };
  const since = Math.floor(Date.now() / 1_000) - 30 * 86_400;
  let seen = 0;
  for await (const session of stripe.checkout.sessions.list(
    { created: { gte: since }, limit: 100, expand: ["data.payment_intent"] },
    { stripeAccount },
  )) {
    seen += 1;
    if (seen > 500) break;
    if (session.metadata?.purpose !== PURPOSE || session.metadata?.job_id !== jobId) continue;
    if (session.status === "open" && session.url) {
      found.open.push({ id: session.id, url: session.url, amountCents: session.amount_total ?? 0, itemId: session.metadata?.plan_item_id ?? "" });
      continue;
    }
    const intent = session.payment_intent && typeof session.payment_intent === "object" ? session.payment_intent : null;
    if (session.status === "complete" && session.payment_status === "unpaid" && intent?.status === "processing") {
      found.processingCents += session.amount_total ?? 0;
    }
  }
  return found;
}

export type PayLinkView = {
  payment: PlanPayment;
  /** What paying now would charge; 0 when nothing is owed on this link. */
  amountCents: number;
  /** A bank payment for the job on its way. */
  processingCents: number;
  canPay: boolean;
};

/** What the customer's pay link shows. Null for a link that leads nowhere. */
export async function payLinkView(token: string): Promise<PayLinkView | null> {
  const payment = await loadPlanPayment({ token });
  if (!payment) return null;
  let processingCents = 0;
  const stripe = getStripe();
  if (stripe && payment.stripeAccount && !payment.invoiceToken) {
    try {
      processingCents = (await jobCheckouts(stripe, payment.stripeAccount, payment.jobId)).processingCents;
    } catch (error) {
      console.error("pay link: checkouts could not be read", { message: String(error).slice(0, 200) });
    }
  }
  const amountCents = payLinkCents(payment.payments, payment.index, { prepaidCents: payment.prepaidCents, processingCents });
  return {
    payment,
    amountCents,
    processingCents,
    canPay: !payment.invoiceToken && Boolean(payment.stripeAccount) && amountCents >= MIN_ONLINE_CENTS,
  };
}

export type PlanCheckoutResult = { url: string } | { error: "unavailable" | "not_payable" | "processing" | "paid" | "invoice" };

/** A Stripe checkout for what this pay link asks for now, offering bank (ACH) and card. */
export async function startPlanCheckout(input: { token: string; origin: string }): Promise<PlanCheckoutResult> {
  const stripe = getStripe();
  if (!stripe || !input.origin) return { error: "unavailable" };
  const payment = await loadPlanPayment({ token: input.token });
  if (!payment) return { error: "unavailable" };
  if (payment.invoiceToken) return { error: "invoice" };
  const stripeAccount = payment.stripeAccount;
  if (!stripeAccount) return { error: "not_payable" };
  const onAccount = { stripeAccount };

  let checkouts: JobCheckouts;
  try {
    checkouts = await jobCheckouts(stripe, stripeAccount, payment.jobId);
  } catch (error) {
    console.error("pay link checkout: checkouts could not be read", { message: String(error).slice(0, 200) });
    return { error: "unavailable" };
  }
  const amountCents = payLinkCents(payment.payments, payment.index, {
    prepaidCents: payment.prepaidCents,
    processingCents: checkouts.processingCents,
  });
  if (amountCents < MIN_ONLINE_CENTS) return { error: checkouts.processingCents > 0 ? "processing" : "paid" };

  // A second tap returns to the checkout already open for this payment and
  // amount. Any other open checkout for the job is closed, so the customer
  // can't pay an old amount as well.
  const reuse = checkouts.open.find((open) => open.itemId === payment.itemId && open.amountCents === amountCents);
  for (const open of checkouts.open) {
    if (open.id !== reuse?.id) await stripe.checkout.sessions.expire(open.id, undefined, onAccount).catch(() => undefined);
  }
  if (reuse) return { url: reuse.url };

  const back = `${input.origin}/pay/${encodeURIComponent(input.token)}`;
  const metadata = { purpose: PURPOSE, plan_item_id: payment.itemId, job_id: payment.jobId, organization_id: payment.organizationId };
  const name = `${payment.label}${payment.jobNumber ? ` for job #${payment.jobNumber}` : ""}`;
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    ui_mode: "hosted_page",
    billing_address_collection: "auto",
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: false },
    allow_promotion_codes: false,
    origin_context: "web",
    integration_identifier: "hosted_web_0001",
    submit_type: "auto",
    payment_method_types: ["us_bank_account", "card"],
    payment_method_options: { us_bank_account: { verification_method: "automatic" } },
    customer_email: looksLikeEmail(payment.customerEmail) ? payment.customerEmail : undefined,
    expires_at: Math.floor(Date.now() / 1_000) + CHECKOUT_HOURS * 3_600,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: { name, description: payment.businessName },
        },
      },
    ],
    metadata,
    payment_intent_data: {
      description: `${payment.businessName} ${name.toLowerCase()}`,
      metadata,
      application_fee_amount: volteiraFeeCents(amountCents) || undefined,
    },
    success_url: `${back}?paid=1`,
    cancel_url: back,
  };

  try {
    const session = await stripe.checkout.sessions.create(params, onAccount);
    return session.url ? { url: session.url } : { error: "unavailable" };
  } catch (error) {
    const message = String((error as { message?: unknown })?.message ?? error);
    if (!/us_bank_account/i.test(message)) {
      console.error("pay link checkout failed", { itemId: payment.itemId, message: message.slice(0, 300) });
      return { error: "unavailable" };
    }
    try {
      const session = await stripe.checkout.sessions.create({ ...params, payment_method_types: ["card"], payment_method_options: undefined }, onAccount);
      return session.url ? { url: session.url } : { error: "unavailable" };
    } catch (retry) {
      console.error("pay link checkout failed", { itemId: payment.itemId, message: String(retry).slice(0, 300) });
      return { error: "unavailable" };
    }
  }
}

/**
 * Stripe's word on a pay-link checkout. False when the checkout was not one,
 * so the webhook hands it on. Only the account the job's business connected
 * is believed. Throws on a database failure so Stripe retries; recording is
 * keyed on the checkout, so a retry never records a payment twice.
 */
export async function handlePlanCheckoutEvent(eventType: string, session: Stripe.Checkout.Session, account?: string): Promise<boolean> {
  if (session.metadata?.purpose !== PURPOSE || session.mode !== "payment") return false;
  const action = onlineEventAction(eventType, session.payment_status);
  if (action === "ignore" || action === "expired") return true;

  const organizationId = session.metadata?.organization_id ?? "";
  const jobId = session.metadata?.job_id ?? "";
  const itemId = session.metadata?.plan_item_id ?? "";
  const database = getSupabaseAdmin();
  const connected = organizationId ? await paymentAccountFor(organizationId, database) : null;
  if (!account || !connected || connected.accountId !== account) {
    console.error("pay link event from an account that isn't the business's", { session: session.id, eventType });
    return true;
  }
  const { data: job, error: jobError } = await database.from("jobs").select("id").eq("id", jobId).eq("organization_id", organizationId).maybeSingle();
  if (jobError) throw new Error(`pay link job lookup failed: ${jobError.message}`);
  if (!job) {
    console.error("pay link event for an unknown job", { session: session.id });
    return true;
  }

  const stripe = getStripe();
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? "";
  let method: "ach" | "card" = session.payment_method_types?.includes("us_bank_account") && session.payment_method_types.length === 1 ? "ach" : "card";
  let failure = "";
  if (stripe && paymentIntentId) {
    try {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["payment_method"] }, { stripeAccount: account });
      const paymentMethod = intent.payment_method && typeof intent.payment_method === "object" ? intent.payment_method : null;
      method = methodFromStripeType(paymentMethod?.type ?? intent.payment_method_types?.[0] ?? null) === "bank" ? "ach" : "card";
      failure = intent.last_payment_error?.message ?? "";
    } catch {
      // The method is only a label; the payment stands either way.
    }
  }
  const amountCents = session.amount_total ?? 0;
  const activity = asFlexibleClient(database);

  if (action === "processing") {
    await recordActivity(activity, {
      organizationId,
      eventType: "job.prepayment_processing",
      label: "Bank payment started from a pay link",
      jobId,
      metadata: { amount_cents: amountCents, method },
    });
    return true;
  }
  if (action === "failed") {
    await recordActivity(activity, {
      organizationId,
      eventType: "job.prepayment_failed",
      label: "Bank payment from a pay link failed",
      jobId,
      metadata: { amount_cents: amountCents, method, ...(failure ? { note: failure.slice(0, 200) } : {}) },
    });
    return true;
  }

  // settle
  if (amountCents <= 0) return true;
  const { data: item } = itemId
    ? await database.from("job_payment_plan_items").select("id").eq("id", itemId).eq("job_id", jobId).maybeSingle()
    : { data: null };
  const { error } = await database.from("job_prepayments").insert({
    organization_id: organizationId,
    job_id: jobId,
    plan_item_id: item ? itemId : null,
    amount_cents: amountCents,
    method,
    stripe_checkout_session_id: session.id,
    note: "Paid online from a pay link",
    received_at: new Date().toISOString(),
  });
  if (error) {
    // Recorded already: Stripe sent the event again.
    if (error.code === "23505") return true;
    throw new Error(`pay link payment not recorded: ${error.message}`);
  }

  await recordActivity(activity, {
    organizationId,
    eventType: "job.prepayment_received",
    label: "Paid online from a pay link",
    jobId,
    metadata: { amount_cents: amountCents, method, via: "online" },
  });

  // Paid after the invoice was already sent: the database puts prepayments on
  // an invoice only as it is sent, so the business records it on the invoice.
  const { data: sentInvoice } = await database
    .from("invoices")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .not("status", "in", "(draft,void)")
    .limit(1)
    .maybeSingle();
  if (sentInvoice) {
    await recordActivity(activity, {
      organizationId,
      eventType: "job.prepayment_after_invoice",
      label: "Paid from a pay link after the invoice was sent",
      jobId,
      metadata: { amount_cents: amountCents, note: "Record it on the invoice, or refund it from Stripe." },
    });
  }

  await sendPrepaymentReceipt({ organizationId, jobId, amountCents, method });
  return true;
}

type SendOutcome = { email: string; sms: string };

async function deliver(
  database: Database,
  input: {
    organizationId: string;
    customerId: string;
    customerEmail: string;
    customerPhone: string;
    businessName: string;
    subject: string;
    lines: string[];
    html: string;
    sms: string;
  },
): Promise<SendOutcome> {
  const outcome: SendOutcome = { email: "not sent", sms: "not sent" };
  if (looksLikeEmail(input.customerEmail)) {
    const sent = await sendEmail({
      organizationId: input.organizationId,
      contactButtons: true,
      to: input.customerEmail,
      subject: input.subject,
      text: input.lines.filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== "")).join("\n"),
      html: input.html,
      from: emailSender(input.businessName, process.env.BOOKING_EMAIL_FROM ?? ""),
    });
    outcome.email = sent.ok ? "sent" : `${sent.errorCode}: ${sent.errorDetail}`;
  } else {
    outcome.email = "no email on file";
  }

  if (input.customerPhone && input.customerId) {
    // Consent and STOP are checked by sendCustomerText, as for every text.
    const result = await sendCustomerText(asFlexibleClient(database), {
      organizationId: input.organizationId,
      customerId: input.customerId,
      body: input.sms,
      send: sendSms,
      pauseAssistant: false,
    });
    const stopped = !result.ok && result.code === "SEND_FAILED" && result.errorCode === STOPPED_ERROR;
    outcome.sms = result.ok ? "sent" : stopped ? "replied STOP" : `${result.code}: ${result.message}`;
  } else {
    outcome.sms = input.customerPhone ? "no customer record" : "no phone on file";
  }
  return outcome;
}

export type PaymentRequestResult = { ok: true; email: string; sms: string } | { ok: false; message: string };

/**
 * Ask the customer for a payment: a text (with texting consent) and an email
 * with its pay link. Automatic requests are claimed first, so each payment is
 * asked for once however many times it is looked at; a request sent by hand
 * goes every time it is asked for.
 */
export async function sendPaymentRequest(itemId: string, options: { byHand: boolean }): Promise<PaymentRequestResult> {
  const database = getSupabaseAdmin();
  const payment = await loadPlanPayment({ itemId }, database);
  if (!payment) return { ok: false, message: "That payment is no longer in the job's plan." };
  if (payment.invoiceToken) return { ok: false, message: "The invoice has been sent, and it asks for what is owed." };
  if (!payment.stripeAccount) return { ok: false, message: "Online payments aren't set up yet. Connect Stripe in Settings first." };
  const origin = appOrigin();
  if (!origin) return { ok: false, message: "Pay links can't be sent right now." };
  const amountCents = payLinkCents(payment.payments, payment.index, { prepaidCents: payment.prepaidCents });
  if (amountCents < MIN_ONLINE_CENTS) return { ok: false, message: "Nothing is owed on this payment." };

  const now = new Date().toISOString();
  const claim = database.from("job_payment_plan_items").update({ requested_at: now }).eq("id", payment.itemId);
  const { data: claimed } = await (options.byHand ? claim : claim.is("requested_at", null)).select("id").maybeSingle();
  if (!claimed) return { ok: false, message: "Already asked for." };

  const link = `${origin}/pay/${payment.payToken}`;
  const when = dueWords(payment.payment, payment.timeZone);
  const forJob = payment.jobNumber ? ` for job #${payment.jobNumber}` : "";
  const what = `${payment.label.toLowerCase()} of ${dollars(amountCents)}${forJob}`;
  const greeting = payment.customerFirstName ? `Hi ${payment.customerFirstName},` : "Hello,";
  const outcome = await deliver(database, {
    organizationId: payment.organizationId,
    customerId: payment.customerId,
    customerEmail: payment.customerEmail,
    customerPhone: payment.customerPhone,
    businessName: payment.businessName,
    subject: `${payment.label} ${dollars(amountCents)}${forJob}: ${payment.businessName}`,
    lines: [
      greeting,
      "",
      `Your ${what} is ${when}.`,
      `Pay by bank transfer or card: ${link}`,
      payment.businessPhone ? `Questions? Call us at ${payment.businessPhone}.` : "",
      "",
      payment.businessName,
    ],
    html: [
      `<p>${escapeHtml(greeting)}</p>`,
      `<p style="font-size:14px;color:#475569;margin:0">${escapeHtml(payment.label)}${escapeHtml(forJob)}</p>`,
      `<p style="font-size:28px;margin:0 0 12px"><strong>${escapeHtml(dollars(amountCents))}</strong></p>`,
      `<p>${escapeHtml(`Your ${what} is ${when}.`)}</p>`,
      `<p style="margin:20px 0">${emailButton(link, `Pay ${dollars(amountCents)}`)}</p>`,
      `<p style="font-size:14px;color:#475569">By bank transfer (ACH) or card, securely through Stripe.</p>`,
      payment.businessPhone
        ? `<p>Questions? Call us at <a href="tel:${escapeHtml(payment.businessPhone.replace(/[^\d+]/g, ""))}">${escapeHtml(payment.businessPhone)}</a>.</p>`
        : "",
      `<p style="color:#475569">${escapeHtml(payment.businessName)}</p>`,
    ].join(""),
    sms: `${payment.businessName}: your ${what} is ${when}. Pay by bank or card: ${link}`,
  });

  await recordActivity(asFlexibleClient(database), {
    organizationId: payment.organizationId,
    eventType: "job.prepayment_requested",
    label: `${payment.label} asked for`,
    jobId: payment.jobId,
    metadata: { amount_cents: amountCents, email: outcome.email, sms: outcome.sms, by_hand: options.byHand },
  });
  return { ok: true, ...outcome };
}

/** Thank the customer for a payment made from a pay link. Best effort: the payment stands either way. */
async function sendPrepaymentReceipt(input: { organizationId: string; jobId: string; amountCents: number; method: "ach" | "card" }): Promise<void> {
  try {
    const database = getSupabaseAdmin();
    const [{ data: jobRow }, plan] = await Promise.all([
      database
        .from("jobs")
        .select("job_number, customer_id, customers ( first_name, email, phone ), organizations ( name, phone )")
        .eq("id", input.jobId)
        .eq("organization_id", input.organizationId)
        .maybeSingle(),
      loadJobPaymentPlan(asFlexibleClient(database), { organizationId: input.organizationId, jobId: input.jobId }),
    ]);
    if (!jobRow) return;
    const job = jobRow as Row;
    const customer = one(job.customers);
    const organization = one(job.organizations);
    const businessName = text(organization.name) || "Your electrician";
    const businessPhone = text(organization.phone);
    const firstName = text(customer.first_name);
    const forJob = job.job_number ? ` for job #${String(job.job_number)}` : "";
    const amount = dollars(input.amountCents);
    const paidBy = input.method === "ach" ? "by bank transfer" : "by card";
    const total = plan.payments ? plan.payments.reduce((sum, each) => sum + each.cents, 0) : 0;
    const left = total > 0 ? Math.max(0, total - plan.prepaidCents) : null;
    const leftLine = left === null ? "" : left > 0 ? `Remaining on the job: ${dollars(left)}.` : "The job is paid in full.";
    const greeting = firstName ? `Hi ${firstName},` : "Hello,";

    const outcome = await deliver(database, {
      organizationId: input.organizationId,
      customerId: text(job.customer_id),
      customerEmail: text(customer.email).trim(),
      customerPhone: text(customer.phone),
      businessName,
      subject: `Payment receipt: ${amount} to ${businessName}`,
      lines: [
        greeting,
        "",
        `Thank you. ${businessName} received your payment of ${amount}${forJob}, ${paidBy}.`,
        leftLine,
        businessPhone ? `Questions? Call us at ${businessPhone}.` : "",
        "",
        businessName,
      ],
      html: [
        `<p>${escapeHtml(greeting)}</p>`,
        `<p style="font-size:14px;color:#475569;margin:0">Payment received</p>`,
        `<p style="font-size:28px;margin:0 0 12px"><strong>${escapeHtml(amount)}</strong></p>`,
        `<p>${escapeHtml(`Thank you. ${businessName} received your payment of ${amount}${forJob}, ${paidBy}.`)}</p>`,
        leftLine ? `<p>${escapeHtml(leftLine)}</p>` : "",
        businessPhone
          ? `<p>Questions? Call us at <a href="tel:${escapeHtml(businessPhone.replace(/[^\d+]/g, ""))}">${escapeHtml(businessPhone)}</a>.</p>`
          : "",
        `<p style="color:#475569">${escapeHtml(businessName)}</p>`,
      ].join(""),
      sms: `${businessName}: thank you, we received your payment of ${amount}${forJob}.${leftLine ? ` ${leftLine}` : ""}`,
    });
    if (outcome.email !== "sent" && outcome.sms !== "sent") console.warn("pay link receipt not delivered", { jobId: input.jobId, ...outcome });
  } catch (error) {
    console.error("pay link receipt failed", { jobId: input.jobId, message: error instanceof Error ? error.message : "unknown" });
  }
}

/**
 * Ask for the payments that have come due and not been asked for: one due on
 * signing once the contract with the schedule is signed, one due on a date
 * once that date comes where the business is. Each is asked for once. Run
 * right after a customer signs (for that job) and by the background worker.
 */
export async function sendDuePaymentRequests(options: { jobId?: string; organizationId?: string; limit?: number } = {}): Promise<number> {
  const database = getSupabaseAdmin();
  // Dated payments up to tomorrow (the business's own day is checked for each
  // one below), and payments due on signing from plans of the last two months:
  // a job never signed doesn't hold up the rest for ever.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const recent = new Date(Date.now() - 60 * 86_400_000).toISOString();
  let query = database
    .from("job_payment_plan_items")
    .select("id, organization_id, job_id")
    .is("requested_at", null)
    .or(`and(due.eq.on_signing,updated_at.gte."${recent}"),and(due.eq.on_date,due_date.lte.${tomorrow})`)
    .order("updated_at", { ascending: false })
    .limit(options.limit ?? 25);
  if (options.jobId && options.organizationId) query = query.eq("job_id", options.jobId).eq("organization_id", options.organizationId);
  const { data, error } = await query;
  if (error) {
    console.error("payment requests: could not be read", error);
    return 0;
  }

  let sent = 0;
  for (const row of (data ?? []) as Row[]) {
    try {
      const payment = await loadPlanPayment({ itemId: text(row.id) }, database);
      if (!payment || !payment.stripeAccount) continue;
      const owedCents = payLinkCents(payment.payments, payment.index, { prepaidCents: payment.prepaidCents });
      const due = shouldRequestPayment(payment.payment, {
        requestedAt: payment.requestedAt,
        owedCents: owedCents >= MIN_ONLINE_CENTS ? owedCents : 0,
        today: todayIn(payment.timeZone),
        signed: payment.signed,
        invoiceSent: Boolean(payment.invoiceToken),
      });
      // Only what a signed contract set out is asked for.
      if (!due || !payment.signed) continue;
      const result = await sendPaymentRequest(payment.itemId, { byHand: false });
      if (result.ok && (result.email === "sent" || result.sms === "sent")) sent += 1;
    } catch (failure) {
      console.error("payment request failed", { itemId: text(row.id), message: failure instanceof Error ? failure.message : "unknown" });
    }
  }
  return sent;
}
