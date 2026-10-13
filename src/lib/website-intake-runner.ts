import "server-only";

import { sendWebsiteRequestAlert } from "@/lib/booking-notifications";
import { isMcpConfigured } from "@/lib/mcp-session";
import { readInboundText } from "@/lib/claude";
import { loadIntakeContext, openWebsiteRequest } from "@/lib/intake-shared";
import { consentIsActive } from "@/lib/messaging-rules";
import { toE164 } from "@/lib/phone-format";
import { buildIntakeSystemPrompt, decideIntakeAction, INTAKE_QUESTIONS } from "@/lib/sms-intake";
import { replyToCustomer } from "@/lib/sms-intake-runner";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isTwilioConfigured, placeCall } from "@/lib/twilio";
import { RECEPTIONIST_NAME } from "@/lib/voice-intake";
import {
  websiteCallDecision,
  websiteOpener,
  websiteOpenerFallback,
  websiteTextDecision,
  type IntakeConsent,
} from "@/lib/website-intake";

/**
 * What happens after a website request is saved: the owner is told, and the
 * assistant texts the customer when they agreed to texts.
 *
 * Runs once per request, after the website has had its answer, so a slow model
 * or carrier never holds up the form. Never throws; the request is already
 * saved and nothing here may unmake it.
 */

export type WebsiteFollowUp = { texted: boolean; called?: boolean; reason?: string };

