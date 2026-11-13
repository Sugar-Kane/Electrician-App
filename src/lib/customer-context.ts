import "server-only";

import type { CustomerProfile, EarlierCall, EarlierText, LinkDelivery, ProfileJob } from "@/lib/customer-context-rules";
import { EARLIER_CONTACT_DAYS, PROFILE_JOBS } from "@/lib/customer-context-rules";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Reading what a customer has already said on each channel, for
 * customer-context-rules to turn into a note. Service role: both assistants
 * run without a signed-in user, and every query is scoped to one business and
 * one customer.
 */

type Database = ReturnType<typeof getSupabaseAdmin>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function since(): string {
  return new Date(Date.now() - EARLIER_CONTACT_DAYS * 86_400_000).toISOString();
}

/** The customer this number belongs to, without opening a record for a stranger. */
export async function customerForPhone(database: Database, organizationId: string, phone: string): Promise<string | null> {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return null;
  const { data } = await database
    .from("customers")
    .select("id, phone")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .like("phone", `%${digits.slice(-4)}`)
    .limit(25);
  const match = ((data ?? []) as Record<string, unknown>[]).find(
    (row) => text(row.phone).replace(/\D/g, "").slice(-10) === digits,
  );
  return match ? text(match.id) : null;
}

/** Their recent texts, in their newest text conversation. */
export async function textsFor(database: Database, organizationId: string, customerId: string): Promise<EarlierText[]> {
  const { data: conversation } = await database
    .from("conversations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .eq("channel", "sms")
    .is("archived_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!conversation?.id) return [];
  const { data } = await database
    .from("messages")
    .select("direction, body, created_at")
    .eq("conversation_id", text(conversation.id))
    .gte("created_at", since())
    .order("created_at", { ascending: false })
    .limit(20);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    direction: row.direction === "inbound" ? ("inbound" as const) : ("outbound" as const),
    body: text(row.body),
    at: text(row.created_at),
  }));
}

/** Their recent calls, by the requests the phone assistant recorded on them. */
export async function callsFor(database: Database, organizationId: string, customerId: string): Promise<EarlierCall[]> {
  const { data } = await database
    .from("booking_requests")
    .select("created_at, intent, status, description, arrival_window_start, arrival_window_end, address_line_1")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .eq("communication_channel", "phone")
    .gte("created_at", since())
    .order("created_at", { ascending: false })
    .limit(5);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    at: text(row.created_at),
    intent: text(row.intent),
    status: text(row.status),
    description: text(row.description),
    windowStart: text(row.arrival_window_start) || null,
    windowEnd: text(row.arrival_window_end) || null,
    address: text(row.address_line_1),
  }));
}

/** Their name, email and address on file. */
export async function profileFor(database: Database, organizationId: string, customerId: string): Promise<CustomerProfile | null> {
  const { data } = await database
    .from("customers")
    .select("first_name, last_name, email, address_line_1, city")
    .eq("organization_id", organizationId)
    .eq("id", customerId)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const first = text(row.first_name);
  return {
    // Text-only contacts are saved as "Text"; that is not a name to greet anyone by.
    firstName: first === "Text" ? "" : first,
    lastName: text(row.last_name),
    email: text(row.email),
    address: [text(row.address_line_1), text(row.city)].filter(Boolean).join(", "),
  };
}

/** Their jobs, newest first: enough for the next visit and the latest ones done. */
export async function jobsFor(database: Database, organizationId: string, customerId: string): Promise<ProfileJob[]> {
  const { data } = await database
    .from("jobs")
    .select("job_number, status, category, customer_description, scheduled_start, scheduled_end")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(PROFILE_JOBS + 4);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    jobNumber: String(row.job_number ?? ""),
    status: text(row.status),
    kind: text(row.category).replace(/_/g, " "),
    description: text(row.customer_description),
    start: text(row.scheduled_start) || null,
    end: text(row.scheduled_end) || null,
  }));
}

/** Their latest open booking, and every attempt to send them its link. */
export async function linkDeliveryFor(database: Database, organizationId: string, customerId: string): Promise<LinkDelivery | null> {
  const { data } = await database
    .from("booking_requests")
    .select("status, arrival_window_start, notification_results")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .in("status", ["awaiting_payment", "confirmed", "scheduled"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const attempts = (Array.isArray(row.notification_results) ? row.notification_results : []) as Record<string, unknown>[];
  return {
    status: text(row.status),
    windowStart: text(row.arrival_window_start) || null,
    attempts: attempts.map((attempt) => ({
      channel: text(attempt.channel),
      ok: attempt.ok === true,
      at: text(attempt.at),
      audience: text(attempt.audience),
      detail: text(attempt.detail),
    })),
  };
}
