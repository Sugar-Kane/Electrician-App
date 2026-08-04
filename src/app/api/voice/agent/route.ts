import {
  getBusinessProfileForNumber,
  isLeadUrgency,
  normalizePhone,
  recordLead,
  recordMessage,
  upsertConversation,
  type BusinessProfile,
} from "@/lib/ai-receptionist";
import { createServiceClient } from "@/lib/supabase/service";
import { secretMatches } from "@/lib/twilio-signature";

/**
 * Server webhook for the managed voice agent (Vapi / Retell).
 *
 * The platform runs the speech loop; this endpoint is what its agent calls to
 * reach the business. Two things arrive here:
 *
 *   - `tool-calls`  — the agent invoking a tool mid-conversation. Answer fast;
 *                     the caller is sitting in silence waiting for the reply.
 *   - `end-of-call-report` — the transcript, summary, and outcome once the call
 *                     ends. Fired after the caller has hung up, so latency here
 *                     is free.
 *
 * Verified with a shared secret the platform sends on every request. Without a
 * configured secret the route refuses to serve rather than answering unsigned
 * callers.
 */

type ToolCall = { id?: string; function?: { name?: string; arguments?: unknown } };

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Answers "do you cover my area?" without the agent inventing a boundary.
 * Deliberately non-committal on distance — the profile's stated service area is
 * the only claim the business has authorized.
 */
function describeServiceArea(profile: BusinessProfile, askedAbout: string | null) {
  const scope = `${profile.businessName} covers ${profile.serviceArea}.`;
  return askedAbout
    ? `${scope} If ${askedAbout} is outside that, say you will have ${profile.ownerFirstName} confirm whether he can get out there rather than promising either way.`
    : scope;
}

async function handleToolCalls(profile: BusinessProfile, context: { callId: string | null; callerPhone: string | null }, toolCalls: ToolCall[]) {
  const results = [];

  for (const call of toolCalls) {
    const name = call.function?.name;
    const args = parseArguments(call.function?.arguments);
    let result: string;

    switch (name) {
      case "business_info": {
        const topic = stringOrNull(args.topic);
        result = [
          `Business: ${profile.businessName}`,
          `Owner: ${profile.ownerFirstName}`,
          `Service area: ${profile.serviceArea}`,
          `Hours: ${profile.hours}`,
          profile.licenseNumber ? `License: ${profile.licenseNumber}` : null,
          profile.servicesOffered.length > 0 ? `Work taken on: ${profile.servicesOffered.join(", ")}` : null,
          topic ? `The caller asked about: ${topic}. If that is not covered above, say you will have ${profile.ownerFirstName} confirm.` : null,
        ]
          .filter(Boolean)
          .join("\n");
        break;
      }

      case "check_service_area": {
        result = describeServiceArea(profile, stringOrNull(args.address) ?? stringOrNull(args.city));
        break;
      }

      case "capture_lead": {
        const contactPhone = normalizePhone(stringOrNull(args.contact_phone)) ?? context.callerPhone;
        const summary = stringOrNull(args.summary);

        if (!contactPhone) {
          result = "Not saved — no callback number yet. Ask the caller for the best number to reach them and try again.";
          break;
        }
        if (!summary) {
          result = "Not saved — no summary yet. Say back what they need in one line and try again.";
          break;
        }

        const contactName = stringOrNull(args.contact_name);
        const conversationId = await upsertConversation({
          organizationId: profile.organizationId,
          contactPhone,
          contactName,
          channel: "voice",
        });

        const urgencyValue = stringOrNull(args.urgency);
        await recordLead({
          organizationId: profile.organizationId,
          conversationId,
          channel: "voice",
          lead: {
            contactName,
            contactPhone,
            contactEmail: stringOrNull(args.contact_email),
            serviceAddress: stringOrNull(args.service_address),
            jobType: stringOrNull(args.job_type),
            urgency: isLeadUrgency(urgencyValue) ? urgencyValue : "unknown",
            summary,
            preferredTimes: stringOrNull(args.preferred_times),
          },
        });

        result = `Saved. ${profile.ownerFirstName} has it. Tell the caller he will follow up, without promising a specific time.`;
        break;
      }

      case "request_callback_transfer": {
        result = profile.forwardToNumber
          ? `Transfer available to ${profile.forwardToNumber}.`
          : `No live transfer is set up on this line. Take a message instead and tell them ${profile.ownerFirstName} will call back.`;
        break;
      }

      default:
        result = `Unknown tool: ${name ?? "(unnamed)"}`;
    }

    results.push({ toolCallId: call.id ?? null, result });
  }

  return jsonResponse({ results });
}

