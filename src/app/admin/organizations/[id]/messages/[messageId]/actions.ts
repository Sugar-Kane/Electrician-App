"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

import { getMessageFacts } from "@/lib/admin-console";
import {
  recipientCorrection,
  retryKey,
  retryRefusal,
  sendOutcome,
  textFingerprint,
} from "@/lib/recovery/text-recovery";
import { hashed } from "@/lib/recovery/fingerprint";
import { toE164 } from "@/lib/phone-format";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { fetchTwilioMessage, sendSms } from "@/lib/twilio";

/**
 * The support console's tools for one text.
 *
 * Each claims an operation first (the database refuses a second claim, a
 * support admin, or a change with no reason), re-reads the facts, refuses if
 * anything moved since the preview, does one thing, and records how it ended.
 * The database checks the record a last time as it writes.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ids(formData: FormData) {
  const organizationId = String(formData.get("organizationId") ?? "");
  const messageId = String(formData.get("messageId") ?? "");
  if (!UUID.test(organizationId) || !UUID.test(messageId)) return null;
  const reveal = String(formData.get("reveal") ?? "");
  const page = `/admin/organizations/${organizationId}/messages/${messageId}`;
  const keep = UUID.test(reveal) ? `&reveal=${reveal}` : "";
  return { organizationId, messageId, page, keep };
}

function refusedBecause(error: { code?: string } | null): string {
  if (!error) return "refused";
  if (error.code === "23505") return "already";
  if (error.code === "42501") return "role";
  if (error.code === "22023") return "reason";
  return "refused";
}

/** Ask Twilio what happened to this text, and bring the local record in line. */
export async function checkDelivery(formData: FormData): Promise<void> {
  const target = ids(formData);
  if (!target) return;
  const facts = await getMessageFacts(target.organizationId, target.messageId);
  if (!facts) redirect(`${target.page}?error=missing${target.keep}`);

  const supabase = asFlexibleClient(await createClient());
  const { data: operation, error } = await supabase.rpc("admin_operation_start", {
    p_organization_id: target.organizationId,
    p_tool: "check_delivery",
    p_target_type: "message",
    p_target_id: target.messageId,
    p_reason: null,
    p_key: `check_delivery:${target.messageId}:${randomUUID()}`,
    p_preview: { status_before: facts.message.status },
  });
  if (error || typeof operation !== "string") redirect(`${target.page}?error=${refusedBecause(error)}${target.keep}`);

  const answer = await fetchTwilioMessage(facts.message.providerMessageId);
  if (!answer.known) {
    await supabase.rpc("admin_operation_finish", {
      p_operation_id: operation,
      p_state: "unknown",
      p_result: { why: answer.reason },
    });
    redirect(`${target.page}?op=${operation}${target.keep}`);
  }

  const { data: after } = await supabase.rpc("admin_apply_delivery_status", {
    p_operation_id: operation,
    p_message_id: target.messageId,
    p_status: answer.status,
    p_error_code: answer.errorCode || null,
    p_error_detail: answer.errorMessage || null,
  });
  await supabase.rpc("admin_operation_finish", {
    p_operation_id: operation,
    p_state: "verified",
    p_result: {
      provider_status: answer.status,
      provider_error: answer.errorCode,
      status_before: facts.message.status,
      status_after: typeof after === "string" ? after : facts.message.status,
    },
  });
  redirect(`${target.page}?op=${operation}${target.keep}`);
}

