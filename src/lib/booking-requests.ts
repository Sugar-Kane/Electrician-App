import "server-only";

import { createClient } from "@/lib/supabase/server";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { DEFAULT_TIMEZONE } from "@/lib/timezones";

/**
 * Booking requests that arrived as text messages and still need a person.
 *
 * A visit the customer accepted is already a job by the time it lands here;
 * what is left is callbacks, safety escalations, and anything the intake could
 * not finish — the work that used to sit in a table with no screen.
 */

export type BookingRequest = {
  id: string;
  status: "new" | "scheduled" | "dismissed";
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
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return { requiresLogin: true, timezone: DEFAULT_TIMEZONE, requests: [] };

  const database = asFlexibleClient(supabase);
  const { data: membership } = await database
    .from("organization_members")
    .select("organization_id, organizations(timezone)")
    .eq("user_id", authData.user.id)
    .limit(1)
    .maybeSingle();

  const row = membership as unknown as {
    organization_id?: string;
    organizations?: { timezone?: string } | null;
  } | null;
  const organizationId = text(row?.organization_id);
  if (!organizationId) return { requiresLogin: false, timezone: DEFAULT_TIMEZONE, requests: [] };

  const timezone = text(row?.organizations?.timezone) || DEFAULT_TIMEZONE;

  const { data } = await database
    .from("sms_booking_requests")
    .select(
      "id, status, intent, phone, contact_name, description, address_line_1, city, postal_code, urgency, safety_flags, arrival_window_start, arrival_window_end, created_at, conversation_id, created_job_id",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(100);

  const requests: BookingRequest[] = ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const start = text(row.arrival_window_start);
    const end = text(row.arrival_window_end);
    return {
      id: text(row.id),
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
