import "server-only";

import { recordActivity } from "@/lib/activity";
import { checkCloseOut } from "@/lib/invoice-payment";
import { takeReservedParts } from "@/lib/job-billing-server";
import { unbilledLines } from "@/lib/job-billing";
import { jobLineTotals } from "@/lib/job-lines";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Close out a paid job: mark it completed in one step, for work already done
 * and paid for (cash on the spot) that was never scheduled or walked through
 * the visit steps. Only allowed when every invoice on the job is paid and
 * nothing is left unbilled (checkCloseOut). Nothing is sent to the customer.
 *
 * Like finishing a visit, its reserved parts come off the stock count, and the
 * job goes back to where it was if that fails.
 */

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export async function closeOutPaidJob(
  db: FlexibleSupabaseClient,
  input: { organizationId: string; jobNumber?: number; jobId?: string; via: "app" | "chatgpt" },
): Promise<{ ok: true; jobNumber: string; message: string } | { ok: false; message: string }> {
  let query = db
    .from("jobs")
    .select("id, job_number, status, customer_id, invoices ( id, status ), job_line_items ( kind, quantity, unit_price_cents, invoice_id )")
    .eq("organization_id", input.organizationId)
    .is("archived_at", null);
  query = input.jobId ? query.eq("id", input.jobId) : query.eq("job_number", input.jobNumber ?? -1);
  const { data } = await query.maybeSingle();
  const job = data as Row | null;
  if (!job) return { ok: false, message: "That job was not found." };
  const number = text(job.job_number);
  const invoices = (Array.isArray(job.invoices) ? job.invoices : []) as Row[];
  const lines = (Array.isArray(job.job_line_items) ? job.job_line_items : []) as Row[];
  const open = unbilledLines(
    lines.map((line): Row & { invoiceId: string | null } => ({ ...line, invoiceId: typeof line.invoice_id === "string" ? line.invoice_id : null })),
    invoices.map((invoice) => ({ id: text(invoice.id), status: text(invoice.status) })),
  );
  const { subtotalCents } = jobLineTotals(
    open.map((line, index) => ({
      id: String(index),
      kind: line.kind === "labor" ? ("labor" as const) : ("material" as const),
      description: "",
      quantity: Number(line.quantity ?? 0),
      unit: "each",
      unitPriceCents: Number(line.unit_price_cents ?? 0),
    })),
  );
  const check = checkCloseOut({ jobStatus: text(job.status), invoices: invoices.map((invoice) => ({ status: text(invoice.status) })), unbilledCents: subtotalCents });
  if (!check.ok) return { ok: false, message: `Job #${number}: ${check.reason}` };

  // Claimed from the status read, so two at once close it once.
  const { data: claimed, error } = await db
    .from("jobs")
    .update({ status: "completed" })
    .eq("organization_id", input.organizationId)
    .eq("id", text(job.id))
    .eq("status", text(job.status))
    .select("id");
  if (error) return { ok: false, message: `Job #${number} could not be closed out. Try again.` };
  if (!Array.isArray(claimed) || claimed.length === 0) return { ok: true, jobNumber: number, message: `Job #${number} is already completed.` };

  const parts = await takeReservedParts(db, { organizationId: input.organizationId, jobId: text(job.id) });
  if (!parts.ok) {
    await db.from("jobs").update({ status: text(job.status) }).eq("organization_id", input.organizationId).eq("id", text(job.id)).eq("status", "completed");
    return { ok: false, message: `Job #${number}: its parts could not be taken off the stock count, so it was not closed out. Try again.` };
  }

  const now = new Date().toISOString();
  const { data: progress } = await db.from("job_technician_progress").select("id").eq("organization_id", input.organizationId).eq("job_id", text(job.id)).maybeSingle();
  if (progress) {
    await db.from("job_technician_progress").update({ completed_at: now }).eq("id", text((progress as Row).id));
  } else {
    await db.from("job_technician_progress").insert({ organization_id: input.organizationId, job_id: text(job.id), completed_at: now });
  }
  await recordActivity(db, {
    organizationId: input.organizationId,
    eventType: "job.completed",
    label: "Job closed out (paid)",
    jobId: text(job.id),
    customerId: text(job.customer_id) || null,
    metadata: { via: input.via, closed_out: true },
  });
  return { ok: true, jobNumber: number, message: `Job #${number} closed out as completed.` };
}
