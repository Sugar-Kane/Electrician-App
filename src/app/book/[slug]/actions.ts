"use server";

import { headers } from "next/headers";

import {
  categoryFromDescription,
  evaluateSafety,
  type SafetyAnswerMap,
} from "@/lib/booking-safety";
import { attachCheckoutToBooking, getPublicBookingPage } from "@/lib/public-booking";
import { checkServiceArea } from "@/lib/service-area";
import { smsConsentRecord } from "@/lib/sms-consent";
import { createPublicClient, getMessagingBusinessName } from "@/lib/supabase/public";
import { getStripe } from "@/lib/stripe";

export type BookingActionState = {
  error: string;
  outcome?: "needs_review" | "emergency_services" | "utility_referral";
  distanceMiles?: number | null;
  checkoutUrl?: string;
};

type CreatedIntake = {
  intake_id: string;
  booking_token: string;
  intake_status: string;
  fee_cents: number;
};

function getText(formData: FormData, key: string, maxLength: number) {
  return String(formData.get(key) ?? "").trim().slice(0, maxLength);
}

function parseSafetyAnswers(raw: string): SafetyAnswerMap {
  try {
    const candidate = JSON.parse(raw) as Record<string, unknown>;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};

    return Object.fromEntries(
      Object.entries(candidate)
        .slice(0, 20)
        .filter((entry): entry is [string, boolean] =>
          /^[a-z_]{1,60}$/.test(entry[0]) && typeof entry[1] === "boolean",
        ),
    );
  } catch {
    return {};
  }
}

