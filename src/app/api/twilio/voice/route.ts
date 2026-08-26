import { NextResponse } from "next/server";

import { holdSpoken } from "@/lib/booking-hold";
import { readInboundText } from "@/lib/claude";
import {
  findOrCreateCustomerByPhone,
  loadIntakeContext,
  organizationForPhoneNumber,
  recordBookingRequest,
  slotLabel,
} from "@/lib/intake-shared";
import { buildIntakeSystemPrompt, decideIntakeAction } from "@/lib/sms-intake";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  isTwilioConfigured,
  twilioPublicOrigin,
  twilioWebhookUrls,
  verifyTwilioSignature,
} from "@/lib/twilio";
import {
  buildGreeting,
  decideVoiceStep,
  hangupTwiml,
  listenTwiml,
  transferTwiml,
  voiceInstructions,
} from "@/lib/voice-intake";

/**
 * The receptionist that answers the phone.
 *
 * Twilio calls this when the business number rings, and again after every
 * sentence the caller speaks. Each request must answer with TwiML in a couple
 * of seconds — a caller hears a delay that a texter never would — so this does
 * the minimum per turn and keeps the transcript in `voice_calls`, addressed by
 * CallSid.
 *
 * Unlike the SMS webhook, a failure here is audible. Every error path ends in
 * speech and a promised call back rather than a dropped line.
 */

function twiml(body: string) {
  return new NextResponse(body, { headers: { "Content-Type": "text/xml" } });
}

