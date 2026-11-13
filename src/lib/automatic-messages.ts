import "server-only";

import { consentIsActive, evaluateQuietHours } from "@/lib/messaging-rules";
import { decideAutomaticSend, type TemplateTrigger } from "@/lib/message-templates";
import { readLanguage } from "@/lib/customer-language";
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
  /**
   * Somebody chose to send this one (Finish work's "tell the customer"), so it
   * goes even when the business's template is missing or switched off, in the
   * standard words. Consent, STOP and quiet hours still decide.
   */
  chosen?: boolean;
  /** Added under the message: the work done, for a completion text. */
  append?: string;
  /** Pictures sent with it (MMS). */
  mediaUrls?: string[];
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

    const [
      { data: consentRow },
      { data: templateRows },
      { data: settingsRow },
      { data: serviceRow },
      { data: orgRow },
    ] = await Promise.all([
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
          // Every language for this trigger, chosen between below once the
          // customer's own is known. Deliberately not `.maybeSingle()`: there
          // is a row per language now, and asking for one back from a filter
          // that matches two is an ambiguous lookup that fails the send
          // outright rather than picking wrongly.
          .select("body, is_active, language")
          .eq("organization_id", organizationId)
          .eq("trigger_event", input.trigger)
          .eq("channel", "sms"),
        database
          .from("messaging_settings")
          .select("messaging_service_sid, quiet_hours_start, quiet_hours_end")
          .eq("organization_id", organizationId)
          .maybeSingle(),
        database
          .from("service_settings")
          .select("free_reschedule_hours, diagnostic_fee_cents")
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
      .select("first_name, phone, preferred_language")
      .eq("id", customerId)
      .maybeSingle();

    const phone = text(customerRow?.phone);
    if (!phone) return { sent: false, reason: "Customer has no phone number." };

    /*
     * The customer's language, or English if nobody wrote that one.
     *
     * The fallback is the point: a business that has not translated a trigger
     * still sends something. A Spanish speaker reading one English reminder is
     * a worse experience than an English one; no message at all is a missed
     * appointment.
     */
    const language = readLanguage(customerRow?.preferred_language);
    const rows = (templateRows ?? []) as Record<string, unknown>[];
    const templateRow =
      rows.find((row) => text(row.language) === language) ??
      rows.find((row) => text(row.language) === "en") ??
      null;

    const technician = (job.technicians ?? {}) as Record<string, unknown>;

    // "Work complete" links the job's invoice when there is one. Without one,
    // the same message without the link, rather than no message at all.
    let invoiceLink = "";
    let body = templateRow ? text(templateRow.body) : "";
    if (input.trigger === "job_completed") {
      const { data: invoice } = await database
        .from("invoices")
        .select("preview_token")
        .eq("organization_id", organizationId)
        .eq("job_id", input.jobId)
        .neq("status", "void")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
      const token = text(invoice?.preview_token);
      if (origin && token) {
        const { invoiceViewUrl } = await import("@/lib/invoice-messages");
        invoiceLink = invoiceViewUrl(origin, token) ?? "";
      }
      if (!invoiceLink && body.includes("{{invoice_link}}")) {
        body =
          language === "es"
            ? "El trabajo #{{job_number}} está terminado. Gracias por elegir a {{business_name}}."
            : "Work is complete on job #{{job_number}}. Thank you for choosing {{business_name}}.";
      }
    }

    // Chosen by hand: the standard words when the business has none switched on.
    if (input.chosen && input.trigger === "job_completed" && (!templateRow || templateRow.is_active !== true || !body)) {
      body = invoiceLink
        ? language === "es"
          ? "El trabajo #{{job_number}} está terminado. Su factura: {{invoice_link}} Gracias por elegir a {{business_name}}."
          : "Work is complete on job #{{job_number}}. Your invoice: {{invoice_link}} Thank you for choosing {{business_name}}."
        : language === "es"
          ? "El trabajo #{{job_number}} está terminado. Gracias por elegir a {{business_name}}."
          : "Work is complete on job #{{job_number}}. Thank you for choosing {{business_name}}.";
    }
    const chosenTemplate = input.chosen && input.trigger === "job_completed" ? { body, isActive: true } : null;
    const decision = decideAutomaticSend({
      trigger: input.trigger,
      template: chosenTemplate ?? (templateRow
        ? { body, isActive: templateRow.is_active === true }
        : null),
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
        reschedule_hours:
          typeof serviceRow?.free_reschedule_hours === "number"
            ? String(serviceRow.free_reschedule_hours)
            : "",
        diagnostic_fee:
          typeof serviceRow?.diagnostic_fee_cents === "number"
            ? `$${(serviceRow.diagnostic_fee_cents / 100).toFixed(0)}`
            : "",
        ...(invoiceLink ? { invoice_link: invoiceLink } : {}),
      },
    });

    if (!decision.send) return { sent: false, reason: decision.reason };
    const append = (input.append ?? "").trim();
    const outgoing = append ? `${decision.body}\n\n${append}`.slice(0, 1600) : decision.body;

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
        body: outgoing,
        status: "sending",
      })
      .select("id")
      .single();

    if (!inserted) return { sent: false, reason: "Could not record the message." };
    const messageId = String(inserted.id);

    const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
    const statusCallbackUrl = origin ? `${origin}/api/twilio/status?message=${messageId}` : undefined;
    let result = await sendSms({ to: phone, body: outgoing, messagingServiceSid, mediaUrls: input.mediaUrls, statusCallbackUrl });
    // A number that cannot send pictures still sends the words. Never after a
    // STOP: that refusal is the customer's, not the pictures'.
    if (!result.ok && (input.mediaUrls?.length ?? 0) > 0 && result.errorCode !== "21610") {
      result = await sendSms({ to: phone, body: outgoing, messagingServiceSid, statusCallbackUrl });
    }

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