function getRequestOrigin(requestHeaders: Headers) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const origin = requestHeaders.get("origin");
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const candidate = origin || configured || (host ? `${protocol}://${host}` : "");

  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function startPublicBooking(
  slug: string,
  _previousState: BookingActionState,
  formData: FormData,
): Promise<BookingActionState> {
  const customerType = getText(formData, "customerType", 20);
  const firstName = getText(formData, "firstName", 80);
  const lastName = getText(formData, "lastName", 80);
  const email = getText(formData, "email", 254).toLowerCase();
  const phone = getText(formData, "phone", 30);
  const addressLine1 = getText(formData, "addressLine1", 160);
  const addressLine2 = getText(formData, "addressLine2", 120);
  const city = getText(formData, "city", 80);
  const state = getText(formData, "state", 2).toUpperCase();
  const postalCode = getText(formData, "postalCode", 10);
  const accessNotes = getText(formData, "accessNotes", 500);
  const description = getText(formData, "description", 2_000);
  const slotStart = getText(formData, "slotStart", 40);
  const slotEnd = getText(formData, "slotEnd", 40);
  const safetyAnswers = parseSafetyAnswers(getText(formData, "safetyAnswers", 4_000));
  const acceptedPolicy = formData.get("acceptedPolicy") === "yes";
  const smsConsent = formData.get("smsConsent") === "yes";

  if (customerType !== "residential" && customerType !== "commercial") {
    return { error: "Choose residential or commercial service." };
  }
  if (firstName.length < 1 || lastName.length < 1) {
    return { error: "Enter your first and last name." };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: "Enter a valid email address." };
  }
  if (phone.replace(/\D/g, "").length < 7) {
    return { error: "Enter a valid phone number." };
  }
  if (addressLine1.length < 3 || city.length < 2 || !/^[A-Z]{2}$/.test(state)) {
    return { error: "Enter the complete service address." };
  }
  if (!/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
    return { error: "Enter a valid ZIP code." };
  }
  if (description.length < 10) {
    return { error: "Describe what is happening in a little more detail." };
  }
  if (!acceptedPolicy) {
    return { error: "Confirm the diagnostic and cancellation policy to continue." };
  }

  const bookingPage = await getPublicBookingPage(slug);
  if (!bookingPage) return { error: "This booking page is not currently available." };

  // Resolved the same way the form resolved it, so the retained proof matches
  // the business named on the checkbox the customer actually ticked.
  const messagingBusinessName = await getMessagingBusinessName(
    slug,
    bookingPage.display_name,
  );

  const safety = evaluateSafety(description, safetyAnswers);
  if (safety.outcome === "emergency_services") {
    return {
      error: "Online booking is paused because an immediate electrical hazard was reported.",
      outcome: "emergency_services",
    };
  }
  if (safety.outcome === "utility_referral") {
    return {
      error: "This appears to affect nearby properties and should be checked by the utility first.",
      outcome: "utility_referral",
    };
  }

  const serviceArea = await checkServiceArea(
    bookingPage.base_postal_code,
    postalCode,
    bookingPage.automatic_booking_radius_miles,
  );
  const bookingMode = serviceArea.status === "inside" ? "paid_visit" : "callback";
  const priority = safety.outcome === "urgent_review" ? "emergency" : "standard";

  if (bookingMode === "paid_visit") {
    const startTime = Date.parse(slotStart);
    const endTime = Date.parse(slotEnd);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
      return { error: "Choose an available arrival window." };
    }
    if (!getStripe()) {
      return {
        error: "Secure test payments are still being connected. Please try again after the Stripe sandbox is enabled.",
      };
    }
  }

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("create_public_booking_intake", {
    p_slug: slug,
    p_booking_mode: bookingMode,
    p_customer_type: customerType,
    p_first_name: firstName,
    p_last_name: lastName,
    p_email: email,
    p_phone: phone,
    p_address_line_1: addressLine1,
    p_address_line_2: addressLine2,
    p_city: city,
    p_state: state,
    p_postal_code: postalCode,
    p_access_notes: accessNotes,
    p_transactional_contact_consent: acceptedPolicy,
    p_sms_consent: smsConsent,
    // Rebuilt from the disclosure module rather than echoed back from the
    // browser: the retained consent proof has to be the wording this server
    // rendered, not whatever the client chose to post.
    p_sms_consent_disclosure: smsConsent ? smsConsentRecord(messagingBusinessName) : null,
    p_customer_description: description,
    p_category: categoryFromDescription(description),
    p_safety_answers: safetyAnswers,
    p_safety_flags: safety.flags,
    p_safety_outcome: safety.outcome,
    p_priority: priority,
    p_service_area_status: serviceArea.status,
    p_service_distance_miles: serviceArea.distanceMiles,
    p_arrival_window_start: bookingMode === "paid_visit" ? slotStart : null,
    p_arrival_window_end: bookingMode === "paid_visit" ? slotEnd : null,
  });

  const intake = (data as CreatedIntake[] | null)?.[0];
  if (error || !intake) {
    const unavailable = error?.message.toLowerCase().includes("no longer available");
    return {
      error: unavailable
        ? "That arrival window was just taken. Choose another available time."
        : "We couldn’t save the request. Review the details and try again.",
    };
  }

  if (intake.intake_status === "needs_review") {
    return {
      error: "",
      outcome: "needs_review",
      distanceMiles: serviceArea.distanceMiles,
    };
  }

  const stripe = getStripe();
  const requestOrigin = getRequestOrigin(await headers());
  if (!stripe || !requestOrigin) {
    return { error: "Secure checkout could not be started. Please try again." };
  }

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: email,
        expires_at: Math.floor(Date.now() / 1_000) + 30 * 60,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: intake.fee_cents,
              product_data: {
                name:
                  priority === "emergency"
                    ? "Emergency electrical diagnostic"
                    : "Onsite electrical diagnostic",
                description: `${bookingPage.diagnostic_minutes} minutes onsite. Diagnostic fee is credited toward approved repair work.`,
              },
            },
          },
        ],
        metadata: {
          booking_token: intake.booking_token,
          booking_intake_id: intake.intake_id,
          organization_id: bookingPage.organization_id,
          organization_slug: bookingPage.slug,
        },
        payment_intent_data: {
          metadata: {
            booking_intake_id: intake.intake_id,
            organization_id: bookingPage.organization_id,
          },
        },
        success_url: `${requestOrigin}/book/${encodeURIComponent(bookingPage.slug)}/confirmation?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${requestOrigin}/book/${encodeURIComponent(bookingPage.slug)}?checkout=canceled`,
      },
      {
        idempotencyKey: `booking-checkout-${intake.booking_token}`,
      },
    );

    if (!session.url || !(await attachCheckoutToBooking(intake.booking_token, session.id))) {
      await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
      return { error: "The appointment hold could not be completed. Choose the time again." };
    }

    return { error: "", checkoutUrl: session.url };
  } catch {
    return { error: "Secure checkout could not be started. Please try again." };
  }
}
