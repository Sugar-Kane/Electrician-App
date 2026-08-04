import Anthropic from "@anthropic-ai/sdk";

import {
  buildReceptionistSystemPrompt,
  getBusinessProfileForNumber,
  getConversationHistory,
  isLeadUrgency,
  normalizePhone,
  recordLead,
  recordMessage,
  upsertConversation,
  type CapturedLead,
} from "@/lib/ai-receptionist";
import { publicWebhookUrl, verifyTwilioSignature } from "@/lib/twilio-signature";

/**
 * Inbound SMS from Twilio.
 *
 * Twilio posts form-encoded, expects TwiML back, and retries on a non-2xx. The
 * reply is returned in the TwiML response rather than sent through the REST API
 * so a single request does the whole round trip.
 */

// The reply and the lead come out of one model call: a second extraction pass
// would double the latency on a channel where the person is watching for typing
// dots, and would re-read the same conversation to learn the same facts.
const replySchema = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "The text message to send back. One or two short sentences.",
    },
    lead_ready: {
      type: "boolean",
      description:
        "True once you have enough to hand this to the owner: at minimum a service address and what they need. False while still gathering.",
    },
    contact_name: { type: ["string", "null"], description: "Their name if they gave it." },
    service_address: { type: ["string", "null"], description: "Street address the work is at." },
    job_type: { type: ["string", "null"], description: "Short label, e.g. 'panel upgrade', 'outlet not working'." },
    urgency: {
      type: "string",
      enum: ["emergency", "urgent", "routine", "unknown"],
      description: "emergency = burning smell, smoke, sparking, no power to the home.",
    },
    summary: {
      type: "string",
      description: "What they need, in their own terms. Empty string while still gathering.",
    },
    preferred_times: { type: ["string", "null"], description: "When they said they are available." },
  },
  required: ["reply", "lead_ready", "contact_name", "service_address", "job_type", "urgency", "summary", "preferred_times"],
  additionalProperties: false,
} as const;

type ReceptionistReply = {
  reply: string;
  lead_ready: boolean;
  contact_name: string | null;
  service_address: string | null;
  job_type: string | null;
  urgency: string;
  summary: string;
  preferred_times: string | null;
};

function twiml(body: string | null) {
  const escaped = body
    ? body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    : null;
  const xml = escaped
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const url = publicWebhookUrl("/api/sms/inbound");
  if (!authToken || !url || !process.env.SUPABASE_SECRET_KEY) {
    console.error("Inbound SMS rejected: TWILIO_AUTH_TOKEN, PUBLIC_BASE_URL, or SUPABASE_SECRET_KEY is not configured.");
    return new Response("Not configured", { status: 503 });
  }

  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });

  if (!verifyTwilioSignature({ authToken, signature: request.headers.get("x-twilio-signature"), url, params })) {
    return new Response("Invalid signature", { status: 403 });
  }

  const fromNumber = normalizePhone(params.From);
  const toNumber = params.To;
  const body = (params.Body ?? "").trim();
  if (!fromNumber || !toNumber || !body) return twiml(null);

  let profile: Awaited<ReturnType<typeof getBusinessProfileForNumber>>;
  let conversationId: string;
  let history: Awaited<ReturnType<typeof getConversationHistory>>;
  try {
    profile = await getBusinessProfileForNumber(toNumber);
    if (!profile) {
      console.error(`Inbound SMS to unrecognized number ${toNumber}`);
      return twiml(null);
    }

    conversationId = await upsertConversation({
      organizationId: profile.organizationId,
      contactPhone: fromNumber,
      channel: "sms",
    });

    await recordMessage({
      organizationId: profile.organizationId,
      conversationId,
      channel: "sms",
      role: "contact",
      body,
      providerMessageId: params.MessageSid ?? null,
    });

    history = await getConversationHistory(conversationId);
  } catch (error) {
    // Storage is down. Return a retryable status rather than an empty TwiML
    // success, so Twilio redelivers instead of silently dropping the message.
    console.error("Inbound SMS could not be stored", error);
    return new Response("Storage unavailable", { status: 503 });
  }

  const client = new Anthropic();
  let parsed: ReceptionistReply;
  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      system: buildReceptionistSystemPrompt(profile, "sms"),
      // Low effort: a text reply is a short, well-specified turn, and the
      // person is watching their phone. Thinking stays on at the model default.
      output_config: { effort: "low", format: { type: "json_schema", schema: replySchema } },
      messages: history.map((message) => ({
        role: message.role === "contact" ? ("user" as const) : ("assistant" as const),
        content: message.body,
      })),
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (response.stop_reason === "refusal" || !textBlock || textBlock.type !== "text") {
      throw new Error(`No usable reply (stop_reason: ${response.stop_reason})`);
    }
    parsed = JSON.parse(textBlock.text) as ReceptionistReply;
  } catch (error) {
    console.error("Receptionist reply failed", error);
    // Never leave a prospect on read. A plain acknowledgement keeps the thread
    // alive and the inbound message is already saved for the owner to answer.
    const fallback = `Thanks for reaching out to ${profile.businessName}. We got your message and ${profile.ownerFirstName} will get back to you shortly.`;
    await recordMessage({
      organizationId: profile.organizationId,
      conversationId,
      channel: "sms",
      role: "assistant",
      body: fallback,
    });
    return twiml(fallback);
  }

  await recordMessage({
    organizationId: profile.organizationId,
    conversationId,
    channel: "sms",
    role: "assistant",
    body: parsed.reply,
  });

  if (parsed.contact_name) {
    await upsertConversation({
      organizationId: profile.organizationId,
      contactPhone: fromNumber,
      contactName: parsed.contact_name,
      channel: "sms",
    });
  }

  if (parsed.lead_ready && parsed.summary.trim()) {
    const lead: CapturedLead = {
      contactName: parsed.contact_name,
      contactPhone: fromNumber,
      contactEmail: null,
      serviceAddress: parsed.service_address,
      jobType: parsed.job_type,
      urgency: isLeadUrgency(parsed.urgency) ? parsed.urgency : "unknown",
      summary: parsed.summary,
      preferredTimes: parsed.preferred_times,
    };
    try {
      await recordLead({
        organizationId: profile.organizationId,
        conversationId,
        channel: "sms",
        lead,
      });
    } catch (error) {
      // The reply still goes out — a failed lead insert must not cost the reply.
      console.error("Lead capture failed", error);
    }
  }

  return twiml(parsed.reply);
}
