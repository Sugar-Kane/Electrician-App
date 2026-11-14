import "server-only";

import type Stripe from "stripe";

import { syncPaidBookingCalendar } from "@/lib/google-booking-calendar";
import { sendBookingConfirmations } from "@/lib/booking-notifications";
import { loadIntakeContext } from "@/lib/intake-shared";
import {
  confirmPublicBookingPayment,
  expirePublicBookingCheckout,
  getPublicBookingConfirmation,
} from "@/lib/public-booking";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { feeLabel } from "@/lib/booking-hold";
import { sendOwnerSms } from "@/lib/twilio";
import { sendEmail } from "@/lib/email";
import { emailSender } from "@/lib/booking-confirmation";

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
        "id, organization_id, customer_id, public_token, phone, email, contact_name, first_name, last_name, description, address_line_1, city, arrival_window_start, arrival_window_end, intake_answers, delivery_preference, source, sms_consent, language",
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

    // Their copy goes to the email they gave for this booking, or failing that
    // the one already on their record.
    let email = text(row.email);
    if (!email) {
      const { data: customer } = await database
        .from("customers")
        .select("email")
        .eq("id", customerId)
        .maybeSingle();
      email = text(customer?.email);
    }

    await sendBookingConfirmations({
      requestId,
      organizationId,
      customerId,
      publicToken,
      phone: text(row.phone),
      email: email || undefined,
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
      language: text(row.language) || undefined,
    });
  } catch (error) {
    // The job and payment are already durable. Stripe must not retry the charge
    // fulfillment merely because an email or text provider is unavailable.
    console.error("paid booking notification failed", error);
  }
}

/**
 * A payment that could not become a job (the window had already started when
 * they paid, or the time could no longer be booked): the booking is in review
 * with the money taken, and the owner is told once, by each booking-alert
 * channel they set up (text, email or both), to book a new time or refund. The claim on payment_notified_at keeps the webhook and the
 * return page from both sending it.
 */
async function alertPaidButUnscheduled(bookingToken: string, checkoutSessionId: string) {
  try {
    const database = getSupabaseAdmin();
    const { data: claimed } = await database
      .from("booking_requests")
      .update({ payment_notified_at: new Date().toISOString() })
      .eq("public_token", bookingToken)
      .eq("deposit_checkout_session_id", checkoutSessionId)
      .eq("status", "needs_review")
      .is("payment_notified_at", null)
      .select("organization_id, contact_name, first_name, last_name, phone, deposit_cents")
      .maybeSingle();
    const row = claimed as Record<string, unknown> | null;
    if (!row) return;
    const organizationId = text(row.organization_id);
    const [{ data: organization }, { data: settings }] = await Promise.all([
      database
        .from("organizations")
        .select("name, owner_notification_phone, owner_notification_email")
        .eq("id", organizationId)
        .maybeSingle(),
      database.from("messaging_settings").select("messaging_service_sid").eq("organization_id", organizationId).maybeSingle(),
    ]);
    const business = (organization ?? {}) as Record<string, unknown>;
    const ownerPhone = text(business.owner_notification_phone);
    const ownerEmail = text(business.owner_notification_email);
    const messagingServiceSid = text((settings as Record<string, unknown> | null)?.messaging_service_sid);
    const name = text(row.contact_name) || [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ") || "A customer";
    const fee = feeLabel(Number(row.deposit_cents ?? 0));
    const customerPhone = text(row.phone);
    const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
    const link = origin ? `${origin}/booking-requests` : "";
    const said =
      `${name} paid the ${fee} diagnostic fee, but their time could no longer be booked. ` +
      `Call ${customerPhone || "them"} to book a new time or refund it.`;

    // Each channel the business set up for booking alerts, independently: an
    // email-only business is told by email, a text-only one by text.
    if (ownerPhone && messagingServiceSid) {
      await sendOwnerSms({
        organizationId,
        to: ownerPhone,
        body: `Paid, needs a new time: ${said}${link ? ` ${link}` : ""}`,
        messagingServiceSid,
      });
    }
    if (ownerEmail) {
      const businessName = text(business.name) || "Your business";
      const html = (value: string) =>
        value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      await sendEmail({
        organizationId,
        to: ownerEmail,
        subject: `Paid, needs a new time: ${name}`,
        text: `${said}${link ? `\n\nBooking requests: ${link}` : ""}`,
        html: `<p>${html(said)}</p>${link ? `<p><a href="${html(link)}">Open booking requests</a></p>` : ""}`,
        from: emailSender(businessName, process.env.BOOKING_EMAIL_FROM ?? ""),
      });
    }
  } catch (error) {
    // The payment and the review are already recorded; the alert is extra.
    console.error("paid but unscheduled alert failed", error);
  }
}

export async function fulfillPaidBooking(
  session: Stripe.Checkout.Session,
  options: { paidAt?: string } = {},
) {
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
    paidAt: options.paidAt,
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
    // A failed calendar write is retryable; deterministic event IDs prevent duplicates.
    await syncPaidBookingCalendar(bookingToken);
  } else {
    await alertPaidButUnscheduled(bookingToken, session.id);
  }

  return getPublicBookingConfirmation(bookingToken, session.id);
}

export async function releaseExpiredBooking(session: Stripe.Checkout.Session) {
  const bookingToken = session.metadata?.booking_token;
  if (!bookingToken) return false;

  return expirePublicBookingCheckout(bookingToken, session.id);
}
