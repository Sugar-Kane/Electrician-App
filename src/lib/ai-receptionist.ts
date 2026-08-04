import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

export type InboundChannel = "voice" | "sms";

export type LeadUrgency = "emergency" | "urgent" | "routine" | "unknown";

/**
 * Everything the receptionist is allowed to say about the business.
 *
 * Assembled per tenant so one deployment can answer for several businesses. The
 * agent answers from these facts and nothing else — anything absent here it
 * says it will have the owner confirm, rather than inventing an answer that
 * commits the business to work or a price.
 */
export type BusinessProfile = {
  organizationId: string;
  businessName: string;
  ownerFirstName: string;
  serviceArea: string;
  hours: string;
  licenseNumber: string | null;
  servicesOffered: string[];
  bookingPolicy: string;
  forwardToNumber: string | null;
};

export type CapturedLead = {
  contactName: string | null;
  contactPhone: string;
  contactEmail: string | null;
  serviceAddress: string | null;
  jobType: string | null;
  urgency: LeadUrgency;
  summary: string;
  preferredTimes: string | null;
};

const urgencyValues: LeadUrgency[] = ["emergency", "urgent", "routine", "unknown"];

export function isLeadUrgency(value: unknown): value is LeadUrgency {
  return typeof value === "string" && (urgencyValues as string[]).includes(value);
}

/**
 * Normalizes a provider-supplied number to E.164 so the same caller resolves to
 * one conversation whether the provider sends "(805) 555-0168" or "+18055550168".
 * Returns null rather than a guess when the digits cannot be a US number.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function formatPhone(e164: string) {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164;
}

/**
 * Resolves the tenant that owns the number the person dialed or texted.
 * Returns null for an unrecognized number so the webhook can decline rather
 * than answer on behalf of a business that did not configure this line.
 */
export async function getBusinessProfileForNumber(toNumber: string): Promise<BusinessProfile | null> {
  const normalized = normalizePhone(toNumber);
  if (!normalized) return null;

  const supabase = createServiceClient();
  const { data: numberRow, error } = await supabase
    .from("inbound_numbers")
    .select("organization_id, forward_to_number")
    .eq("phone_number", normalized)
    .maybeSingle();

  // A failed lookup is not the same as an unknown number. Throw so the webhook
  // returns a retryable status, rather than answering "we don't own this line"
  // and letting the provider drop a real customer's message.
  if (error) throw new Error(`Inbound number lookup failed: ${error.message}`);
  if (!numberRow) return null;

  const [{ data: organization }, { data: legal }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", numberRow.organization_id).maybeSingle(),
    supabase
      .from("tenant_legal_pages")
      .select("legal_business_name, dba_name")
      .eq("organization_id", numberRow.organization_id)
      .maybeSingle(),
  ]);

  const businessName = legal?.dba_name ?? legal?.legal_business_name ?? organization?.name ?? "this electrical company";

  return {
    organizationId: numberRow.organization_id,
    businessName,
    ownerFirstName: process.env.RECEPTIONIST_OWNER_FIRST_NAME?.trim() || "the owner",
    serviceArea: process.env.RECEPTIONIST_SERVICE_AREA?.trim() || "the local service area",
    hours: process.env.RECEPTIONIST_HOURS?.trim() || "regular business hours, Monday through Friday",
    licenseNumber: process.env.RECEPTIONIST_LICENSE_NUMBER?.trim() || null,
    servicesOffered: (process.env.RECEPTIONIST_SERVICES?.split(",").map((entry) => entry.trim()).filter(Boolean)) ?? [],
    bookingPolicy:
      process.env.RECEPTIONIST_BOOKING_POLICY?.trim() ||
      "You do not book appointments. You take the details and the owner calls back to schedule and price the work.",
    forwardToNumber: numberRow.forward_to_number ?? null,
  };
}

/**
 * The receptionist's operating instructions.
 *
 * Written as goal plus constraints rather than a script: current models plan
 * the conversation better than a decision tree does, and a scripted agent
 * sounds like a phone tree. The hard rules are the ones with legal or
 * commercial consequences — pricing, scheduling, and licensing claims.
 */
