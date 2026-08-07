import "server-only";

import { consentIsActive, evaluateQuietHours } from "@/lib/messaging-rules";
import { decideAutomaticSend, type TemplateTrigger } from "@/lib/message-templates";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendSms } from "@/lib/twilio";

/**
 * Fire the template for an event that just happened to a job.
 *
 * Runs from webhooks and background paths where there is no session, so it uses
 * the service-role client and scopes every read and write by the organization
 * it resolves from the job itself.
 *
 * Never throws. These are called after the thing that actually mattered has
 * already succeeded — a booking is paid, a job is complete — and a messaging
 * failure must not roll that back or fail a Stripe webhook into a retry loop.
 * The outcome is returned for logging and for tests.
 */
export type AutomaticSendResult =
  | { sent: true; messageId: string }
  | { sent: false; reason: string };

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function sendJobEventMessage(input: {
  jobId: string;
  trigger: TemplateTrigger;
}): Promise<AutomaticSendResult> {
  try {
    const database = getSupabaseAdmin();

    const { data: jobRow } = await database
      .from("jobs")
      .select(
        "id, job_number, organization_id, customer_id, arrival_window_start, arrival_window_end, technicians(display_name)",
      )
      .eq("id", input.jobId)
      .maybeSingle();

    if (!jobRow) return { sent: false, reason: "Job not found." };
    const job = jobRow as Record<string, unknown>;

    const organizationId = text(job.organization_id);
    const customerId = text(job.customer_id);
    if (!organizationId || !customerId) return { sent: false, reason: "Job is incomplete." };

    const [{ data: consentRow }, { data: templateRow }, { data: settingsRow }, { data: orgRow }] =
      await Promise.all([
        database
          .from("messaging_consent")
          .select("opted_in_at, opted_out_at")
          .eq("organization_id", organizationId)
          .eq("customer_id", customerId)
          .eq("channel", "sms")
          .eq("scope", "transactional")
          .maybeSingle(),
        database
          .from("message_templates")
          .select("body, is_active")
          .eq("organization_id", organizationId)
          .eq("trigger_event", input.trigger)
          .eq("channel", "sms")
          .maybeSingle(),
        database
          .from("messaging_settings")
          .select("messaging_service_sid, quiet_hours_start, quiet_hours_end")
          .eq("organization_id", organizationId)
          .maybeSingle(),
        database
          .from("organizations")
          .select("name, phone, timezone")
          .eq("id", organizationId)
          .maybeSingle(),
      ]);

    // Consent first, and from the ledger — the same gate the manual composer
    // uses, so an automatic message can never reach someone who said STOP.
    const consent = {
      optedInAt: consentRow?.opted_in_at ? String(consentRow.opted_in_at) : null,
      optedOutAt: consentRow?.opted_out_at ? String(consentRow.opted_out_at) : null,
    };
    if (!consentIsActive(consent)) return { sent: false, reason: "Customer has not opted in." };

    const messagingServiceSid = text(settingsRow?.messaging_service_sid);
    if (!messagingServiceSid) return { sent: false, reason: "No messaging service configured." };

    const timezone = text(orgRow?.timezone) || "America/Los_Angeles";
    const quietHours = evaluateQuietHours(
      text(settingsRow?.quiet_hours_start) || "21:00:00",
      text(settingsRow?.quiet_hours_end) || "08:00:00",
      timezone,
    );

    const { data: customerRow } = await database
      .from("customers")
      .select("first_name, phone")
      .eq("id", customerId)
      .maybeSingle();

    const phone = text(customerRow?.phone);
    if (!phone) return { sent: false, reason: "Customer has no phone number." };

    const technician = (job.technicians ?? {}) as Record<string, unknown>;
    const decision = decideAutomaticSend({
      trigger: input.trigger,
      template: templateRow
        ? { body: text(templateRow.body), isActive: templateRow.is_active === true }
        : null,
      currentlyQuiet: quietHours.currentlyQuiet,
      variables: {
        customer_first_name: text(customerRow?.first_name),
        business_name: text(orgRow?.name),
        business_phone: text(orgRow?.phone),
        arrival_window: formatArrivalWindow(
          job.arrival_window_start,
          job.arrival_window_end,
          timezone,
        ),
        job_number: job.job_number ? String(job.job_number) : "",
        technician_name: text(technician.display_name),
      },
    });

    if (!decision.send) return { sent: false, reason: decision.reason };

    // Reuse an open thread so automatic messages and anything staff typed sit
    // in one conversation, the way the customer experiences it.
    let conversationId = "";
    const { data: existing } = await database
      .from("conversations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("customer_id", customerId)
      .eq("channel", "sms")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      conversationId = String(existing.id);
    } else {
      const { data: created } = await database
        .from("conversations")
        .insert({
          organization_id: organizationId,
          customer_id: customerId,
          job_id: input.jobId,
          channel: "sms",
          status: "open",
        })
        .select("id")
        .single();
      if (!created) return { sent: false, reason: "Could not open a conversation." };
      conversationId = String(created.id);
    }

    const { data: inserted } = await database
      .from("messages")
      .insert({
        organization_id: organizationId,
        conversation_id: conversationId,
        direction: "outbound",
        body: decision.body,
        status: "sending",
      })
      .select("id")
      .single();

    if (!inserted) return { sent: false, reason: "Could not record the message." };
    const messageId = String(inserted.id);

    const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
    const result = await sendSms({
      to: phone,
      body: decision.body,
      messagingServiceSid,
      statusCallbackUrl: origin ? `${origin}/api/twilio/status?message=${messageId}` : undefined,
    });

    if (!result.ok) {
      await database
        .from("messages")
        .update({ status: "failed", error_code: result.errorCode, error_detail: result.errorDetail })
        .eq("id", messageId);

      // The carrier knows about an opt-out this system missed.
      if (result.errorCode === "21610") {
        await database
          .from("messaging_consent")
          .update({ opted_out_at: new Date().toISOString() })
          .eq("organization_id", organizationId)
          .eq("customer_id", customerId)
          .eq("channel", "sms")
          .eq("scope", "transactional");
      }

      return { sent: false, reason: result.errorDetail };
    }

    const now = new Date().toISOString();
    await database
      .from("messages")
      .update({ status: "sent", provider_message_id: result.providerMessageId, sent_at: now })
      .eq("id", messageId);
    await database
      .from("conversations")
      .update({ last_message_at: now })
      .eq("id", conversationId);

    return { sent: true, messageId };
  } catch {
    return { sent: false, reason: "Automatic message failed." };
  }
}

function formatArrivalWindow(start: unknown, end: unknown, timeZone: string): string {
  if (typeof start !== "string") return "";
  const startDate = new Date(start);

  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(startDate);

  const time = (value: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(value);

  if (typeof end !== "string") return `${day} at ${time(startDate)}`;
  return `${day}, ${time(startDate)}-${time(new Date(end))}`;
}
