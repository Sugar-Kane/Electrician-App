import "server-only";

import { emailSender, looksLikeEmail } from "@/lib/booking-confirmation";
import { diagnosticCreditLeft } from "@/lib/diagnostic-credit";
import { sendEmail } from "@/lib/email";
import { estimateEmail, estimateSms, estimateViewUrl, type EstimateFacts } from "@/lib/estimate-messages";
import { describeDelivery, formatMoney, type DeliveryAttempt, type DeliveryChannel } from "@/lib/invoice-messages";
import { linesAdminFee } from "@/lib/admin-fee";
import { lineTotalCents } from "@/lib/job-lines";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";
import { sendSms } from "@/lib/twilio";

/**
 * Making an estimate from a job's priced lines and sending it to the customer.
 *
 * The estimate is a snapshot: the total of every line on the job when it was
 * sent, less any diagnostic fee they already paid. Sending again makes a new
 * one and retires the earlier link, so the customer only ever reads the
 * current figure. Nothing to sign, nothing due; the contract and invoice are
 * separate steps.
 *
 * One function for the job screen and for ChatGPT. Reads and writes go through
 * the client the caller passes — the person's own session on the screen, so RLS
 * decides whether the job is theirs — and texts go through sendSms, which
 * refuses a customer who replied STOP.
 */

/** How long an estimate holds. */
const VALID_DAYS = 30;

/** A second send of the same figure this soon is the same tap arriving twice. */
const DOUBLE_TAP_SECONDS = 30;

