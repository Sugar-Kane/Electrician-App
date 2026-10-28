import "server-only";

import type { EarlierCall, EarlierText } from "@/lib/customer-context-rules";
import { EARLIER_CONTACT_DAYS } from "@/lib/customer-context-rules";
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
