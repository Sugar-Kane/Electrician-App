import "server-only";

import type Stripe from "stripe";

import { sendBookingConfirmations } from "@/lib/booking-notifications";
import { loadIntakeContext } from "@/lib/intake-shared";
import {
  confirmPublicBookingPayment,
  expirePublicBookingCheckout,
  getPublicBookingConfirmation,
} from "@/lib/public-booking";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function sendPaidBookingConfirmations(input: {
  bookingToken: string;
  checkoutSessionId: string;
  jobId: string;
}) {
  try {
    const database = getSupabaseAdmin();
    const { data } = await database
      .from("booking_requests")
      .select(
        "id, organization_id, customer_id, public_token, phone, email, contact_name, first_name, last_name, description, address_line_1, city, arrival_window_start, arrival_window_end, intake_answers, delivery_preference, source, sms_consent",
      )
      .eq("public_token", input.bookingToken)
      .eq("deposit_checkout_session_id", input.checkoutSessionId)
      .maybeSingle();

    if (!data) return;
    const row = data as Record<string, unknown>;
    const organizationId = text(row.organization_id);
    const customerId = text(row.customer_id);
    const requestId = text(row.id);
    const publicToken = text(row.public_token);
    const start = text(row.arrival_window_start);
    const end = text(row.arrival_window_end);
    if (!organizationId || !customerId || !requestId || !publicToken || !start || !end) return;

    const { context, timeZone, owner } = await loadIntakeContext({
      database,
      organizationId,
      isFirstReply: false,
    });
    const source = text(row.source);
    const storedPreference = text(row.delivery_preference);
    const deliveryPreference =
      storedPreference === "text" ||
      storedPreference === "email" ||
      storedPreference === "both"
        ? storedPreference
        : source === "web"
          ? row.sms_consent === true
            ? "both"
            : "email"
          : "text";
    const intakeAnswers = Array.isArray(row.intake_answers)
      ? (row.intake_answers as { question: string; answer: string }[])
      : [];
    const named = [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ");

    await sendBookingConfirmations({
      requestId,
      organizationId,
      customerId,
      publicToken,
      phone: text(row.phone),
      email: text(row.email) || undefined,
      context,
      contactName: text(row.contact_name) || named,
      description: text(row.description),
      address: { line1: text(row.address_line_1), city: text(row.city) },
      slot: { start, end },
      timeZone,
      origin: process.env.NEXT_PUBLIC_APP_URL ?? "",
      intakeAnswers,
      owner,
      deliveryPreference,
      jobId: input.jobId,
      notificationPhase: "payment",
      // The payment path only reads consent recorded by the originating
      // channel. It never treats payment itself as a fresh SMS opt-in.
      customerSmsConsent: "existing",
    });
  } catch (error) {
    // The job and payment are already durable. Stripe must not retry the charge
    // fulfillment merely because an email or text provider is unavailable.
    console.error("paid booking notification failed", error);
  }
}

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

  const jobId = await confirmPublicBookingPayment({
    bookingToken,
    checkoutSessionId: session.id,
    paymentIntentId,
    amountCents: session.amount_total,
    currency: session.currency,
  });

  // A held-time notice and a paid confirmation are two different events. The
  // sender claims the payment phase separately, so webhook retries and page
  // refreshes cannot send Nick or the customer duplicate confirmations.
  if (jobId) {
    await sendPaidBookingConfirmations({
      bookingToken,
      checkoutSessionId: session.id,
      jobId,
    });
  }

  return getPublicBookingConfirmation(bookingToken, session.id);
}

export async function releaseExpiredBooking(session: Stripe.Checkout.Session) {
  const bookingToken = session.metadata?.booking_token;
  if (!bookingToken) return false;

  return expirePublicBookingCheckout(bookingToken, session.id);
}