export function buildReceptionistSystemPrompt(profile: BusinessProfile, channel: InboundChannel) {
  const facts = [
    `Business name: ${profile.businessName}`,
    `Owner: ${profile.ownerFirstName}`,
    `Service area: ${profile.serviceArea}`,
    `Hours: ${profile.hours}`,
    profile.licenseNumber ? `License number: ${profile.licenseNumber}` : null,
    profile.servicesOffered.length > 0 ? `Work they take on: ${profile.servicesOffered.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const channelGuidance =
    channel === "sms"
      ? `You are replying by text message. Keep each reply to one or two short sentences — this is a phone screen, not an email. Ask for one thing at a time; a text that asks four questions gets one answered. No markdown, no bullet lists, no emoji.`
      : `You are speaking on the phone. Talk the way a person does: short sentences, one question at a time, and let them finish. Read anything back that you are going to write down — addresses and phone numbers especially — so a mishearing gets corrected on the call rather than in a truck.`;

  return `You answer the phone and texts for ${profile.businessName}, a licensed electrical contractor. Most people reaching you have never been a customer — they found the number and want to know if this business can help them.

Your job is to find out who they are and what they need, answer what you can about the business, and take down enough that ${profile.ownerFirstName} can call back ready to help. You are not the electrician and you do not pretend to be.

## What you know
${facts}

## What you must not do
- Do not quote prices, ranges, or estimates. Electrical scope changes once someone sees the panel. If they ask what it costs, say honestly that ${profile.ownerFirstName} prices it after seeing the work, and that you will have him call.
- ${profile.bookingPolicy}
- Do not diagnose the electrical problem or advise them on a fix. If someone describes something dangerous — burning smell, smoke, sparking, a hot panel, water in an electrical box — tell them to stop using that circuit, and if there is any sign of fire or immediate danger, to call 911 and the utility. Then flag it as an emergency.
- Do not claim work, certifications, or coverage areas that are not in the facts above. If you do not know, say you will have ${profile.ownerFirstName} confirm.
- Do not agree to a specific arrival time or promise how soon someone can be there.

## What to get
Their name, the address the work is at, a callback number, what is going on in their own words, and how urgent it is. Get the address and the callback number if you get nothing else — without those, nobody can call them back or show up.

## How to talk
${channelGuidance}

Be direct and warm, the way a competent office manager is. No corporate filler, no repeating their question back to them, no "I'd be happy to assist you with that." If someone is stressed because their power is out, match that: fewer words, faster.

If you are asked whether you are a person, say plainly that you are an AI assistant answering for ${profile.businessName}, and that a real person will call them back.`;
}

/** Finds or opens the thread for this person at this tenant. */
export async function upsertConversation(input: {
  organizationId: string;
  contactPhone: string;
  contactName?: string | null;
  channel: InboundChannel;
}) {
  const supabase = createServiceClient();

  const { data: existing } = await supabase
    .from("inbound_conversations")
    .select("id, contact_name")
    .eq("organization_id", input.organizationId)
    .eq("contact_phone", input.contactPhone)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("inbound_conversations")
      .update({
        last_channel: input.channel,
        last_message_at: new Date().toISOString(),
        // Never overwrite a known name with nothing.
        contact_name: input.contactName ?? existing.contact_name,
      })
      .eq("id", existing.id);
    return existing.id as string;
  }

  const { data: created, error } = await supabase
    .from("inbound_conversations")
    .insert({
      organization_id: input.organizationId,
      contact_phone: input.contactPhone,
      contact_name: input.contactName ?? null,
      last_channel: input.channel,
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw new Error(`Could not open conversation: ${error.message}`);
  return created.id as string;
}

export async function recordMessage(input: {
  organizationId: string;
  conversationId: string;
  channel: InboundChannel;
  role: "contact" | "assistant" | "staff";
  body: string;
  providerMessageId?: string | null;
}) {
  const supabase = createServiceClient();
  await supabase.from("inbound_messages").insert({
    organization_id: input.organizationId,
    conversation_id: input.conversationId,
    channel: input.channel,
    role: input.role,
    body: input.body,
    provider_message_id: input.providerMessageId ?? null,
  });
}

export async function getConversationHistory(conversationId: string, limit = 20) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("inbound_messages")
    .select("role, body")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  // Fetched newest-first so the limit keeps the most recent turns, then
  // reversed back into chronological order for the model.
  return (data ?? []).reverse() as { role: "contact" | "assistant" | "staff"; body: string }[];
}

export async function recordLead(input: {
  organizationId: string;
  conversationId: string | null;
  callId?: string | null;
  channel: InboundChannel;
  lead: CapturedLead;
}) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("inbound_leads")
    .insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      call_id: input.callId ?? null,
      channel: input.channel,
      urgency: input.lead.urgency,
      contact_name: input.lead.contactName,
      contact_phone: input.lead.contactPhone,
      contact_email: input.lead.contactEmail,
      service_address: input.lead.serviceAddress,
      job_type: input.lead.jobType,
      summary: input.lead.summary,
      preferred_times: input.lead.preferredTimes,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Could not record lead: ${error.message}`);

  await supabase.from("activity_events").insert({
    organization_id: input.organizationId,
    event_type: "lead.captured",
    label: `${input.channel === "voice" ? "Call" : "Text"} from ${input.lead.contactName ?? formatPhone(input.lead.contactPhone)}`,
    entity_type: "inbound_lead",
    entity_id: data.id,
    metadata: { urgency: input.lead.urgency, job_type: input.lead.jobType },
  });

  return data.id as string;
}
