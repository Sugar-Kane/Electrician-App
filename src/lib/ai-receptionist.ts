import "server-only";

import { buildEmergencyAlert, sendOwnerAlert } from "@/lib/notify-owner";
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
  ownerFullName: string | null;
  ownerFirstName: string;
  /** Null fields are answered with "I'll have the owner confirm", never a guess. */
  serviceArea: string | null;
  hours: string | null;
  licenseNumber: string | null;
  servicesDescription: string | null;
  bookingPolicy: string;
  /** The tenant's own number — the "from" on any outbound alert. */
  inboundNumber: string;
  /** Where an emergency pages: this line's forward number, else the org default. */
  escalationPhone: string | null;
  /** True when the voice platform is configured to record calls. */
  recordsCalls: boolean;
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

  const [{ data: organization }, { data: legal }, { data: settings }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", numberRow.organization_id).maybeSingle(),
    supabase
      .from("tenant_legal_pages")
      .select("legal_business_name, dba_name")
      .eq("organization_id", numberRow.organization_id)
      .maybeSingle(),
    supabase
      .from("service_settings")
      .select(
        "receptionist_owner_name, receptionist_service_area, receptionist_hours, receptionist_license_number, receptionist_services, receptionist_records_calls, receptionist_escalation_phone",
      )
      .eq("organization_id", numberRow.organization_id)
      .maybeSingle(),
  ]);

  const businessName = legal?.dba_name ?? legal?.legal_business_name ?? organization?.name ?? "this electrical company";
  const ownerFullName = settings?.receptionist_owner_name?.trim() || null;

  return {
    organizationId: numberRow.organization_id,
    businessName,
    ownerFullName,
    ownerFirstName: ownerFullName?.split(/\s+/)[0] ?? "the owner",
    serviceArea: settings?.receptionist_service_area?.trim() || null,
    hours: settings?.receptionist_hours?.trim() || null,
    licenseNumber: settings?.receptionist_license_number?.trim() || null,
    servicesDescription: settings?.receptionist_services?.trim() || null,
    bookingPolicy:
      "You do not book appointments. You take the details and the owner calls back to schedule and price the work.",
    inboundNumber: normalized,
    // A line-level forward wins; the org default keeps paging working before
    // anyone configures a per-line override.
    escalationPhone:
      normalizePhone(numberRow.forward_to_number) ?? normalizePhone(settings?.receptionist_escalation_phone) ?? null,
    recordsCalls: settings?.receptionist_records_calls === true,
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
    `Owner: ${profile.ownerFullName ?? "the owner"}`,
    profile.serviceArea ? `Service area: ${profile.serviceArea}` : null,
    profile.hours ? `Hours: ${profile.hours}` : null,
    profile.licenseNumber ? `License number: ${profile.licenseNumber}` : null,
    profile.servicesDescription ? `Work they take on: ${profile.servicesDescription}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Each unknown gets an explicit instruction. Without one the model fills the
  // gap from general knowledge of what an electrical company is like, which is
  // exactly the invented answer that gets a business into trouble.
  const unknowns = [
    profile.serviceArea
      ? null
      : `You have not been told the service area. If someone asks whether you cover their town, take their address and say ${profile.ownerFirstName} will confirm — do not guess a boundary.`,
    profile.hours
      ? null
      : `You have not been told the business hours. If asked, say ${profile.ownerFirstName} will confirm rather than naming times.`,
    profile.licenseNumber
      ? null
      : `You do not have the license number. If asked whether the business is licensed, or for the license number, say you do not have the license details in front of you and ${profile.ownerFirstName} will provide them directly. Do not state a number, and do not claim or deny that the business is licensed — in California the license number belongs in that answer, and guessing at it is not something you can undo.`,
  ]
    .filter(Boolean)
    .join("\n");

  const channelGuidance =
    channel === "sms"
      ? `You are replying by text message. Keep each reply to one or two short sentences — this is a phone screen, not an email. Ask for one thing at a time; a text that asks four questions gets one answered. No markdown, no bullet lists, no emoji.`
      : `You are speaking on the phone. Talk the way a person does: short sentences, one question at a time, and let them finish. Read anything back that you are going to write down — addresses and phone numbers especially — so a mishearing gets corrected on the call rather than in a truck.`;

  // California is a two-party consent state: every party must be told before
  // recording starts, not after. This has to be the first thing said, before
  // any greeting that invites the caller to start talking.
  const recordingDisclosure =
    channel === "voice" && profile.recordsCalls
      ? `\n\n## Before anything else\nThis call is recorded. Your very first sentence must say so — "This call is recorded for quality" — before you ask them anything or invite them to speak. If they object to being recorded, tell them you will have ${profile.ownerFirstName} call them back directly instead, take a callback number, and end the call politely. Do not keep them talking on a recorded line after they have objected.`
      : "";

  return `You answer the phone and texts for ${profile.businessName}, a licensed electrical contractor. Most people reaching you have never been a customer — they found the number and want to know if this business can help them.

Your job is to find out who they are and what they need, answer what you can about the business, and take down enough that ${profile.ownerFirstName} can call back ready to help. You are not the electrician and you do not pretend to be.

## What you know
${facts}
${unknowns ? `\n## What you have not been told\n${unknowns}\n` : ""}${recordingDisclosure}

## What you must not do
- Do not quote prices, ranges, or estimates. Electrical scope changes once someone sees the panel. If they ask what it costs, say honestly that ${profile.ownerFirstName} prices it after seeing the work, and that you will have him call.
- ${profile.bookingPolicy}
- Do not diagnose the electrical problem or advise them on a fix. If someone describes something dangerous — burning smell, smoke, sparking, a hot panel, water in an electrical box — tell them to stop using that circuit, and if there is any sign of fire or immediate danger, to call 911 and the utility. Then flag it as an emergency.
- Do not claim work, certifications, or coverage areas beyond the facts above. If you do not know, say you will have ${profile.ownerFirstName} confirm.
- Do not screen callers out. Deciding a job is too small, too large, or the wrong kind is ${profile.ownerFirstName}'s call, not yours — take the details either way.
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
  profile: BusinessProfile;
  conversationId: string | null;
  callId?: string | null;
  channel: InboundChannel;
  lead: CapturedLead;
}) {
  const organizationId = input.profile.organizationId;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("inbound_leads")
    .insert({
      organization_id: organizationId,
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
    organization_id: organizationId,
    event_type: "lead.captured",
    label: `${input.channel === "voice" ? "Call" : "Text"} from ${input.lead.contactName ?? formatPhone(input.lead.contactPhone)}`,
    entity_type: "inbound_lead",
    entity_id: data.id,
    metadata: { urgency: input.lead.urgency, job_type: input.lead.jobType },
  });

  if (input.lead.urgency === "emergency") {
    await escalateEmergency(input.profile, input.lead, data.id as string);
  }

  return data.id as string;
}