export type EstimateSendResult =
  | {
      ok: true;
      message: string;
      estimateId: string;
      estimateNumber: string;
      totalCents: number;
      adminFeeCents: number;
      viewUrl?: string;
    }
  | { ok: false; message: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function record(value: unknown): Record<string, unknown> {
  const one = Array.isArray(value) ? value[0] : value;
  return one && typeof one === "object" ? (one as Record<string, unknown>) : {};
}

export async function sendJobEstimate(input: {
  database: FlexibleSupabaseClient;
  organizationId: string;
  jobNumber: number;
  /** Which channels to send by. Unknown names are ignored. */
  channels: string[];
  /** Who sent it, when a person did. */
  userId?: string | null;
}): Promise<EstimateSendResult> {
  const { database, organizationId } = input;
  const wants = new Set<DeliveryChannel>(
    input.channels.filter((channel): channel is DeliveryChannel => channel === "sms" || channel === "email"),
  );
  if (wants.size === 0) return { ok: false, message: "Choose text, email or both. Nothing was sent." };
  if (!Number.isFinite(input.jobNumber)) return { ok: false, message: "That job could not be found. Nothing was sent." };

  const { data: jobRow } = await database
    .from("jobs")
    .select(
      "id, job_number, status, customer_id, customer_description, diagnostic_paid, diagnostic_fee_cents, follow_up_of, customers ( first_name, last_name, company_name, phone, email ), organizations ( name, phone, timezone )",
    )
    .eq("organization_id", organizationId)
    .eq("job_number", input.jobNumber)
    .maybeSingle();
  if (!jobRow) return { ok: false, message: `Job #${input.jobNumber} was not found. Nothing was sent.` };

  const job = jobRow as Record<string, unknown>;
  if (text(job.status) === "canceled") return { ok: false, message: "This job is canceled. Nothing was sent." };
  const jobId = text(job.id);
  const customer = record(job.customers);
  const organization = record(job.organizations);

  const { data: lineRows, error: linesError } = await database
    .from("job_line_items")
    .select("quantity, unit_price_cents, admin_fee_cents")
    .eq("organization_id", organizationId)
    .eq("job_id", jobId);
  if (linesError) return { ok: false, message: "The job's prices could not be read. Nothing was sent." };

  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map((line) => ({
    // numeric arrives as a string over PostgREST.
    quantity: Number(line.quantity ?? 0),
    unitPriceCents: Number(line.unit_price_cents ?? 0),
    adminFeeCents: Number(line.admin_fee_cents ?? 0),
  }));
  const subtotalCents = lines.reduce((sum, line) => sum + lineTotalCents(line), 0);
  if (subtotalCents <= 0) {
    return { ok: false, message: "This job has no priced work or parts yet. Add them to the job, then send the estimate." };
  }
  const adminFeeCents = linesAdminFee(lines);

  const credit = await diagnosticCreditLeft(database, organizationId, {
    id: jobId,
    followUpOf: text(job.follow_up_of) || null,
    diagnosticPaid: job.diagnostic_paid === true,
    diagnosticFeeCents: Number(job.diagnostic_fee_cents ?? 0),
  });
  const diagnosticCreditCents = Math.min(Math.max(0, credit), subtotalCents);
  const totalCents = subtotalCents - diagnosticCreditCents;

  const { data: latestRows } = await database
    .from("estimates")
    .select("id, estimate_number, total_cents, status, last_sent_at, preview_token")
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1);
  const latest = (Array.isArray(latestRows) ? latestRows[0] : null) as Record<string, unknown> | null;
  const latestSent = latest ? Date.parse(text(latest.last_sent_at)) : NaN;
  if (
    latest &&
    Number(latest.total_cents) === totalCents &&
    Number.isFinite(latestSent) &&
    (Date.now() - latestSent) / 1000 < DOUBLE_TAP_SECONDS
  ) {
    return {
      ok: true,
      message: `EST-${text(String(latest.estimate_number ?? ""))} for ${formatMoney(totalCents / 100)} was just sent.`,
      estimateId: text(latest.id),
      estimateNumber: `EST-${String(latest.estimate_number ?? "")}`,
      totalCents,
      adminFeeCents,
      viewUrl: estimateViewUrl(process.env.NEXT_PUBLIC_APP_URL ?? "", text(latest.preview_token)),
    };
  }

  const expiresAt = new Date(Date.now() + VALID_DAYS * 24 * 60 * 60 * 1000);
  const { data: created, error: createError } = await database
    .from("estimates")
    .insert({
      organization_id: organizationId,
      job_id: jobId,
      status: "draft",
      subtotal_cents: subtotalCents,
      diagnostic_credit_cents: diagnosticCreditCents,
      tax_cents: 0,
      total_cents: totalCents,
      admin_fee_cents: adminFeeCents,
      expires_at: expiresAt.toISOString(),
      created_by: input.userId || null,
    })
    .select("id, estimate_number, preview_token")
    .maybeSingle();
  if (createError || !created) return { ok: false, message: "The estimate could not be saved. Nothing was sent." };

  const estimateId = text(created.id);
  const estimateNumber = `EST-${String(created.estimate_number ?? "")}`;
  const viewUrl = estimateViewUrl(process.env.NEXT_PUBLIC_APP_URL ?? "", text(created.preview_token));
  const timeZone = text(organization.timezone) || "America/Los_Angeles";
  const contactName =
    text(customer.company_name).trim() ||
    [text(customer.first_name) === "Text" ? "" : text(customer.first_name), text(customer.last_name)].filter(Boolean).join(" ");
  const businessName = text(organization.name) || "Your electrician";

  const facts: EstimateFacts = {
    businessName,
    businessPhone: text(organization.phone) || "our office",
    contactName,
    estimateNumber,
    total: totalCents / 100,
    validUntilLabel: new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(expiresAt),
    workSummary: text(job.customer_description) || undefined,
    viewUrl,
  };

  const attempts: DeliveryAttempt[] = [];
  const note = (attempt: Omit<DeliveryAttempt, "at">) => attempts.push({ ...attempt, at: new Date().toISOString() });
  const phone = text(customer.phone);
  const email = text(customer.email);

  if (wants.has("sms")) {
    const { data: settings } = await getSupabaseAdmin()
      .from("messaging_settings")
      .select("messaging_service_sid")
      .eq("organization_id", organizationId)
      .maybeSingle();
    const messagingServiceSid = String(settings?.messaging_service_sid ?? "");
    if (!messagingServiceSid) {
      note({ channel: "sms", to: phone, ok: false, detail: "This business has no messaging service, so no text could be sent." });
    } else if (!phone) {
      note({ channel: "sms", to: "", ok: false, detail: "No phone number on this customer." });
    } else {
      // sendSms refuses a customer who replied STOP.
      const result = await sendSms({
        organizationId,
        customerId: text(job.customer_id),
        to: phone,
        body: estimateSms(facts),
        messagingServiceSid,
      });
      note({ channel: "sms", to: phone, ok: result.ok, detail: result.ok ? result.status : `${result.errorCode}: ${result.errorDetail}` });
    }
  }

  if (wants.has("email")) {
    if (!looksLikeEmail(email)) {
      note({ channel: "email", to: email, ok: false, detail: email ? "That address is not one mail can be sent to." : "No email address on this customer." });
    } else {
      const mail = estimateEmail(facts);
      const sent = await sendEmail({
        organizationId,
        contactButtons: true,
        to: email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        from: emailSender(businessName, process.env.BOOKING_EMAIL_FROM ?? ""),
      });
      note({ channel: "email", to: email, ok: sent.ok, detail: sent.ok ? sent.id : `${sent.errorCode}: ${sent.errorDetail}` });
    }
  }

  const succeeded = attempts.some((attempt) => attempt.ok);
  await database
    .from("estimates")
    .update({
      deliveries: attempts,
      ...(succeeded ? { status: "sent", last_sent_at: new Date().toISOString() } : {}),
    })
    .eq("id", estimateId)
    .eq("organization_id", organizationId);

  if (succeeded) {
    // The earlier links now say a newer estimate replaced them.
    await database
      .from("estimates")
      .update({ status: "expired" })
      .eq("organization_id", organizationId)
      .eq("job_id", jobId)
      .in("status", ["draft", "sent"])
      .neq("id", estimateId);
  }

  const delivery = describeDelivery(attempts, `${estimateNumber} for ${formatMoney(totalCents / 100)}`);
  if (!delivery.ok) return { ok: false, message: delivery.message };
  return { ok: true, message: delivery.message, estimateId, estimateNumber, totalCents, adminFeeCents, viewUrl };
}