export async function followUpWebsiteRequest(input: {
  organizationId: string;
  requestId: string;
  customerId: string;
  consent: IntakeConsent;
  facts: {
    contactName: string;
    phone: string;
    /** What they chose on the form: "phone", "text" or "email". */
    contactMethod: string;
    serviceName: string;
    description: string;
    town: string;
    preferredTimes: string;
  };
}): Promise<WebsiteFollowUp> {
  try {
    const database = getSupabaseAdmin();

    // Read again rather than trusted from the intake: a STOP can land between
    // the request being saved and this running.
    const { data: consentRow } = await database
      .from("messaging_consent")
      .select("opted_in_at, opted_out_at")
      .eq("organization_id", input.organizationId)
      .eq("customer_id", input.customerId)
      .eq("channel", "sms")
      .eq("scope", "transactional")
      .maybeSingle();
    const consentActiveNow = consentRow
      ? consentIsActive({
          optedInAt: consentRow.opted_in_at ? String(consentRow.opted_in_at) : null,
          optedOutAt: consentRow.opted_out_at ? String(consentRow.opted_out_at) : null,
        })
      : false;

    const loaded = await loadIntakeContext({
      database,
      organizationId: input.organizationId,
      // This is the first thing the business says to them in this thread, so
      // it carries the opt-out.
      isFirstReply: true,
    });
    const to = toE164(input.facts.phone);
    const decision = websiteTextDecision({
      duplicate: false,
      consent: input.consent,
      consentActiveNow,
      textingConfigured: Boolean(loaded.messagingServiceSid && to),
    });

    // They asked for a phone call: Maya rings them now, from the business's
    // number, and the call takes the place of the first text.
    const called = await callBack({
      database,
      organizationId: input.organizationId,
      requestId: input.requestId,
      contactMethod: input.facts.contactMethod,
      to,
    });

    await sendWebsiteRequestAlert({
      requestId: input.requestId,
      organizationId: input.organizationId,
      businessName: loaded.context.businessName,
      owner: loaded.owner,
      messagingServiceSid: loaded.messagingServiceSid,
      facts: {
        contactName: input.facts.contactName,
        customerPhone: input.facts.phone,
        serviceName: input.facts.serviceName,
        description: input.facts.description,
        town: input.facts.town,
        preferredTimes: input.facts.preferredTimes,
        texting: called
          ? "calling"
          : decision.send
          ? "texting"
          : decision.reason === "opted_out"
            ? "opted_out"
            : decision.reason === "texting_not_set_up"
              ? "not_set_up"
              : "no_consent",
        link: process.env.NEXT_PUBLIC_APP_URL
          ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/booking-requests`
          : undefined,
      },
    });

    if (called) return { texted: false, called: true };
    if (!decision.send) return { texted: false, reason: decision.reason };

    // The thread an inbound reply from this number will land in: the newest
    // open one, or a new one. Linking the request to it is what lets the
    // assistant carry this request on when the customer answers.
    const { data: existing } = await database
      .from("conversations")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("customer_id", input.customerId)
      .eq("channel", "sms")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let conversationId = existing?.id ? String(existing.id) : "";
    if (!conversationId) {
      const { data: created } = await database
        .from("conversations")
        .insert({
          organization_id: input.organizationId,
          customer_id: input.customerId,
          channel: "sms",
          status: "open",
          last_message_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      conversationId = created?.id ? String(created.id) : "";
    }
    if (!conversationId) return { texted: false, reason: "no_conversation" };

    await database.from("booking_requests").update({ conversation_id: conversationId }).eq("id", input.requestId);

    const website = await openWebsiteRequest(database, { organizationId: input.organizationId, conversationId });
    if (!website) return { texted: false, reason: "request_closed" };

    // The same assistant that answers texts, reading the form as the
    // customer's first message: it asks for what is missing, or offers the
    // first open window when it has enough. A booking needs the customer's own
    // yes, so the first message never books anything.
    const context = loaded.context;
    context.intakeBeforeOffer = true;
    context.photoOfferHandled = false;
    const modelDecision = await readInboundText({
      system: buildIntakeSystemPrompt(context),
      turns: [{ role: "user", text: website.turn }],
    });
    const action = decideIntakeAction({ decision: modelDecision, customerText: website.turn, context });

    // Written as Maya, the same receptionist who answers the phone.
    const body =
      modelDecision && (action.kind === "ask" || action.kind === "propose")
        ? websiteOpener({
            businessName: context.businessName,
            assistantName: RECEPTIONIST_NAME,
            firstName: website.firstName,
            reply: action.reply,
          })
        : websiteOpenerFallback({
            businessName: context.businessName,
            assistantName: RECEPTIONIST_NAME,
            firstName: website.firstName,
            firstQuestion: INTAKE_QUESTIONS[0].question,
          });
    if (!modelDecision || (action.kind !== "ask" && action.kind !== "propose")) {
      console.error("website request opener sent the fallback", {
        requestId: input.requestId,
        decided: Boolean(modelDecision),
        kind: action.kind,
      });
    }

    const sent = await replyToCustomer({
      database,
      organizationId: input.organizationId,
      conversationId,
      to,
      body,
      messagingServiceSid: loaded.messagingServiceSid,
    });

    await database
      .from("conversations")
      .update({ status: "open", escalation_reason: null, last_message_at: new Date().toISOString() })
      .eq("id", conversationId);

    return sent ? { texted: true } : { texted: false, reason: "send_failed" };
  } catch (error) {
    console.error("website request follow-up failed", { requestId: input.requestId, error: String(error) });
    return { texted: false, reason: "failed" };
  }
}

/**
 * Ring a customer who asked for a call, and note the call on the request.
 *
 * Returns whether a call was placed. Calling needs Maya's line to be set up on
 * this deployment: Twilio, a business number, and the booking tools' secret.
 * The call itself is answered by the agent set up in the xAI console, so no
 * xAI secret is needed here.
 */
async function callBack(input: {
  database: ReturnType<typeof getSupabaseAdmin>;
  organizationId: string;
  requestId: string;
  contactMethod: string;
  to: string;
}): Promise<boolean> {
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const { data: organization } = await input.database
    .from("organizations")
    .select("phone")
    .eq("id", input.organizationId)
    .maybeSingle();
  const from = toE164(String(organization?.phone ?? ""));

  const decision = websiteCallDecision({
    duplicate: false,
    contactMethod: input.contactMethod,
    callingConfigured: Boolean(
      isTwilioConfigured() && isMcpConfigured() && origin && from && input.to,
    ),
  });
  if (!decision.call) return false;

  const placed = await placeCall({
    to: input.to,
    from,
    twimlUrl: `${origin}/api/twilio/website-callback?request=${encodeURIComponent(input.requestId)}`,
    statusCallbackUrl: `${origin}/api/twilio/website-callback/status`,
    machineDetectionCallbackUrl: `${origin}/api/twilio/website-callback/amd?request=${encodeURIComponent(input.requestId)}`,
  });
  if (!placed.ok) {
    console.error("website call back was not placed", { requestId: input.requestId, error: placed.errorCode });
    return false;
  }

  await input.database
    .from("booking_requests")
    .update({
      callback_call_sid: placed.callSid,
      callback_called_at: new Date().toISOString(),
      callback_outcome: "calling",
    })
    .eq("id", input.requestId);
  return true;
}
