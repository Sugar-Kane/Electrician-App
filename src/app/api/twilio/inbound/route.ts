import { NextResponse } from "next/server";

import { phoneMatches } from "@/lib/messaging-rules";
import { handleInboundText } from "@/lib/sms-intake-runner";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isTwilioConfigured, twilioWebhookUrls, verifyTwilioSignature } from "@/lib/twilio";

/**
 * Inbound messages from Twilio.
 *
 * Runs with no session, so it uses the service-role client and scopes every
 * write itself by resolving the tenant from the Messaging Service the message
 * arrived on. The signature check above is what makes that safe: without it,
 * anyone posting here could opt another business's customer out, or write
 * messages into their threads.
 *
 * Replies with empty TwiML. Twilio's Advanced Opt-Out sends the STOP/START/HELP
 * auto-responses at the Messaging Service level, and duplicating them here
 * would send two.
 */

const OPT_OUT_KEYWORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const OPT_IN_KEYWORDS = new Set(["start", "unstop", "yes"]);

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export async function POST(request: Request) {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = typeof value === "string" ? value : "";
  });

  if (
    !verifyTwilioSignature({
      signature: request.headers.get("x-twilio-signature"),
      url: twilioWebhookUrls(request),
      params,
    })
  ) {
    return new NextResponse(
      isTwilioConfigured() ? "Invalid signature" : "TWILIO_AUTH_TOKEN is not set on this deployment",
      { status: 403 },
    );
  }

  const from = params.From ?? "";
  const body = (params.Body ?? "").trim();
  const providerMessageId = params.MessageSid ?? "";
  const messagingServiceSid = params.MessagingServiceSid ?? "";

  if (!from || !messagingServiceSid) {
    return new NextResponse(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
  }

  const database = getSupabaseAdmin();

  const { data: settings } = await database
    .from("messaging_settings")
    .select("organization_id")
    .eq("messaging_service_sid", messagingServiceSid)
    .maybeSingle();

  const organizationId = settings?.organization_id ? String(settings.organization_id) : null;
  if (!organizationId) {
    return new NextResponse(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
  }

  // Customer phones are stored as entered, so match on the last ten digits
  // rather than on string equality with an E.164 number. Fine at one tenant's
  // scale; if customer counts grow this wants a normalized column and an index.
  const { data: customers } = await database
    .from("customers")
    .select("id, phone")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .limit(5000);

  const customer = (customers ?? []).find((row) =>
    phoneMatches(String(row.phone ?? ""), from),
  );

  // A number nobody has seen before is the most valuable message the business
  // gets — someone asking for work. This used to be dropped on the floor.
  // A STOP from a stranger is not worth a customer record; anything else is.
  const keyword = body.toLowerCase().replace(/[^a-z]/g, "");
  const now = new Date().toISOString();
  let customerId = customer ? String(customer.id) : "";

  if (!customerId) {
    if (OPT_OUT_KEYWORDS.has(keyword) || body.length === 0) {
      return new NextResponse(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
    }

    const { data: lead } = await database
      .from("customers")
      .insert({
        organization_id: organizationId,
        customer_type: "residential",
        // Named by the number until they tell us who they are; the intake
        // fills the real name in as soon as the customer gives it.
        first_name: "Text",
        last_name: from.replace(/\D/g, "").slice(-4) || null,
        phone: from,
        preferred_contact: "sms",
        notes: "Created from an inbound text message.",
      })
      .select("id")
      .single();

    if (!lead) {
      return new NextResponse(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
    }
    customerId = String(lead.id);

    // They started the conversation, which is the opt-in — recorded with their
    // own words as the proof, the same evidence the START keyword path keeps.
    await database.from("messaging_consent").upsert(
      {
        organization_id: organizationId,
        customer_id: customerId,
        channel: "sms",
        scope: "transactional",
        opted_in_at: now,
        opted_out_at: null,
        source: "inbound_text",
        proof_text: `Customer texted the business first: "${body.slice(0, 120)}"`,
      },
      { onConflict: "customer_id,channel,scope" },
    );
  }

  // Consent first: a STOP has to land even if everything below fails. These are
  // the only writes here whose failure is reported back to Twilio, because a
  // 200 tells Twilio never to retry — and a dropped STOP means continuing to
  // text someone who asked us not to.
  if (OPT_OUT_KEYWORDS.has(keyword)) {
    const { error } = await database
      .from("messaging_consent")
      .update({ opted_out_at: now })
      .eq("organization_id", organizationId)
      .eq("customer_id", customerId)
      .eq("channel", "sms")
      .eq("scope", "transactional");

    if (error) return new NextResponse("Could not record opt-out", { status: 500 });
  } else if (OPT_IN_KEYWORDS.has(keyword)) {
    const { error } = await database
      .from("messaging_consent")
      .upsert(
        {
          organization_id: organizationId,
          customer_id: customerId,
          channel: "sms",
          scope: "transactional",
          opted_in_at: now,
          opted_out_at: null,
          source: "inbound_text",
          proof_text: `Customer texted "${body.slice(0, 40)}" to opt in.`,
        },
        { onConflict: "customer_id,channel,scope" },
      );

    if (error) return new NextResponse("Could not record opt-in", { status: 500 });
  }

  let { data: conversation } = await database
    .from("conversations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .eq("channel", "sms")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conversation) {
    const { data: created } = await database
      .from("conversations")
      .insert({
        organization_id: organizationId,
        customer_id: customerId,
        channel: "sms",
        status: "open",
        last_message_at: now,
      })
      .select("id")
      .single();
    conversation = created ?? null;
  }

  if (!conversation) {
    return new NextResponse(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
  }

  const conversationId = String(conversation.id);

  if (body.length > 0) {
    await database.from("messages").insert({
      organization_id: organizationId,
      conversation_id: conversationId,
      direction: "inbound",
      body: body.slice(0, 1600),
      status: "received",
      provider_message_id: providerMessageId || null,
    });
  }

  await database
    .from("conversations")
    .update({
      last_message_at: now,
      // A STOP is not a conversation to reply to; anything else needs a human
      // until the intake below decides otherwise.
      status: OPT_OUT_KEYWORDS.has(keyword) ? "closed" : "needs_human",
    })
    .eq("id", conversationId);

  // Read what they asked for and answer it. Deliberately last: the message,
  // the consent, and the conversation are already durable, so a model or
  // carrier failure here costs a reply, never the record of the text.
  if (body.length > 0 && !OPT_OUT_KEYWORDS.has(keyword) && !OPT_IN_KEYWORDS.has(keyword)) {
    await handleInboundText({
      organizationId,
      conversationId,
      customerId,
      phone: from,
      body,
    });
  }

  return new NextResponse(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}