async function handleEndOfCallReport(profile: BusinessProfile, payload: Record<string, unknown>) {
  const call = (payload.call ?? {}) as Record<string, unknown>;
  const customer = (payload.customer ?? call.customer ?? {}) as Record<string, unknown>;
  const providerCallId = stringOrNull(call.id) ?? stringOrNull(payload.callId);
  const callerPhone = normalizePhone(stringOrNull(customer.number));

  if (!providerCallId) return jsonResponse({ received: true });

  const transcript = stringOrNull(payload.transcript);
  const summary = stringOrNull(payload.summary);
  const recordingUrl = stringOrNull(payload.recordingUrl) ?? stringOrNull(payload.stereoRecordingUrl);
  const endedReason = stringOrNull(payload.endedReason);

  const conversationId = callerPhone
    ? await upsertConversation({
        organizationId: profile.organizationId,
        contactPhone: callerPhone,
        channel: "voice",
      })
    : null;

  const supabase = createServiceClient();
  await supabase.from("inbound_calls").upsert(
    {
      organization_id: profile.organizationId,
      conversation_id: conversationId,
      provider: stringOrNull(payload.provider) ?? "vapi",
      provider_call_id: providerCallId,
      from_number: callerPhone ?? "unknown",
      to_number: stringOrNull(call.phoneNumber) ?? "unknown",
      status: "completed",
      started_at: stringOrNull(call.startedAt),
      ended_at: stringOrNull(call.endedAt) ?? new Date().toISOString(),
      duration_seconds: typeof payload.durationSeconds === "number" ? Math.round(payload.durationSeconds) : null,
      ended_reason: endedReason,
      recording_url: recordingUrl,
      transcript,
      summary,
    },
    { onConflict: "provider,provider_call_id" },
  );

  // Keep the call summary in the shared thread so a later text from the same
  // number reads as a continuation rather than a cold open.
  if (conversationId && summary) {
    await recordMessage({
      organizationId: profile.organizationId,
      conversationId,
      channel: "voice",
      role: "assistant",
      body: `[Call summary] ${summary}`,
    });
  }

  return jsonResponse({ received: true });
}

export async function POST(request: Request) {
  const expectedSecret = process.env.VOICE_AGENT_WEBHOOK_SECRET;
  if (!expectedSecret || !process.env.SUPABASE_SECRET_KEY) {
    console.error("Voice webhook rejected: VOICE_AGENT_WEBHOOK_SECRET or SUPABASE_SECRET_KEY is not configured.");
    return new Response("Not configured", { status: 503 });
  }

  const provided = request.headers.get("x-vapi-secret") ?? request.headers.get("x-webhook-secret");
  if (!secretMatches(provided, expectedSecret)) {
    return new Response("Invalid signature", { status: 403 });
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    const envelope = parsed as { message?: Record<string, unknown> };
    payload = envelope?.message ?? (parsed as Record<string, unknown>);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const call = (payload.call ?? {}) as Record<string, unknown>;
  const customer = (payload.customer ?? call.customer ?? {}) as Record<string, unknown>;

  // Which of the business's numbers was dialed decides which tenant answers.
  const dialedNumber =
    stringOrNull(payload.phoneNumber) ??
    stringOrNull(call.phoneNumber) ??
    stringOrNull((call.phoneNumber as Record<string, unknown> | undefined)?.number) ??
    process.env.RECEPTIONIST_DEFAULT_NUMBER ??
    null;

  if (!dialedNumber) {
    console.error("Voice webhook: could not determine which number was dialed.");
    return new Response("Unknown destination", { status: 400 });
  }

  const type = stringOrNull(payload.type);

  try {
    const profile = await getBusinessProfileForNumber(dialedNumber);
    if (!profile) {
      console.error(`Voice webhook for unrecognized number ${dialedNumber}`);
      return new Response("Unknown destination", { status: 404 });
    }

    if (type === "tool-calls") {
      const toolCalls = (payload.toolCallList ?? payload.toolCalls ?? []) as ToolCall[];
      return await handleToolCalls(
        profile,
        { callId: stringOrNull(call.id), callerPhone: normalizePhone(stringOrNull(customer.number)) },
        toolCalls,
      );
    }

    if (type === "end-of-call-report") {
      return await handleEndOfCallReport(profile, payload);
    }
  } catch (error) {
    console.error(`Voice webhook failed handling ${type}`, error);
    // Mid-call, the caller is sitting in silence: hand the agent a line it can
    // say rather than a status code it would wait out and retry.
    if (type === "tool-calls") {
      return jsonResponse({
        results: [{ toolCallId: null, result: "That did not save. Take the details down and tell the caller someone will follow up." }],
      });
    }
    // The end-of-call report has no one waiting, so let the platform retry it.
    return new Response("Temporarily unavailable", { status: 503 });
  }

  // Status updates, speech-update chatter, and anything else the platform emits.
  return jsonResponse({ received: true });
}
