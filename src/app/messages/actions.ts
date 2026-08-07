"use server";

import { revalidatePath } from "next/cache";

import {
  getConsent,
  getConversationThread,
  getMessagingContext,
  getSendingConfiguration,
} from "@/lib/messaging";
import { sendSms } from "@/lib/twilio";

export type SendMessageState = { error: string; sent?: boolean; quietHoursBlocked?: boolean };

function appUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  return configured && /^https?:\/\//.test(configured) ? configured : null;
}

/**
 * Send one message in a conversation.
 *
 * Consent is checked here, against the ledger, at the moment of sending —
 * never from anything the browser posted. A thread that was sendable when the
 * page rendered may not be by the time Send is pressed, because the customer
 * can reply STOP in between.
 */
export async function sendConversationMessage(
  conversationId: string,
  _previousState: SendMessageState,
  formData: FormData,
): Promise<SendMessageState> {
  const body = String(formData.get("body") ?? "").trim();
  const overrideQuietHours = formData.get("overrideQuietHours") === "yes";

  if (body.length < 1) return { error: "Write a message first." };
  if (body.length > 1600) return { error: "Messages are limited to 1600 characters." };

  const context = await getMessagingContext();
  if (!context) return { error: "Sign in to send messages." };

  const thread = await getConversationThread(context, conversationId);
  if (!thread) return { error: "That conversation could not be found." };

  const consent = await getConsent(context, thread.customerId);
  if (!consent.optedIn) {
    return {
      error: consent.optedOutAt
        ? "This customer replied STOP. They have to opt in again themselves."
        : "This customer has not opted in to text messages.",
    };
  }

  if (thread.quietHours.currentlyQuiet && !overrideQuietHours) {
    return {
      error: `It is quiet hours for this business (${thread.quietHours.start.slice(0, 5)}–${thread.quietHours.end.slice(0, 5)}).`,
      quietHoursBlocked: true,
    };
  }

  const settings = await getSendingConfiguration(context);
  if (!settings.messagingServiceSid) {
    return { error: "No messaging service is connected for this business yet." };
  }
  if (!thread.phone) {
    return { error: "This customer has no phone number on file." };
  }

  // Recorded before the send, so a message that leaves Twilio but never returns
  // a response is still visible rather than silently lost.
  const { data: inserted, error: insertError } = await context.database
    .from("messages")
    .insert({
      organization_id: context.organizationId,
      conversation_id: conversationId,
      direction: "outbound",
      body,
      status: "sending",
      approved_by: context.userId,
      approved_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !inserted) return { error: "The message could not be saved." };

  const messageId = String(inserted.id);
  const origin = appUrl();

  const result = await sendSms({
    to: thread.phone,
    body,
    messagingServiceSid: settings.messagingServiceSid,
    statusCallbackUrl: origin ? `${origin}/api/twilio/status` : undefined,
  });

  if (result.ok) {
    await context.database
      .from("messages")
      .update({
        status: result.status === "delivered" ? "delivered" : "sent",
        provider_message_id: result.providerMessageId,
        sent_at: new Date().toISOString(),
      })
      .eq("id", messageId);

    await context.database
      .from("conversations")
      .update({ last_message_at: new Date().toISOString(), status: "open" })
      .eq("id", conversationId);
  } else {
    await context.database
      .from("messages")
      .update({
        status: "failed",
        error_code: result.errorCode,
        error_detail: result.errorDetail,
      })
      .eq("id", messageId);

    // 21610 is Twilio's STOP list: the carrier knows about an opt-out this
    // system missed. Bring the ledger back in line rather than letting staff
    // retry into a wall.
    if (result.errorCode === "21610") {
      await context.database
        .from("messaging_consent")
        .update({ opted_out_at: new Date().toISOString() })
        .eq("organization_id", context.organizationId)
        .eq("customer_id", thread.customerId)
        .eq("channel", "sms")
        .eq("scope", "transactional");
    }

    revalidatePath(`/messages/${conversationId}`);
    return { error: `Not delivered: ${result.errorDetail}` };
  }

  revalidatePath("/messages");
  revalidatePath(`/messages/${conversationId}`);
  return { error: "", sent: true };
}
