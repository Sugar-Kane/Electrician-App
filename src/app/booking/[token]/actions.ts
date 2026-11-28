"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { originFromHeaders } from "@/lib/booking-checkout";
import {
  loadDiagnosticPolicy,
  recordDiagnosticAuthorization,
  revokeDiagnosticAuthorization,
  startDiagnosticSetupCheckout,
} from "@/lib/diagnostic-payment-server";
import { getBookingPaymentIntent } from "@/lib/public-booking";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";

export type AuthorizeState = { error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A customer who booked by text or phone authorizes saving a payment method.
 * The token is the whole of the authorization to act on this booking, as on
 * the rest of this page; the amount and the wording come from the server.
 */
export async function authorizeBookingPaymentMethod(
  token: string,
  _previous: AuthorizeState,
  formData: FormData,
): Promise<AuthorizeState> {
  if (!UUID.test(token)) return { error: "This link is not valid." };
  if (formData.get("paymentAuthorization") !== "yes") {
    return { error: "Tick the box to authorize saving your payment method. Nothing is charged today." };
  }
  const language = formData.get("language") === "es" ? "es" : "en";

  const intent = await getBookingPaymentIntent(token);
  if (!intent || intent.status !== "awaiting_payment" || intent.fee_cents <= 0) {
    return { error: language === "es" ? "Esta cita ya no espera un método de pago." : "This booking is no longer waiting for a payment method." };
  }
  const policy = await loadDiagnosticPolicy(intent.organization_id);
  if (policy.collectAt !== "after_completion") return { error: "This business collects its fee at booking." };

  const requestHeaders = await headers();
  const origin = originFromHeaders(requestHeaders);
  const { data: booking } = await asFlexibleClient(getSupabaseAdmin())
    .from("booking_requests")
    .select("customer_id, contact_name, phone, email, source")
    .eq("public_token", token)
    .maybeSingle();
  const row = (booking ?? {}) as Record<string, unknown>;
  const source = row.source === "voice" ? "voice" : row.source === "sms" ? "sms" : "portal";

  const authorization = await recordDiagnosticAuthorization({
    bookingToken: token,
    via: source === "portal" ? "portal" : source,
    language,
    businessName: intent.business_name,
    feeCents: intent.fee_cents,
    ip: requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: requestHeaders.get("user-agent"),
  });
  if ("error" in authorization) return { error: authorization.error };

  const setup = await startDiagnosticSetupCheckout({
    bookingToken: token,
    authorizationId: authorization.id,
    authorizationText: authorization.text,
    organizationId: intent.organization_id,
    slug: intent.organization_slug,
    businessName: intent.business_name,
    feeCents: intent.fee_cents,
    email: intent.email ?? undefined,
    name: typeof row.contact_name === "string" ? row.contact_name : undefined,
    phone: typeof row.phone === "string" ? row.phone : undefined,
    customerId: typeof row.customer_id === "string" ? row.customer_id : null,
    origin,
    expiresAt: intent.expires_at ?? undefined,
    language,
  });
  if ("error" in setup) {
    return { error: language === "es" ? "No se pudo abrir la página segura de Stripe. Intente de nuevo." : "The secure Stripe page could not be opened. Please try again." };
  }
  redirect(setup.url);
}

/** The customer withdraws their authorization; the appointment stands. */
export async function revokeBookingAuthorization(token: string): Promise<void> {
  if (!UUID.test(token)) return;
  await revokeDiagnosticAuthorization(token);
  redirect(`/booking/${encodeURIComponent(token)}?pay=revoked`);
}