/**
 * Pushes an emergency lead to the owner's phone.
 *
 * Deliberately never throws: the lead is already saved, and a caller reporting
 * a burning smell must not get an error because an SMS gateway was down. A
 * failed page is recorded as its own activity event so the gap is visible
 * afterwards rather than silent.
 */
async function escalateEmergency(profile: BusinessProfile, lead: CapturedLead, leadId: string) {
  const supabase = createServiceClient();

  if (!profile.escalationPhone) {
    await supabase.from("activity_events").insert({
      organization_id: profile.organizationId,
      event_type: "lead.escalation_skipped",
      label: "Emergency lead not paged — no escalation number is configured",
      entity_type: "inbound_lead",
      entity_id: leadId,
      metadata: {},
    });
    return;
  }

  const { ok, error } = await sendOwnerAlert({
    fromNumber: profile.inboundNumber,
    toNumber: profile.escalationPhone,
    body: buildEmergencyAlert({
      businessName: profile.businessName,
      contactName: lead.contactName,
      contactPhone: lead.contactPhone,
      serviceAddress: lead.serviceAddress,
      summary: lead.summary,
    }),
  });

  await supabase.from("activity_events").insert({
    organization_id: profile.organizationId,
    event_type: ok ? "lead.escalated" : "lead.escalation_failed",
    label: ok
      ? `Emergency lead paged to ${formatPhone(profile.escalationPhone)}`
      : `Emergency page failed: ${error ?? "unknown error"}`,
    entity_type: "inbound_lead",
    entity_id: leadId,
    metadata: {},
  });
}
