import "server-only";
import { decryptDocumentSecret } from "@/lib/document-secrets";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { paidCalendarEvent } from "@/lib/booking-calendar-event";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
export function calendarConfig() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  if (!clientId || !clientSecret || !origin || !process.env.DOCUMENT_SYNC_ENCRYPTION_KEY) return null;
  return { clientId, clientSecret, origin: new URL(origin).origin };
}
export async function syncPaidBookingCalendar(bookingToken: string): Promise<"synced" | "not_connected" | "not_paid"> {
  const db = getSupabaseAdmin();
  const { data: row, error } = await db.from("booking_requests").select("id,organization_id,status,deposit_paid_at,created_job_id,arrival_window_start,arrival_window_end,contact_name,phone,description,address_line_1,city,state,postal_code,intake_answers").eq("public_token", bookingToken).maybeSingle();
  if (error) throw new Error("Calendar booking lookup failed");
  const event = row ? paidCalendarEvent(row) : null;
  if (!row || !event) return "not_paid";
  const organizationId = String(row.organization_id);
  const { data: connection, error: connectionError } = await db.from("booking_calendar_connections").select("account_email,encrypted_refresh_token").eq("organization_id", organizationId).maybeSingle();
  if (connectionError) throw new Error("Calendar connection lookup failed");
  if (!connection?.encrypted_refresh_token) return "not_connected";
  const record = { booking_request_id: row.id, organization_id: organizationId, account_email: connection.account_email, event_id: event.id };
  try {
    const config = calendarConfig();
    if (!config) throw new Error("Calendar server setup is incomplete");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: decryptDocumentSecret(String(connection.encrypted_refresh_token)) }),
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (!tokenResponse.ok) throw new Error("Google authorization expired. Reconnect the calendar.");
    const token = await tokenResponse.json() as { access_token: string };
    const url = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
    const headers = { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" };
    const response = await fetch(`${url}?sendUpdates=none`, { method: "POST", headers, body: JSON.stringify(event), signal: AbortSignal.timeout(15000) });
    if (response.status === 409) {
      const existing = await fetch(`${url}/${event.id}`, { headers, cache: "no-store", signal: AbortSignal.timeout(15000) });
      const value = existing.ok ? await existing.json() : null;
      if (value?.extendedProperties?.private?.volteira_booking_id !== String(row.id) || value?.status === "cancelled") throw new Error("Calendar event requires review");
    } else if (!response.ok) throw new Error(`Google Calendar rejected the booking (${response.status}).`);
    const { error: saveError } = await db.from("booking_calendar_events").upsert({ ...record, synced_at: new Date().toISOString(), last_error: null });
    if (saveError) throw new Error("Calendar sync receipt could not be saved");
    await db.from("booking_calendar_connections").update({ last_error: null }).eq("organization_id", organizationId);
    return "synced";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Calendar sync failed";
    await db.from("booking_calendar_events").upsert({ ...record, last_error: message });
    await db.from("booking_calendar_connections").update({ last_error: message }).eq("organization_id", organizationId);
    throw new Error(message);
  }
}

export async function syncUpcomingPaidBookings(organizationId: string) {
  const db = getSupabaseAdmin();
  let offset = 0;
  while (true) {
    const { data, error } = await db.from("booking_requests").select("public_token").eq("organization_id", organizationId)
      .not("deposit_paid_at", "is", null).in("status", ["scheduled", "confirmed"]).gt("arrival_window_end", new Date().toISOString())
      .order("id").range(offset, offset + 49);
    if (error) throw new Error("Could not load paid bookings");
    for (const row of data ?? []) await syncPaidBookingCalendar(String(row.public_token));
    if (!data || data.length < 50) break;
    offset += 50;
  }
}
