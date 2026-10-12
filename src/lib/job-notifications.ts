import "server-only";

import {
  cancellationEmail,
  cancellationSms,
  rescheduleEmail,
  rescheduleSms,
  type JobChangeFacts,
} from "@/lib/job-change-messages";
import { emailSender, looksLikeEmail } from "@/lib/booking-confirmation";
import { sendEmail } from "@/lib/email";
import { recordActivity } from "@/lib/activity";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { sendSms } from "@/lib/twilio";

/**
 * Telling a customer their appointment moved or is off.
 *
 * Best effort, and never allowed to throw: the change is already saved by the
 * time this runs, and a provider outage must not roll back a cancellation the
 * business has already acted on. What it must not do is fail silently, so every
 * attempt — including the ones skipped for want of a phone number — is written
 * back onto the job.
 */

export type ChangeAttempt = {
  channel: "sms" | "email";
  to: string;
  ok: boolean;
  detail: string;
  at: string;
};

export async function notifyJobChange(input: {
  jobId: string;
  organizationId: string;
  kind: "canceled" | "rescheduled";
  facts: JobChangeFacts;
  customerPhone: string;
  customerEmail: string;
}): Promise<ChangeAttempt[]> {
  const database = getSupabaseAdmin();
  const attempts: ChangeAttempt[] = [];
  const note = (attempt: Omit<ChangeAttempt, "at">) =>
    attempts.push({ ...attempt, at: new Date().toISOString() });

  const canceled = input.kind === "canceled";
  const smsBody = canceled ? cancellationSms(input.facts) : rescheduleSms(input.facts);
  const mail = canceled ? cancellationEmail(input.facts) : rescheduleEmail(input.facts);

  const { data: settings } = await database
    .from("messaging_settings")
    .select("messaging_service_sid")
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  const messagingServiceSid = String(settings?.messaging_service_sid ?? "");

  if (!messagingServiceSid) {
    note({
      channel: "sms",
      to: input.customerPhone,
      ok: false,
      detail: "This business has no messaging service, so no text could be sent.",
    });
  } else if (!input.customerPhone) {
    note({ channel: "sms", to: "", ok: false, detail: "No phone number on this customer." });
  } else {
    const result = await sendSms({
      to: input.customerPhone,
      body: smsBody,
      messagingServiceSid,
    });
    note({
      channel: "sms",
      to: input.customerPhone,
      ok: result.ok,
      detail: result.ok ? result.status : `${result.errorCode}: ${result.errorDetail}`,
    });
  }

  if (!looksLikeEmail(input.customerEmail)) {
    note({
      channel: "email",
      to: input.customerEmail,
      ok: false,
      detail: input.customerEmail
        ? "That address is not one mail can be sent to."
        : "No email address on this customer.",
    });
  } else {
    const sent = await sendEmail({
      to: input.customerEmail,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      from: emailSender(input.facts.businessName, process.env.BOOKING_EMAIL_FROM ?? ""),
    });
    note({
      channel: "email",
      to: input.customerEmail,
      ok: sent.ok,
      detail: sent.ok ? sent.id : `${sent.errorCode}: ${sent.errorDetail}`,
    });
  }

  // Appended rather than replaced: a job can be moved twice and then called
  // off, and the earlier attempts are the record of what the customer was
  // previously promised.
  try {
    const { data: existing } = await database
      .from("jobs")
      .select("customer_notifications")
      .eq("id", input.jobId)
      .maybeSingle();

    const previous = Array.isArray(existing?.customer_notifications)
      ? (existing.customer_notifications as unknown[])
      : [];

    await database
      .from("jobs")
      .update({ customer_notifications: [...previous, ...attempts] })
      .eq("id", input.jobId);
  } catch {
    // Deliberately silent. The messages are already sent; losing the record of
    // them is bad, but undoing the change would be worse.
  }

  // And onto the job's history, where the rest of what was sent is: told by
  // which channel, or not told and why. `recordActivity` never throws.
  const reached = attempts.filter((attempt) => attempt.ok);
  await recordActivity(asFlexibleClient(database), {
    organizationId: input.organizationId,
    eventType: reached.length > 0 ? "customer.notified" : "customer.notify_failed",
    label: reached.length > 0 ? "Customer told about the change" : "Customer not told about the change",
    jobId: input.jobId,
    metadata:
      reached.length > 0
        ? {
            // One channel reads through the timeline's own words ("by text");
            // both are said together.
            via: reached.length === 1 ? reached[0]!.channel : "by text and email",
            note: canceled ? "Canceled" : "Rescheduled",
          }
        : {
            note: canceled ? "Canceled" : "Rescheduled",
            reason: attempts.map((attempt) => attempt.detail).filter(Boolean).join(" "),
          },
  });

  return attempts;
}
