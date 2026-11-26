import { readMessagePhotos } from "@/lib/message-media";
import { NextResponse } from "next/server";

import { OPT_OUT_CONFIRMATION, firstTextOptsIn, phoneMatches, readOptOut } from "@/lib/messaging-rules";
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
 * would send two. The one exception is a customer who asks to stop in their
 * own words ("please stop texting me"): Twilio does not recognise that, so the
 * opt-out is recorded here and a single confirmation goes back in the reply.
 */

const OPT_IN_KEYWORDS = new Set(["start", "unstop", "yes"]);

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const OPT_OUT_TWIML = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${OPT_OUT_CONFIRMATION}</Message></Response>`;

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
  const rawBody = (params.Body ?? "").trim();
  const photos = readMessagePhotos(params);
  const body = rawBody || (photos.length ? `[Customer attached ${photos.length} photo(s) for the electrician.]` : "");
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
  // Any reasonable way of asking to stop, not only the exact keyword (FCC
  // revocation rule, compliance FED-002-005).
  const optOutReading = readOptOut(body);
  const optOut = optOutReading.optOut;
  const replyTwiml = optOutReading.optOut && !optOutReading.carrierHandled ? OPT_OUT_TWIML : EMPTY_TWIML;
  const now = new Date().toISOString();
  let customerId = customer ? String(customer.id) : "";

  if (!customerId) {
    if (optOut || body.length === 0) {
      return new NextResponse(replyTwiml, { headers: { "Content-Type": "text/xml" } });
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
        // Waits for the owner to keep or delete it, so spam never becomes a customer.
        pending_review: true,
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
  if (optOut) {
    // A customer with no consent row on file (added by the business, never
    // asked) who says stop must still be recorded, or the next text would go
    // out: the row is created when the update finds none. The opt-in record
    // (its source and proof) is left as it was.
    const optOutRecord = {
      opted_out_at: now,
      opt_out_source: "inbound_text",
      opt_out_proof: `Customer texted: "${body.slice(0, 160)}"`,
    };
    const updated = await database
      .from("messaging_consent")
      .update(optOutRecord)
      .eq("organization_id", organizationId)
      .eq("customer_id", customerId)
      .eq("channel", "sms")
      .eq("scope", "transactional")
      .select("id");
    let error = updated.error;
    if (!error && (updated.data ?? []).length === 0) {
      ({ error } = await database.from("messaging_consent").upsert(
        { organization_id: organizationId, customer_id: customerId, channel: "sms", scope: "transactional", source: "inbound_text", ...optOutRecord },
        { onConflict: "customer_id,channel,scope" },
      ));
    }

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
  } else if (customer && body.length > 0) {
    // A customer already on file (added by the business, so never asked) who
    // texts first has opted in, exactly as a new number does above. Written
    // only where nothing says otherwise: a STOP stands until START.
    const { data: consent } = await database
      .from("messaging_consent")
      .select("opted_in_at, opted_out_at")
      .eq("organization_id", organizationId)
      .eq("customer_id", customerId)
      .eq("channel", "sms")
      .eq("scope", "transactional")
      .maybeSingle();
    const facts = consent
      ? { optedInAt: consent.opted_in_at ? String(consent.opted_in_at) : null, optedOutAt: consent.opted_out_at ? String(consent.opted_out_at) : null }
      : null;
    if (firstTextOptsIn(facts)) {
      const record = {
        opted_in_at: now,
        source: "inbound_text",
        proof_text: `Customer texted the business first: "${body.slice(0, 120)}"`,
      };
      // Neither write can overwrite an opt-out that lands in between: the
      // insert skips an existing row, and the update needs both dates empty.
      if (consent) {
        await database
          .from("messaging_consent")
          .update(record)
          .eq("organization_id", organizationId)
          .eq("customer_id", customerId)
          .eq("channel", "sms")
          .eq("scope", "transactional")
          .is("opted_in_at", null)
          .is("opted_out_at", null);
      } else {
        await database.from("messaging_consent").upsert(
          { organization_id: organizationId, customer_id: customerId, channel: "sms", scope: "transactional", opted_out_at: null, ...record },
          { onConflict: "customer_id,channel,scope", ignoreDuplicates: true },
        );
      }
    }
  }

  let { data: conversation } = await database
    .from("conversations")
    .select("id, assistant_paused_at")
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
      .select("id, assistant_paused_at")
      .single();
    conversation = created ?? null;
  }

  if (!conversation) {
    return new NextResponse(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
  }

  const conversationId = String(conversation.id);

  let receivedAt = "";
  if (body.length > 0) {
    const { data: saved, error: messageError } = await database
      .from("messages")
      .insert({
        organization_id: organizationId,
        conversation_id: conversationId,
        direction: "inbound",
        body: body.slice(0, 1600),
        status: "received",
        provider_message_id: providerMessageId || null,
        media: photos,
      })
      .select("created_at")
      .single();
    if (messageError) return new NextResponse("Could not save message", { status: 500 });
    receivedAt = saved?.created_at ? String(saved.created_at) : "";
  }

  await database
    .from("conversations")
    .update({
      last_message_at: now,
      // A STOP is not a conversation to reply to; anything else needs a human
      // until the intake below decides otherwise.
      status: optOut ? "closed" : "needs_human",
    })
    .eq("id", conversationId);

  // Read what they asked for and answer it. Deliberately last: the message,
  // the consent, and the conversation are already durable, so a model or
  // carrier failure here costs a reply, never the record of the text.
  // YES also confirms an offered appointment. Preserve its consent update
  // above, but let intake read the conversation and continue the booking.
  // START/UNSTOP remain consent-only commands.
  // Not in a conversation somebody at the business has taken over: their
  // customer's text waits for them, marked as needing a person, above.
  const takenOver = Boolean(conversation.assistant_paused_at);
  if (body.length > 0 && !takenOver && !optOut &&
    (!OPT_IN_KEYWORDS.has(keyword) || keyword === "yes")) {
    await handleInboundText({
      organizationId,
      conversationId,
      customerId,
      phone: from,
      body,
      receivedAt,
    });
  }

  return new NextResponse(replyTwiml, { headers: { "Content-Type": "text/xml" } });
}
