import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyTwilioSignature } from "@/lib/twilio";

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

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function requestUrl(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (configured) return `${configured}/api/twilio/inbound`;
  return request.url;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = typeof value === "string" ? value : "";
  });

  if (
    !verifyTwilioSignature({
      signature: request.headers.get("x-twilio-signature"),
      url: requestUrl(request),
      params,
    })
  ) {
    return new NextResponse("Invalid signature", { status: 403 });
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

  const fromDigits = digits(from).slice(-10);
  const customer = (customers ?? []).find(
    (row) => digits(String(row.phone ?? "")).slice(-10) === fromDigits,
  );

  if (!customer) {
    return new NextResponse(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
  }

  const customerId = String(customer.id);
  const keyword = body.toLowerCase().replace(/[^a-z]/g, "");
  const now = new Date().toISOString();

  // Consent first: a STOP has to land even if everything below fails.
  if (OPT_OUT_KEYWORDS.has(keyword)) {
    await database
      .from("messaging_consent")
      .update({ opted_out_at: now })
      .eq("organization_id", organizationId)
      .eq("customer_id", customerId)
      .eq("channel", "sms")
      .eq("scope", "transactional");
  } else if (OPT_IN_KEYWORDS.has(keyword)) {
    await database
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
      // A STOP is not a conversation to reply to; anything else needs a human.
      status: OPT_OUT_KEYWORDS.has(keyword) ? "closed" : "needs_human",
    })
    .eq("id", conversationId);

  return new NextResponse(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}
