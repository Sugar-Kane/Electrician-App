import "server-only";

import { createClient } from "@/lib/supabase/server";
import { currentContext, currentUser } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { DEFAULT_TIMEZONE } from "@/lib/timezones";

/**
 * Booking requests that arrived as text messages and still need a person.
 *
 * A visit the customer accepted is already a job by the time it lands here;
 * what is left is callbacks, safety escalations, and anything the intake could
 * not finish — the work that used to sit in a table with no screen.
 */

export type BookingSource = "sms" | "voice" | "web" | "owner";

export type BookingRequest = {
  id: string;
  /** How the customer asked. One table, categorised rather than duplicated. */
  source: BookingSource;
  status:
    | "new"
    | "needs_review"
    | "awaiting_payment"
    | "safety_escalated"
    | "confirmed"
    | "scheduled"
    | "dismissed"
    | "canceled"
    | "expired";
  intent: "callback" | "visit" | "emergency";
  phone: string;
  contactName: string;
  description: string;
  address: string;
  urgency: "routine" | "urgent";
  safetyFlags: string[];
  arrivalWindow: string;
  receivedLabel: string;
  conversationId: string | null;
  jobId: string | null;
};

export type BookingRequestQueue = {
  requiresLogin: boolean;
  timezone: string;
  requests: BookingRequest[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatWhen(iso: string, timeZone: string, withTime = true): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(new Date(iso));
}

export async function getBookingRequests(): Promise<BookingRequestQueue> {
  /*
   * Both memoised for the length of the request. This module used to verify the
   * session and look up the membership itself, and so did the dashboard, and so
   * did `request-context` — three round trips to the auth server before the
   * home page fetched a single row.
   *
   * Two calls rather than one because signed out and signed in with no business
   * are different answers on this screen.
   */
  const user = await currentUser();
  if (!user) return { requiresLogin: true, timezone: DEFAULT_TIMEZONE, requests: [] };

  const context = await currentContext();
  if (!context) return { requiresLogin: false, timezone: DEFAULT_TIMEZONE, requests: [] };

  const supabase = await createClient();
  const database = asFlexibleClient(supabase);
  const organizationId = context.organizationId;
  const timezone = context.timeZone || DEFAULT_TIMEZONE;

  const { data } = await database
    .from("booking_requests")
    .select(
      "id, source, status, intent, phone, contact_name, description, address_line_1, city, postal_code, urgency, safety_flags, arrival_window_start, arrival_window_end, created_at, conversation_id, created_job_id",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(100);

  const requests: BookingRequest[] = ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const start = text(row.arrival_window_start);
    const end = text(row.arrival_window_end);
    return {
      id: text(row.id),
      source: (text(row.source) || "sms") as BookingSource,
      status: (text(row.status) || "new") as BookingRequest["status"],
      intent: (text(row.intent) || "callback") as BookingRequest["intent"],
      phone: text(row.phone),
      contactName: text(row.contact_name),
      description: text(row.description),
      address: [text(row.address_line_1), text(row.city), text(row.postal_code)]
        .filter(Boolean)
        .join(", "),
      urgency: text(row.urgency) === "urgent" ? "urgent" : "routine",
      safetyFlags: Array.isArray(row.safety_flags) ? (row.safety_flags as string[]) : [],
      arrivalWindow: start
        ? `${formatWhen(start, timezone)}${end ? `–${new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(end))}` : ""}`
        : "",
      receivedLabel: formatWhen(text(row.created_at), timezone),
      conversationId: text(row.conversation_id) || null,
      jobId: text(row.created_job_id) || null,
    };
  });

  return { requiresLogin: false, timezone, requests };
}
