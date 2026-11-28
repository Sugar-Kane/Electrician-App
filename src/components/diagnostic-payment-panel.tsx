import { ShieldCheck } from "lucide-react";

import { DiagnosticPaymentControls } from "@/components/diagnostic-payment-controls";
import { DISPLAY_LABELS, money } from "@/lib/diagnostic-payment-policy";
import { getJobDiagnosticPaymentStatus } from "@/lib/diagnostic-payment-server";
import { billingRefusal } from "@/lib/billing-permission-server";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

const REPAIR: Record<string, string> = {
  none: "Standalone diagnostic",
  separate: "Repair under a separate contract",
  same_contract: "Repair under the same contract",
  undetermined: "Repair contract not yet decided",
};

/**
 * The job's deferred diagnostic payment: its state (separate from the job's
 * status), the saved card, completion, and Collect. Shown for a job with a
 * diagnostic fee in a business that collects it after completion.
 */
export async function DiagnosticPaymentPanel({ jobNumber }: { jobNumber: string }) {
  const numeric = Number(jobNumber);
  const context = await currentContext();
  if (!context || !Number.isFinite(numeric)) return null;

  // Through the member's own client: RLS scopes the job to their business.
  const supabase = asFlexibleClient(await createClient());
  const { data: job } = await supabase
    .from("jobs")
    .select("id, diagnostic_fee_cents, follow_up_of")
    .eq("organization_id", context.organizationId)
    .eq("job_number", numeric)
    .maybeSingle();
  const row = job as Record<string, unknown> | null;
  if (!row || typeof row.id !== "string" || !(Number(row.diagnostic_fee_cents) > 0) || row.follow_up_of) return null;

  const canBill = !(await billingRefusal());
  const status = await getJobDiagnosticPaymentStatus(context.organizationId, row.id, { role: context.role, canBill });
  if (!status || status.policy.collectAt !== "after_completion") return null;

  const label = DISPLAY_LABELS[status.display].en;
  const linkKind =
    status.authorizationState === "failed" || status.authorizationState === "requires_action"
      ? ("recovery" as const)
      : status.authorizationState === "setup_pending"
        ? ("setup" as const)
        : null;

  return (
    <section aria-labelledby="diagnostic-payment" className="mb-3 rounded-panel border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="diagnostic-payment" className="font-semibold">Diagnostic payment</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {money(status.amountCents)} authorized · collected only after the diagnostic is completed
          </p>
        </div>
        <span className="rounded-chip border border-line px-3 py-1 text-xs font-semibold text-ink">{label}</span>
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-faint">Saved payment method</dt>
          <dd className="text-ink">{status.last4 ? `${status.brand.toUpperCase() || "Card"} •••• ${status.last4}` : "None"}</dd>
        </div>
        <div>
          <dt className="text-ink-faint">Diagnostic</dt>
          <dd className="text-ink">{status.completedAt ? `Completed · ${REPAIR[status.repairContract] ?? ""}` : "Not completed yet"}</dd>
        </div>
        {status.findings ? (
          <div className="sm:col-span-2">
            <dt className="text-ink-faint">Findings</dt>
            <dd className="whitespace-pre-line text-ink">{status.findings}</dd>
          </div>
        ) : null}
        {status.lastFailure && (status.display === "payment_failed" || status.display === "authentication_required") ? (
          <div className="sm:col-span-2">
            <dt className="text-ink-faint">Last attempt</dt>
            <dd className="text-critical">{status.lastFailure.replace(/_/g, " ")}</dd>
          </div>
        ) : null}
      </dl>

      <DiagnosticPaymentControls
        jobNumber={jobNumber}
        completed={Boolean(status.completedAt)}
        canCollect={canBill && status.refusal === null}
        collectReason={status.refusal}
        linkKind={linkKind}
      />

      <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-ink-faint">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Never more than the authorized amount. The fee credits toward an approved repair once, as a prior payment.
      </p>
    </section>
  );
}
