import "server-only";

import type { Json } from "@/lib/database.types";
import { createPublicClient } from "@/lib/supabase/public";

export type PublicBookingPage = {
  organization_id: string;
  slug: string;
  display_name: string;
  business_phone: string | null;
  timezone: string;
  base_city: string;
  base_state: string;
  base_postal_code: string;
  automatic_booking_radius_miles: number;
  diagnostic_fee_cents: number;
  diagnostic_minutes: number;
  credit_diagnostic_to_repair: boolean;
  emergency_fee_cents: number;
  after_hours_fee_cents: number;
  cancellation_fee_cents: number;
  free_reschedule_hours: number;
  business_hours: Json;
  /** Empty until the tenant uploads one; the page falls back to a wordmark. */
  logo_path: string | null;
  /** Empty until the tenant picks one; the page falls back to the product's. */
  brand_color: string | null;
};

export type PublicBookingSlot = {
  slot_start: string;
  slot_end: string;
  fee_cents: number;
  priority: string;
};

export type PublicBookingConfirmation = {
  display_name: string;
  customer_first_name: string;
  job_number: number;
  booking_status: string;
  arrival_window_start: string;
  arrival_window_end: string;
  service_city: string;
  service_state: string;
  amount_paid_cents: number;
  timezone: string;
  business_phone: string | null;
};

export async function getPublicBookingPage(slug: string) {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_public_booking_page", {
    p_slug: slug,
  });

  if (error) return null;
  return ((data as PublicBookingPage[] | null)?.[0] ?? null);
}

/**
 * The booking page for a hostname a tenant pointed at us.
 *
 * Reads the header the middleware set rather than the raw `Host`, so the
 * normalisation rules — case, port, trailing dot, forwarded lists — live in one
 * place and cannot disagree between the routing decision and the lookup.
 *
 * Null for a host nobody has claimed, which the route turns into a 404. That is
 * the honest answer: somebody has pointed DNS at us for a name we have never
 * heard of.
 */
export async function getBookingPageByHost(host: string) {
  if (!host) return null;

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_booking_page_by_host", {
    p_host: host,
  });

  if (error) return null;
  return ((data as PublicBookingPage[] | null)?.[0] ?? null);
}

export async function getPublicBookingSlots(slug: string, days = 21) {
  const supabase = createPublicClient();
  const fromDate = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc("list_public_booking_slots", {
    p_slug: slug,
    p_from_date: fromDate,
    p_days: days,
  });

  if (error) return [];
  return (data as PublicBookingSlot[] | null) ?? [];
}

export async function attachCheckoutToBooking(
  bookingToken: string,
  checkoutSessionId: string,
) {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("attach_public_booking_checkout", {
    p_booking_token: bookingToken,
    p_checkout_session_id: checkoutSessionId,
  });

  return !error && data === true;
}

export async function confirmPublicBookingPayment(input: {
  bookingToken: string;
  checkoutSessionId: string;
  paymentIntentId: string;
  amountCents: number;
  currency: string;
}) {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("confirm_public_booking_payment", {
    p_booking_token: input.bookingToken,
    p_checkout_session_id: input.checkoutSessionId,
    p_payment_intent_id: input.paymentIntentId,
    p_amount_cents: input.amountCents,
    p_currency: input.currency,
  });

  if (error) throw new Error("Unable to confirm the paid booking.");
  return data as string;
}

export async function expirePublicBookingCheckout(
  bookingToken: string,
  checkoutSessionId: string,
) {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("expire_public_booking_checkout", {
    p_booking_token: bookingToken,
    p_checkout_session_id: checkoutSessionId,
  });

  if (error) throw new Error("Unable to release the expired booking hold.");
  return data === true;
}

export async function getPublicBookingConfirmation(
  bookingToken: string,
  checkoutSessionId: string,
) {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_public_booking_confirmation", {
    p_booking_token: bookingToken,
    p_checkout_session_id: checkoutSessionId,
  });

  if (error) return null;
  return ((data as PublicBookingConfirmation[] | null)?.[0] ?? null);
}
