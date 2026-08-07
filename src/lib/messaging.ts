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

export type StartableCustomer = {
  id: string;
  name: string;
  initials: string;
  phone: string;
};

export type MessagingContext = {
  database: FlexibleSupabaseClient;
  organizationId: string;
  userId: string;
  /** The business's timezone. Every time shown to staff is rendered in it. */
  timezone: string;
};

/** Conversations listed at once. Bounds the preview query below with it. */
const CONVERSATION_LIMIT = 50;
/** Messages loaded into a thread — the newest ones, not the oldest. */
const THREAD_MESSAGE_LIMIT = 200;

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

/**
 * Customers may be a person, a company, or both: the table only requires that
 * one of first_name, last_name, or company_name is present. Falling back to
 * "Unknown customer" for a commercial customer with just a company name would
 * be wrong on every commercial thread.
 */
function displayNameFor(customer: Record<string, unknown>) {
  const person = `${text(customer.first_name)} ${text(customer.last_name)}`.trim();
  return person || text(customer.company_name) || "Unknown customer";
}

function initialsFor(customer: Record<string, unknown>) {
  const first = text(customer.first_name);
  const last = text(customer.last_name);
  if (first || last) return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  const company = text(customer.company_name);
  return company ? company.slice(0, 2).toUpperCase() : "?";
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

  const { data: organization } = await database
    .from("organizations")
    .select("timezone")
    .eq("id", organizationId)
    .maybeSingle();

  return {
    database,
    organizationId,
    userId: authData.user.id,
    timezone: text(organization?.timezone) || "America/Los_Angeles",
  };
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
  const { data: settings } = await context.database
    .from("messaging_settings")
    .select("messaging_service_sid, quiet_hours_start, quiet_hours_end")
    .eq("organization_id", context.organizationId)
    .maybeSingle();

  return {
    messagingServiceSid: text(settings?.messaging_service_sid),
    quietHoursStart: text(settings?.quiet_hours_start) || "21:00:00",
    quietHoursEnd: text(settings?.quiet_hours_end) || "08:00:00",
    timezone: context.timezone,
  };
}

export async function listConversations(
  context: MessagingContext,
): Promise<ConversationSummary[]> {
  const { data } = await context.database
    .from("conversations")
    .select(
      "id, customer_id, status, last_message_at, customers(first_name, last_name, company_name, phone)",
    )
    .eq("organization_id", context.organizationId)
    .is("archived_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(CONVERSATION_LIMIT);

  const conversations = (data ?? []) as Record<string, unknown>[];
  if (conversations.length === 0) return [];

  // One query for all previews rather than one per row. The limit is generous
  // relative to CONVERSATION_LIMIT so a busy thread cannot crowd quiet ones out
  // of their own preview; the exact fix is a `distinct on (conversation_id)`
  // view, which is worth doing if these lists ever grow.
  const { data: recent } = await context.database
    .from("messages")
    .select("conversation_id, body, direction, created_at")
    .in(
      "conversation_id",
      conversations.map((row) => text(row.id)),
    )
    .order("created_at", { ascending: false })
    .limit(CONVERSATION_LIMIT * 40);

  const latest = new Map<string, Record<string, unknown>>();
  for (const message of (recent ?? []) as Record<string, unknown>[]) {
    const key = text(message.conversation_id);
    if (!latest.has(key)) latest.set(key, message);
  }

  return conversations.map((row) => {
    const customer = (row.customers ?? {}) as Record<string, unknown>;
    const lastMessage = latest.get(text(row.id));

    return {
      id: text(row.id),
      customerId: text(row.customer_id),
      customerName: displayNameFor(customer),
      initials: initialsFor(customer),
      phone: text(customer.phone),
      status: text(row.status),
      lastMessageAt: row.last_message_at ? String(row.last_message_at) : null,
      lastMessageBody: text(lastMessage?.body),
      lastMessageDirection: text(lastMessage?.direction),
      // An inbound message nobody has replied to is the thing a dispatcher
      // needs to see first.
      unread: text(lastMessage?.direction) === "inbound",
    };
  });
}

export async function getConversationThread(
  context: MessagingContext,
  conversationId: string,
): Promise<ConversationThread | null> {
  const { data: conversationRow } = await context.database
    .from("conversations")
    .select(
      "id, customer_id, status, customers(first_name, last_name, company_name, phone)",
    )
    .eq("organization_id", context.organizationId)
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversationRow) return null;
  const conversation = conversationRow as Record<string, unknown>;

  // Newest first from the database, then reversed for display: ordering
  // ascending and taking a limit would return the oldest messages and hide
  // everything recent, including the one just sent.
  const { data: messageRows } = await context.database
    .from("messages")
    .select("id, direction, body, status, created_at, sent_at, delivered_at, error_detail")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(THREAD_MESSAGE_LIMIT);

  const customer = (conversation.customers ?? {}) as Record<string, unknown>;
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
    customerName: displayNameFor(customer),
    initials: initialsFor(customer),
    phone: text(customer.phone),
    status: text(conversation.status),
    messages: ((messageRows ?? []) as Record<string, unknown>[])
      .map((row) => ({
        id: text(row.id),
        direction: text(row.direction) === "inbound" ? ("inbound" as const) : ("outbound" as const),
        body: text(row.body),
        status: text(row.status),
        createdAt: String(row.created_at),
        sentAt: row.sent_at ? String(row.sent_at) : null,
        deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
        errorDetail: row.error_detail ? String(row.error_detail) : null,
      }))
      .reverse(),
    consent,
    quietHours,
    canSend: blockedReason === null,
    blockedReason,
  };
}

/**
 * Customers who can be texted but have no conversation yet.
 *
 * Without this the inbox is unreachable until a customer texts first, because
 * only the inbound webhook ever creates a conversation.
 */
export async function listStartableCustomers(
  context: MessagingContext,
): Promise<StartableCustomer[]> {
  const { data: consents } = await context.database
    .from("messaging_consent")
    .select("customer_id")
    .eq("organization_id", context.organizationId)
    .eq("channel", "sms")
    .eq("scope", "transactional")
    .not("opted_in_at", "is", null)
    .is("opted_out_at", null)
    .limit(500);

  const optedInIds = ((consents ?? []) as Record<string, unknown>[]).map((row) =>
    text(row.customer_id),
  );
  if (optedInIds.length === 0) return [];

  const { data: existing } = await context.database
    .from("conversations")
    .select("customer_id")
    .eq("organization_id", context.organizationId)
    .is("archived_at", null)
    .in("customer_id", optedInIds);

  const alreadyOpen = new Set(
    ((existing ?? []) as Record<string, unknown>[]).map((row) => text(row.customer_id)),
  );
  const candidates = optedInIds.filter((id) => !alreadyOpen.has(id));
  if (candidates.length === 0) return [];

  const { data: customers } = await context.database
    .from("customers")
    .select("id, first_name, last_name, company_name, phone")
    .eq("organization_id", context.organizationId)
    .is("archived_at", null)
    .in("id", candidates)
    .limit(100);

  return ((customers ?? []) as Record<string, unknown>[])
    .filter((row) => text(row.phone).length > 0)
    .map((row) => ({
      id: text(row.id),
      name: displayNameFor(row),
      initials: initialsFor(row),
      phone: text(row.phone),
    }));
}

export async function getSendingConfiguration(context: MessagingContext) {
  return getMessagingSettings(context);
}