function apologise(businessPhone?: string) {
  return twiml(
    hangupTwiml(
      `Sorry, something went wrong on our end. Please call back${businessPhone ? "" : " in a few minutes"}, and we will pick up.`,
    ),
  );
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  const url = new URL(request.url);
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
    // This body is what shows up in Twilio's request inspector, so it says
    // which of the two causes it is rather than leaving someone to guess.
    return new NextResponse(
      isTwilioConfigured()
        ? "Invalid signature"
        : "TWILIO_AUTH_TOKEN is not set on this deployment",
      { status: 403 },
    );
  }

  // Derived from the request, not from configuration: a call already in
  // progress must not be stranded by a mistyped environment variable.
  const callbackOrigin = twilioPublicOrigin(request);
  const callSid = params.CallSid ?? "";
  const from = params.From ?? "";
  const to = params.To ?? "";
  const speech = (params.SpeechResult ?? "").trim();
  const step = url.searchParams.get("step") ?? "";

  if (!callSid || !from || !to) return apologise();

  try {
    const database = getSupabaseAdmin();
    const organizationId = await organizationForPhoneNumber(database, to);
    if (!organizationId) {
      // Nobody owns this number in the app. Better to say so than to leave a
      // customer talking to silence.
      return twiml(hangupTwiml("Sorry, this number is not in service. Goodbye."));
    }

    const { data: existingCall } = await database
      .from("voice_calls")
      .select("id, customer_id, turns, failed_turns")
      .eq("call_sid", callSid)
      .maybeSingle();

    const { context, timeZone } = await loadIntakeContext({
      database,
      organizationId,
      isFirstReply: false,
    });

    // The transfer did not connect: Twilio comes back here with the dial
    // status rather than anything the caller said.
    if (step === "after-dial") {
      const answered = text(params.DialCallStatus) === "completed";
      await database
        .from("voice_calls")
        .update({ status: answered ? "transferred" : "completed", outcome: `dial:${text(params.DialCallStatus)}` })
        .eq("call_sid", callSid);

      if (answered) return twiml(hangupTwiml("Thanks for calling."));

      if (existingCall?.customer_id) {
        await recordBookingRequest({
          database,
          organizationId,
          customerId: String(existingCall.customer_id),
          phone: from,
          // A Twilio voice webhook. The transport is the phone, whoever or
          // whatever held the conversation.
          channel: "phone",
          action: {
            kind: "callback",
            contactName: "",
            description: "Caller asked for a person; the transfer was not answered.",
            urgency: "urgent",
            reply: "",
            // A dial status, not a conversation. Nothing was said here to
            // detect a language from, so the customer's record is left alone.
            language: context.language,
            languageChanged: false,
          },
          callerText: "Caller asked for a person; the transfer was not answered.",
          model: null,
          decision: null,
        });
      }

      return twiml(
        hangupTwiml("Sorry, nobody is free right now. I have noted your number and we will call you back shortly."),
      );
    }

    // First request of the call: greet, and start listening.
    if (!existingCall) {
      const customerId = await findOrCreateCustomerByPhone({
        database,
        organizationId,
        phone: from,
        note: "Created from an inbound phone call.",
      });

      await database.from("voice_calls").insert({
        organization_id: organizationId,
        customer_id: customerId,
        call_sid: callSid,
        from_number: from,
        to_number: to,
        status: "in_progress",
        turns: [],
      });

      return twiml(
        listenTwiml({
          say: buildGreeting(context.businessName),
          actionUrl: `${callbackOrigin}/api/twilio/voice`,
        }),
      );
    }

    const priorTurns = Array.isArray(existingCall.turns)
      ? (existingCall.turns as { role: "user" | "assistant"; text: string }[])
      : [];
    const failedTurns = Number(existingCall.failed_turns ?? 0);

    // Twilio heard nothing usable. Ask once more before giving up on speech.
    if (!speech) {
      const nextFailures = failedTurns + 1;
      await database
        .from("voice_calls")
        .update({ failed_turns: nextFailures })
        .eq("call_sid", callSid);

      const escalationNumber = process.env.ESCALATION_PHONE_NUMBER ?? "";
      if (nextFailures > 2 && escalationNumber) {
        return twiml(
          transferTwiml({
            say: "Let me put you through to the electrician.",
            to: escalationNumber,
            callerId: to,
            actionUrl: `${callbackOrigin}/api/twilio/voice?step=after-dial`,
          }),
        );
      }

      return twiml(
        listenTwiml({
          say: "Sorry, I did not catch that. Could you say that again?",
          actionUrl: `${callbackOrigin}/api/twilio/voice`,
        }),
      );
    }

    const turns = [...priorTurns, { role: "user" as const, text: speech }];

    const decision = await readInboundText({
      system: `${buildIntakeSystemPrompt(context)}\n${voiceInstructions()}`,
      turns,
    });

    const action = decideIntakeAction({ decision, customerText: speech, context });
    const escalationNumber = process.env.ESCALATION_PHONE_NUMBER ?? "";
    const voiceStep = decideVoiceStep({
      action,
      callerText: speech,
      failedTurns,
      canTransfer: Boolean(escalationNumber),
      context,
    });

    const customerId = existingCall.customer_id ? String(existingCall.customer_id) : "";
    let recorded: { requestId?: string; payUrl?: string; feeCents?: number } = {};
    if (customerId) {
      recorded = await recordBookingRequest({
        database,
        organizationId,
        customerId,
        phone: from,
        channel: "phone",
        action,
        callerText: speech,
        model: decision ? "claude-opus-5" : null,
        decision,
        // Frozen against the booking, the same as the text path. Without it the
        // fee was said down the phone and recorded nowhere, and nothing could
        // be held for payment.
        depositCents: action.kind === "book" ? context.diagnosticFeeCents : undefined,
      });
    }

    /*
     * A caller cannot be read a URL. If the time is being held, the words say
     * what is about to arrive and why, and the link goes by text — which is
     * what `sendBookingConfirmations` is already sending them.
     */
    const say =
      recorded.payUrl && recorded.feeCents && action.kind === "book"
        ? `I have ${slotLabel(action.slot.start, action.slot.end, timeZone, new Date().toISOString())} held for you. ${holdSpoken({ feeCents: recorded.feeCents })}`
        : voiceStep.say;

    await database
      .from("voice_calls")
      .update({
        turns: [...turns, { role: "assistant", text: say }],
        failed_turns: action.kind === "ask" ? failedTurns + 1 : 0,
        status:
          voiceStep.kind === "transfer"
            ? "transferred"
            : voiceStep.kind === "hangup"
              ? "completed"
              : "in_progress",
        outcome: action.kind,
        ...(recorded.requestId ? { booking_request_id: recorded.requestId } : {}),
      })
      .eq("call_sid", callSid);

    if (voiceStep.kind === "transfer") {
      return twiml(
        transferTwiml({
          say,
          to: escalationNumber,
          callerId: to,
          actionUrl: `${callbackOrigin}/api/twilio/voice?step=after-dial`,
        }),
      );
    }

    if (voiceStep.kind === "hangup") return twiml(hangupTwiml(say));

    return twiml(
      listenTwiml({
        say,
        actionUrl: `${callbackOrigin}/api/twilio/voice`,
      }),
    );
  } catch {
    return apologise();
  }
}
