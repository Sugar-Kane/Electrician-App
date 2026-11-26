import "server-only";

import { recordActivity } from "@/lib/activity";
import { readLegalNotices, withinCancellationPeriod } from "@/lib/ca-home-improvement";
import { sendEmail } from "@/lib/email";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient, type FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Telling the business a customer cancelled a home improvement contract
 * (compliance CSLB-007-007, CA-005-007/008). The cancellation is already
 * recorded; this puts it on the job's history and in front of the owner, with
 * the date everything paid must be refunded by. A failure here never undoes
 * the cancellation: the job page shows it either way.
 *
 * Only the business's own alert email and number are used, read fresh here,
 * so this cannot be used to reach anybody else.
 */
export async function notifyContractCancelled(input: { organizationId: string; contractId: string }): Promise<void> {
  const database = asFlexibleClient(getSupabaseAdmin());
  const { data } = await database
    .from("contracts")
    .select("job_id, cancelled_at, cancellation_channel, cancellation_note, refund_due_by, jobs ( job_number ), organizations ( name, timezone, owner_notification_email, owner_notification_phone )")
    .eq("organization_id", input.organizationId)
    .eq("id", input.contractId)
    .maybeSingle();
  const row = (data ?? null) as Record<string, unknown> | null;
  if (!row?.cancelled_at) return;

  const job = (row.jobs ?? null) as Record<string, unknown> | null;
  const organization = (row.organizations ?? null) as Record<string, unknown> | null;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const timeZone = text(organization?.timezone) || "America/Los_Angeles";
  const day = (iso: string) =>
    iso ? new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(iso)) : "";
  const jobNumber = String(job?.job_number ?? "");
  const refundBy = day(text(row.refund_due_by));
  const note = text(row.cancellation_note);
  const byLink = row.cancellation_channel === "customer_link";

  await recordActivity(database, {
    organizationId: input.organizationId,
    eventType: "contract.cancelled",
    label: `Contract cancelled by the customer${byLink ? " from their link" : ""}. Refund everything paid by ${refundBy}.`,
    jobId: text(row.job_id) || null,
    metadata: { contract_id: input.contractId, channel: text(row.cancellation_channel), refund_due_by: text(row.refund_due_by), ...(note ? { note } : {}) },
  }).catch((error: unknown) => console.error("contract cancellation not recorded in history", error));

  const ownerEmail = text(organization?.owner_notification_email);
  if (!ownerEmail) return;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const link = appUrl && jobNumber ? `${appUrl}/jobs/${jobNumber}` : "";
  const lines = [
    `The customer on job #${jobNumber} cancelled their contract${byLink ? " from their contract link" : ""} on ${day(text(row.cancelled_at))}.`,
    note ? `They wrote: "${note}"` : "",
    `California law requires returning everything they paid within 10 days of the cancellation: by ${refundBy}.`,
    "Don't start or continue the work. Open the job to refund their payments.",
    link,
  ].filter(Boolean);
  const result = await sendEmail({
    to: ownerEmail,
    subject: `Contract cancelled: job #${jobNumber}. Refund by ${refundBy}`,
    text: lines.join("\n\n"),
    html: lines.map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join(""),
    organizationId: input.organizationId,
    idempotencyKey: `contract-cancelled:${input.contractId}`,
  });
  if (!result.ok) console.error("contract cancellation email not sent", { contractId: input.contractId, error: result.errorCode });
}

/**
 * Why nothing may be asked for or taken on a job right now because of its
 * home improvement contract's right to cancel, or null. The database refuses
 * the same (private.job_cancellation_hold); this says it before trying, and
 * keeps the deposit request waiting, unclaimed, until the period ends, when
 * the worker sends it.
 */
export async function jobCancellationHold(
  database: FlexibleSupabaseClient,
  organizationId: string,
  jobId: string,
): Promise<string | null> {
  const { data, error } = await database
    .from("contracts")
    .select("status, signed_at, legal_notices, cancel_deadline, cancelled_at")
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .eq("kind", "agreement")
    .in("status", ["signed", "cancelled"])
    .order("signed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  // Unreadable: the database guard still refuses, so carry on rather than block everything.
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  if (row.status === "cancelled") return "The customer cancelled this contract. Nothing more can be collected; refund what they paid.";
  const notices = readLegalNotices(row.legal_notices);
  const held = withinCancellationPeriod(
    {
      cancellable: Boolean(notices?.cancellationForm),
      signedAt: typeof row.signed_at === "string" ? row.signed_at : null,
      cancelDeadline: typeof row.cancel_deadline === "string" ? row.cancel_deadline : null,
      cancelledAt: typeof row.cancelled_at === "string" ? row.cancelled_at : null,
    },
    new Date(),
  );
  return held ? "The customer can still cancel this contract. Payments wait until their right to cancel ends." : null;
}
