import "server-only";

import { asFlexibleClient, type FlexibleSupabaseClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export type ConversationSummary = {
  id: string;
  customerId: string;
  customerName: string;
  initials: string;
  phone: string;
  status: string;
  lastMessageAt: string | null;
  lastMessageBody: string;
  lastMessageDirection: string;
  unread: boolean;
};

export type ThreadMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  errorDetail: string | null;
};

export type ConversationThread = {
  id: string;
  customerId: string;
  customerName: string;
  initials: string;
  phone: string;
  status: string;
  messages: ThreadMessage[];
  consent: ConsentState;
  quietHours: { start: string; end: string; timezone: string; currentlyQuiet: boolean };
  canSend: boolean;
  blockedReason: string | null;
};

export type ConsentState = {
  optedIn: boolean;
  optedInAt: string | null;
  optedOutAt: string | null;
  source: string | null;
  proofText: string | null;
};

export type MessagingContext = {
  database: FlexibleSupabaseClient;
  organizationId: string;
  userId: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function initialsFor(first: string, last: string) {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || "?";
}

export async function getMessagingContext(): Promise<MessagingContext | null> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return null;

  const database = asFlexibleClient(supabase);
  const { data: membership } = await database
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", authData.user.id)
    .limit(1)
    .maybeSingle();

  const organizationId = text(membership?.organization_id);
  if (!organizationId) return null;

  return { database, organizationId, userId: authData.user.id };
}

/**
 * Whether this customer may be texted right now.
 *
 * A row exists per (customer, channel, scope). Opted in means opted_in_at is
 * set and opted_out_at is not — a STOP writes opted_out_at rather than deleting
 * the row, so the history survives and a later opt-in can be compared against
 * it.
 */
export async function getConsent(
  context: MessagingContext,
  customerId: string,
): Promise<ConsentState> {
  const { data } = await context.database
    .from("messaging_consent")
    .select("opted_in_at, opted_out_at, source, proof_text")
    .eq("organization_id", context.organizationId)
    .eq("customer_id", customerId)
    .eq("channel", "sms")
    .eq("scope", "transactional")
    .maybeSingle();

  const optedInAt = data?.opted_in_at ? String(data.opted_in_at) : null;
  const optedOutAt = data?.opted_out_at ? String(data.opted_out_at) : null;

  return {
    optedIn: Boolean(optedInAt) && !optedOutAt,
    optedInAt,
    optedOutAt,
    source: data?.source ? String(data.source) : null,
    proofText: data?.proof_text ? String(data.proof_text) : null,
  };
}

type QuietHours = { start: string; end: string; timezone: string; currentlyQuiet: boolean };

/**
 * Quiet hours are stored as local wall-clock times and compared in the
 * organization's timezone, not the server's. A window that wraps midnight
 * (21:00 to 08:00, the default) is the normal case, not the exception.
 */
export function evaluateQuietHours(
  start: string,
  end: string,
  timezone: string,
  now = new Date(),
): QuietHours {
  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  const minutes = (value: string) => {
    const [hours, mins] = value.split(":");
    return Number(hours) * 60 + Number(mins);
  };

  const current = minutes(localTime);
  const from = minutes(start);
  const to = minutes(end);
  const currentlyQuiet = from > to ? current >= from || current < to : current >= from && current < to;

  return { start, end, timezone, currentlyQuiet };
}

async function getMessagingSettings(context: MessagingContext) {
  const [{ data: settings }, { data: organization }] = await Promise.all([
    context.database
      .from("messaging_settings")
      .select("messaging_service_sid, quiet_hours_start, quiet_hours_end")
      .eq("organization_id", context.organizationId)
      .maybeSingle(),
    context.database
      .from("organizations")
      .select("timezone")
      .eq("id", context.organizationId)
      .maybeSingle(),
  ]);

  return {
    messagingServiceSid: text(settings?.messaging_service_sid),
    quietHoursStart: text(settings?.quiet_hours_start) || "21:00:00",
    quietHoursEnd: text(settings?.quiet_hours_end) || "08:00:00",
    timezone: text(organization?.timezone) || "America/Los_Angeles",
  };
}