/** Send a failed text once more, to the number on file now, if nothing forbids it. */
export async function retryText(formData: FormData): Promise<void> {
  const target = ids(formData);
  if (!target) return;
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  const seen = String(formData.get("fingerprint") ?? "");
  if (formData.get("confirm") !== "yes") redirect(`${target.page}?error=confirm${target.keep}`);
  if (reason.length < 3) redirect(`${target.page}?error=reason${target.keep}`);

  // Fresh facts, and the same rules the page used.
  const facts = await getMessageFacts(target.organizationId, target.messageId);
  if (!facts) redirect(`${target.page}?error=missing${target.keep}`);
  if (retryRefusal(facts) || hashed(textFingerprint(facts)) !== seen)
    redirect(`${target.page}?error=changed${target.keep}`);

  const phone = facts.customer?.phone ?? "";
  const supabase = asFlexibleClient(await createClient());
  const { data: operation, error } = await supabase.rpc("admin_operation_start", {
    p_organization_id: target.organizationId,
    p_tool: "retry_text",
    p_target_type: "message",
    p_target_id: target.messageId,
    p_reason: reason,
    p_key: retryKey(target.messageId, facts.operations),
    p_preview: { to_last4: phone.replace(/\D+/g, "").slice(-4), characters: facts.message.body.length },
  });
  if (error || typeof operation !== "string") redirect(`${target.page}?error=${refusedBecause(error)}${target.keep}`);

  // Written down before it goes, with the database checking consent and the
  // number one last time.
  const { data: created, error: stopped } = await supabase.rpc("admin_retry_text_begin", {
    p_operation_id: operation,
    p_message_id: target.messageId,
    p_expected_phone: phone,
  });
  if (stopped || typeof created !== "string") {
    await supabase.rpc("admin_operation_finish", {
      p_operation_id: operation,
      p_state: "failed",
      p_result: { stopped: stopped?.message ?? "Not written." },
    });
    redirect(`${target.page}?op=${operation}${target.keep}`);
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  const result = await sendSms({
    to: toE164(phone),
    body: facts.message.body,
    messagingServiceSid: facts.messaging.serviceSid,
    statusCallbackUrl: origin && /^https?:\/\//.test(origin) ? `${origin}/api/twilio/status?message=${created}` : undefined,
  });

  await supabase.rpc("admin_retry_text_result", {
    p_operation_id: operation,
    p_message_id: target.messageId,
    p_new_message_id: created,
    p_ok: result.ok,
    p_status: result.ok ? result.status : null,
    p_provider_message_id: result.ok ? result.providerMessageId : null,
    p_error_code: result.ok ? null : result.errorCode,
    p_error_detail: result.ok ? null : result.errorDetail,
  });
  await supabase.rpc("admin_operation_finish", {
    p_operation_id: operation,
    p_state: sendOutcome(result),
    p_result: result.ok
      ? { new_message: created, provider_status: result.status }
      : { new_message: created, provider_error: result.errorCode, detail: result.errorDetail },
  });
  redirect(`${target.page}?op=${operation}${target.keep}`);
}

/** Check a corrected number and show it beside the old one before anything changes. */
export async function previewRecipient(formData: FormData): Promise<void> {
  const target = ids(formData);
  if (!target) return;
  const facts = await getMessageFacts(target.organizationId, target.messageId);
  if (!facts?.customer) redirect(`${target.page}?error=missing${target.keep}`);

  const correction = recipientCorrection(facts.customer.phone, String(formData.get("phone") ?? ""));
  if (!correction.ok) redirect(`${target.page}?error=number&why=${encodeURIComponent(correction.refusal)}${target.keep}`);
  redirect(`${target.page}?fix=${encodeURIComponent(correction.number)}${target.keep}#recipient`);
}

/** Save the corrected number to this one customer. Sending again is a separate step. */
export async function applyRecipient(formData: FormData): Promise<void> {
  const target = ids(formData);
  if (!target) return;
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  const seen = String(formData.get("current") ?? "");
  const facts = await getMessageFacts(target.organizationId, target.messageId);
  if (!facts?.customer) redirect(`${target.page}?error=missing${target.keep}`);

  const correction = recipientCorrection(facts.customer.phone, String(formData.get("phone") ?? ""));
  if (!correction.ok) redirect(`${target.page}?error=number&why=${encodeURIComponent(correction.refusal)}${target.keep}`);
  if (hashed(facts.customer.phone) !== seen) redirect(`${target.page}?error=changed${target.keep}`);
  if (reason.length < 3) redirect(`${target.page}?error=reason&fix=${encodeURIComponent(correction.number)}${target.keep}#recipient`);

  const supabase = asFlexibleClient(await createClient());
  const { data: operation, error } = await supabase.rpc("admin_operation_start", {
    p_organization_id: target.organizationId,
    p_tool: "fix_recipient",
    p_target_type: "customer",
    p_target_id: facts.customer.id,
    p_reason: reason,
    // The same correction from the same number can only be applied once. The
    // count lets it be tried again after a refusal, such as the number having
    // belonged to another customer who has since been corrected.
    p_key: `fix_recipient:${facts.customer.id}:${seen}:${correction.number}:${facts.operations.filter((operation) => operation.tool === "fix_recipient").length}`,
    p_preview: {
      message: target.messageId,
      from_last4: facts.customer.phone.replace(/\D+/g, "").slice(-4),
      to_last4: correction.number.slice(-4),
    },
  });
  if (error || typeof operation !== "string") redirect(`${target.page}?error=${refusedBecause(error)}${target.keep}`);

  const { error: refused } = await supabase.rpc("admin_fix_customer_phone", {
    p_operation_id: operation,
    p_customer_id: facts.customer.id,
    p_expected_phone: facts.customer.phone,
    p_new_phone: correction.number,
  });
  await supabase.rpc("admin_operation_finish", {
    p_operation_id: operation,
    p_state: refused ? "failed" : "verified",
    p_result: refused
      ? { stopped: refused.message }
      : { message: target.messageId, to_last4: correction.number.slice(-4) },
  });
  redirect(`${target.page}?op=${operation}${target.keep}`);
}
