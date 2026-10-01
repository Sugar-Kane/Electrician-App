import "server-only";

import { creditGivenCents, creditSource, type DiagnosticFee } from "@/lib/follow-up-jobs";
import { diagnosticCreditFor } from "@/lib/invoice-math";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * How much of a paid diagnostic is still to come off, for a job about to be
 * billed.
 *
 * The diagnostic's fee comes off once across the diagnostic and every job
 * booked from it, whichever is billed first: a repair booked as its own work
 * order gets the credit the customer was promised, and a diagnostic billed
 * after its work order does not give it a second time.
 *
 * Read through the caller's own client, so a diagnostic that is not theirs to
 * see has no credit to give.
 */
export async function diagnosticCreditLeft(
  database: FlexibleSupabaseClient,
  organizationId: string,
  job: DiagnosticFee & { id: string; followUpOf: string | null },
): Promise<number> {
  let followed: DiagnosticFee | null = null;
  if (job.followUpOf) {
    const { data } = await database
      .from("jobs")
      .select("diagnostic_paid, diagnostic_fee_cents")
      .eq("organization_id", organizationId)
      .eq("id", job.followUpOf)
      .maybeSingle();
    const row = data as Record<string, unknown> | null;
    followed = row
      ? { diagnosticPaid: row.diagnostic_paid === true, diagnosticFeeCents: Number(row.diagnostic_fee_cents ?? 0) }
      : null;
  }

  const source = creditSource(job, followed);
  if (!source.diagnosticPaid) return 0;

  // The diagnostic, and everything booked from it — this job among them.
  const diagnosticId = job.followUpOf ?? job.id;
  const { data: bookedFromIt } = await database
    .from("jobs")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("follow_up_of", diagnosticId);

  const jobIds = [
    diagnosticId,
    ...((bookedFromIt ?? []) as Record<string, unknown>[]).map((row) => String(row.id ?? "")),
  ].filter(Boolean);

  const { data: invoices } = await database
    .from("invoices")
    .select("status, diagnostic_credit_cents")
    .eq("organization_id", organizationId)
    .in("job_id", jobIds);

  return diagnosticCreditFor({
    ...source,
    alreadyCreditedCents: creditGivenCents(
      ((invoices ?? []) as Record<string, unknown>[]).map((row) => ({
        status: String(row.status ?? ""),
        diagnosticCreditCents: Number(row.diagnostic_credit_cents ?? 0),
      })),
    ),
  });
}