export async function listConversations(
  context: MessagingContext,
): Promise<ConversationSummary[]> {
  const { data } = await context.database
    .from("conversations")
    .select("id, customer_id, status, last_message_at, customers(first_name, last_name, phone)")
    .eq("organization_id", context.organizationId)
    .is("archived_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);

  const conversations = (data ?? []) as Record<string, unknown>[];
  if (conversations.length === 0) return [];

  // One query for the previews rather than one per row.
  const { data: recent } = await context.database
    .from("messages")
    .select("conversation_id, body, direction, created_at, status")
    .in("conversation_id", conversations.map((row) => text(row.id)))
    .order("created_at", { ascending: false })
    .limit(400);

  const latest = new Map<string, Record<string, unknown>>();
  for (const message of (recent ?? []) as Record<string, unknown>[]) {
    const key = text(message.conversation_id);
    if (!latest.has(key)) latest.set(key, message);
  }

  return conversations.map((row) => {
    const customer = (row.customers ?? {}) as Record<string, unknown>;
    const first = text(customer.first_name);
    const last = text(customer.last_name);
    const last_message = latest.get(text(row.id));

    return {
      id: text(row.id),
      customerId: text(row.customer_id),
      customerName: `${first} ${last}`.trim() || "Unknown customer",
      initials: initialsFor(first, last),
      phone: text(customer.phone),
      status: text(row.status),
      lastMessageAt: row.last_message_at ? String(row.last_message_at) : null,
      lastMessageBody: text(last_message?.body),
      lastMessageDirection: text(last_message?.direction),
      // An inbound message nobody has replied to is the thing a dispatcher
      // needs to see first.
      unread: text(last_message?.direction) === "inbound",
    };
  });
}

export async function getConversationThread(
  context: MessagingContext,
  conversationId: string,
): Promise<ConversationThread | null> {
  const { data: conversationRow } = await context.database
    .from("conversations")
    .select("id, customer_id, status, customers(first_name, last_name, phone)")
    .eq("organization_id", context.organizationId)
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversationRow) return null;
  const conversation = conversationRow as Record<string, unknown>;

  const { data: messageRows } = await context.database
    .from("messages")
    .select("id, direction, body, status, created_at, sent_at, delivered_at, error_detail")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(500);

  const customer = (conversation.customers ?? {}) as Record<string, unknown>;
  const first = text(customer.first_name);
  const last = text(customer.last_name);
  const customerId = text(conversation.customer_id);

  const [consent, settings] = await Promise.all([
    getConsent(context, customerId),
    getMessagingSettings(context),
  ]);

  const quietHours = evaluateQuietHours(
    settings.quietHoursStart,
    settings.quietHoursEnd,
    settings.timezone,
  );

  const blockedReason = !consent.optedIn
    ? consent.optedOutAt
      ? "This customer replied STOP. They have to opt in again themselves before you can text them."
      : "This customer has not opted in to text messages. Ask them to opt in on the booking page."
    : !settings.messagingServiceSid
      ? "No messaging service is connected for this business yet."
      : null;

  return {
    id: text(conversation.id),
    customerId,
    customerName: `${first} ${last}`.trim() || "Unknown customer",
    initials: initialsFor(first, last),
    phone: text(customer.phone),
    status: text(conversation.status),
    messages: ((messageRows ?? []) as Record<string, unknown>[]).map((row) => ({
      id: text(row.id),
      direction: text(row.direction) === "inbound" ? "inbound" : "outbound",
      body: text(row.body),
      status: text(row.status),
      createdAt: String(row.created_at),
      sentAt: row.sent_at ? String(row.sent_at) : null,
      deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
      errorDetail: row.error_detail ? String(row.error_detail) : null,
    })),
    consent,
    quietHours,
    canSend: blockedReason === null,
    blockedReason,
  };
}

export async function getSendingConfiguration(context: MessagingContext) {
  return getMessagingSettings(context);
}
