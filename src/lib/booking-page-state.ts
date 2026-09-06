/**
 * The truthful customer-facing state of a diagnostic request.
 *
 * A requested time and a paid appointment are deliberately different. The
 * database status is authoritative, while `depositPaid` keeps a successful
 * charge from ever being presented as unpaid during the short window before a
 * scheduling review is resolved.
 */

export type BookingPageState =
  | "awaiting_payment"
  | "confirmed"
  | "payment_review"
  | "contact_business";

export function bookingPageState(input: {
  status: string | null;
  depositPaid: boolean;
  depositCents: number;
  /** A hold is only truthful while its clock is still running. */
  expiresAt?: string | null;
  /** Injectable for deterministic tests; production uses the current time. */
  nowMs?: number;
}): BookingPageState {
  const status = (input.status ?? "").trim().toLowerCase();
  const confirmed = status === "confirmed" || status === "scheduled";

  if (confirmed && (input.depositPaid || input.depositCents <= 0)) return "confirmed";
  if (input.depositPaid) return confirmed ? "confirmed" : "payment_review";
  if (status === "awaiting_payment") {
    const expiry = input.expiresAt ? Date.parse(input.expiresAt) : Number.NaN;
    if (Number.isFinite(expiry) && expiry <= (input.nowMs ?? Date.now())) {
      return "contact_business";
    }
    return "awaiting_payment";
  }
  return "contact_business";
}

export function bookingPayNotice(value: string | undefined): string {
  if (value === "canceled") {
    return "Checkout was canceled. Your appointment is not confirmed yet.";
  }
  if (value === "unavailable") {
    return "Secure checkout could not be started. Please try again or call the business.";
  }
  if (value === "expired") {
    return "That payment link is no longer active. Call the business to choose another time.";
  }
  return "";
}
