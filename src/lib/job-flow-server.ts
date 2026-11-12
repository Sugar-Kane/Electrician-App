import "server-only";

import { getJobContracts, getJobControls, getJobFollowUps } from "@/lib/job-data";
import { getJobInvoices, getJobLines } from "@/lib/job-line-data";
import { getJobWorkflow } from "@/lib/job-workflow-data";
import { unbilledCents } from "@/lib/job-billing";
import { jobProgress } from "@/lib/job-progress";
import { jobFlow, type FlowStage } from "@/lib/job-flow";
import { formatCents } from "@/lib/job-lines";
import { loadJobMaterialChat } from "@/lib/material-list-server";
import type { PilotJob } from "@/lib/pilot-data";

/**
 * Where one job stands, read the way its own page reads it
 * (app/jobs/[jobId]/page.tsx): the same loaders into the same jobFlow, so the
 * Today card and the job's progress bar always say the same thing.
 *
 * For a single job at a time (the next job on Today); the jobs list reads its
 * steps in one trip instead (getJobProgressFacts).
 */
export async function getJobFlowStage(job: PilotJob): Promise<FlowStage | null> {
  const [controls, workflow, contracts, { jobId: lineJobId, lines, totals }, invoices, followUps] = await Promise.all([
    getJobControls(job.id),
    getJobWorkflow(job.id),
    getJobContracts(job.id),
    getJobLines(job.id),
    getJobInvoices(job.id),
    getJobFollowUps(job.id),
  ]);
  if (!controls) return null;

  const materialChat = lineJobId ? await loadJobMaterialChat(lineJobId).catch(() => null) : null;
  const listItems = (materialChat?.saved.list.sections ?? []).flatMap((section) =>
    section.blocks.flatMap((block) => (block.type === "items" ? block.items : [])),
  );
  const unpricedItems = listItems.filter(
    (item) => !item.prices || !Object.keys(item.prices).some((key) => key !== "use"),
  ).length;

  const state = workflow?.state ?? "scheduled";
  const currentAgreement = contracts.find((contract) => contract.kind === "agreement" && contract.status !== "void");
  const agreement = currentAgreement
    ? {
        signed: Boolean(currentAgreement.signedAt),
        sent: currentAgreement.status === "sent" || Boolean(currentAgreement.sentLabel),
      }
    : null;
  const partCount = lines.filter((line) => line.kind === "material").length;

  const progress = jobProgress({
    kindOfWork: job.kindOfWork,
    scheduledLabel: job.startsAt ? `${job.dateLabel} · ${job.time}` : "",
    scheduleHref: `/jobs/${job.id}/edit#window`,
    workflowState: state,
    pricedCents: totals.subtotalCents,
    partCount,
    materialsReadyAt: controls.materialsReadyAt ?? null,
    agreement,
    invoices: invoices.map((invoice) => ({
      status: invoice.status,
      lastSentAt: invoice.lastSentAt,
      paidAt: invoice.paidAt,
      previewSentAt: invoice.previewSentAt,
    })),
    unbilledCents: unbilledCents(
      lines.map((line) => ({ invoiceId: line.invoiceId ?? null, quantity: line.quantity, unitPriceCents: line.unitPriceCents })),
      invoices,
    ),
    formatMoney: formatCents,
  });

  return jobFlow({
    kindOfWork: job.kindOfWork,
    workflowState: state,
    scheduled: Boolean(job.startsAt),
    scheduleHref: `/jobs/${job.id}/edit#window`,
    progress: progress.steps,
    lineCount: lines.length,
    partCount,
    materialListCount: listItems.length,
    unpricedMaterialCount: unpricedItems,
    materialsReady: Boolean(controls.materialsReadyAt),
    agreement,
    followUpCount: followUps.booked.length,
    diagnosticFeeDue: controls.diagnostic.feeCents > 0 && !controls.diagnostic.paid && !controls.diagnostic.followUp,
    canceled: controls.canceled,
  });
}
