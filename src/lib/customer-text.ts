import type { FlexibleSupabaseClient } from "./supabase/flexible.ts";

/**
 * Text one customer from a business, the same way Send in the inbox does.
 * Used by send_text in ChatGPT/Claude and by an approved assistant action.
 *
 * - Refuses without a phone number or a messaging service; sendSms refuses a
 *   customer who replied STOP.
 * - Finds or opens the customer's conversation (bringing it back if it was
 *   cleared from the inbox) and stands the auto-reply down, because a person
 *   is talking.
 * - Saves the message as "sending" before it is sent, so a send that never
 *   answers is still visible, and reports the saved row's id first
 *   (`onSaved`) so a caller can find it again if it dies mid-send.
 * - Marks the carrier's own STOP list (error 21610) as an opt-out.
 *
 * The SMS provider is passed in (`send`), so this file has no server-only
 * imports and its consent rules can be tested.
 */

type Database = FlexibleSupabaseClient;

export type SendResult = { ok: true; providerMessageId: string; status: string } | { ok: false; errorCode: string; errorDetail: string };
export type SmsSender = (input: { organizationId: string; customerId: string; to: string; body: string; messagingServiceSid: string; statusCallbackUrl?: string }) => Promise<SendResult>;

export type CustomerTextOutcome =
  | { ok: true; messageId: string; conversationId: string; providerMessageId: string; phone: string }
  | { ok: false; sent: false; code: "NO_CONSENT" | "NO_PHONE" | "NOT_CONFIGURED" | "EMPTY" | "NOT_SAVED"; message: string }
  | { ok: false; sent: false; code: "SEND_FAILED"; message: string; messageId: string; errorCode: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/**
 * Whether a customer can be texted: a phone number on file. Consent is not
 * checked here: `sendSms` is the one place it is, and only a STOP refuses.
 */
export async function textingAllowed(
  db: Database,
  organizationId: string,
  customerId: string,
): Promise<{ ok: true; phone: string } | { ok: false; code: "NO_PHONE"; message: string }> {
  const { data: customer } = await db
    .from("customers")
    .select("id, phone")
    .eq("organization_id", organizationId)
    .eq("id", customerId)
    .maybeSingle();
  const phone = text((customer as Record<string, unknown> | null)?.phone);
  if (!phone) return { ok: false, code: "NO_PHONE", message: "The customer has no phone number." };
  return { ok: true, phone };
}

export async function sendCustomerText(
  db: Database,
  input: {
    organizationId: string;
    customerId: string;
    body: string;
    send: SmsSender;
    onSaved?: (messageId: string) => Promise<void>;
  },
): Promise<CustomerTextOutcome> {
  const { organizationId, customerId } = input;
  const body = input.body.trim().slice(0, 500);
  if (!body) return { ok: false, sent: false, code: "EMPTY", message: "The message was empty. Nothing was sent." };

  const allowed = await textingAllowed(db, organizationId, customerId);
  if (!allowed.ok) return { ok: false, sent: false, code: allowed.code, message: `${allowed.message} Nothing was sent.` };
  const phone = allowed.phone;

  const { data: settings } = await db
    .from("messaging_settings")
    .select("messaging_service_sid")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const sid = text((settings as Record<string, unknown> | null)?.messaging_service_sid);
  if (!sid) return { ok: false, sent: false, code: "NOT_CONFIGURED", message: "Messaging is not configured for this business. Nothing was sent." };

  const now = new Date().toISOString();
  const { data: existing } = await db
    .from("conversations")
    .select("id, deleted_at")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .eq("channel", "sms")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const found = existing as Record<string, unknown> | null;
  let conversationId = text(found?.id);
  if (conversationId) {
    await db
      .from("conversations")
      .update({ assistant_paused_at: now })
      .eq("organization_id", organizationId)
      .eq("id", conversationId)
      .is("assistant_paused_at", null);
    if (found?.deleted_at) {
      await db.from("conversations").update({ deleted_at: null, deleted_by: null }).eq("organization_id", organizationId).eq("id", conversationId);
    }
  } else {
    const { data: created } = await db
      .from("conversations")
      .insert({ organization_id: organizationId, customer_id: customerId, channel: "sms", status: "open", assistant_paused_at: now })
      .select("id")
      .maybeSingle();
    conversationId = text((created as Record<string, unknown> | null)?.id);
  }
  if (!conversationId) return { ok: false, sent: false, code: "NOT_SAVED", message: "The conversation could not be opened. Nothing was sent." };

  const { data: saved } = await db
    .from("messages")
    .insert({ organization_id: organizationId, conversation_id: conversationId, direction: "outbound", body, status: "sending", approved_at: now })
    .select("id")
    .maybeSingle();
  const messageId = text((saved as Record<string, unknown> | null)?.id);
  if (!messageId) return { ok: false, sent: false, code: "NOT_SAVED", message: "The text could not be saved. Nothing was sent." };
  if (input.onSaved) await input.onSaved(messageId);

  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  const result = await input.send({
    organizationId,
    customerId,
    to: phone,
    body,
    messagingServiceSid: sid,
    statusCallbackUrl: origin && /^https?:\/\//.test(origin) ? `${origin}/api/twilio/status?message=${messageId}` : undefined,
  });

  if (result.ok) {
    await db
      .from("messages")
      .update({ status: result.status === "delivered" ? "delivered" : "sent", provider_message_id: result.providerMessageId, sent_at: new Date().toISOString() })
      .eq("id", messageId);
    await db
      .from("conversations")
      .update({ last_message_at: new Date().toISOString(), status: "open" })
      .eq("organization_id", organizationId)
      .eq("id", conversationId);
    return { ok: true, messageId, conversationId, providerMessageId: result.providerMessageId, phone };
  }

  await db.from("messages").update({ status: "failed", error_code: result.errorCode, error_detail: result.errorDetail }).eq("id", messageId);
  // 21610 is the carrier's own STOP list: an opt-out this system missed.
  if (result.errorCode === "21610") {
    await db
      .from("messaging_consent")
      .update({ opted_out_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("customer_id", customerId)
      .eq("channel", "sms")
      .eq("scope", "transactional");
  }
  return {
    ok: false,
    sent: false,
    code: "SEND_FAILED",
    messageId,
    errorCode: result.errorCode,
    message: `The text could not be sent (${result.errorCode}: ${result.errorDetail}). It is marked not delivered in the conversation.`,
  };
}
