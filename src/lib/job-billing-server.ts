import "server-only";

import { diagnosticCreditLeft } from "@/lib/diagnostic-credit";
import { invoiceTotals } from "@/lib/invoice-math";
import { lineTotalCents } from "@/lib/job-lines";
import type { InvoiceStanding } from "@/lib/job-billing";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * The database half of billing a job's lines, and of the stock they take.
 *
 * The rules — what is unbilled, where it goes, what a change order is — live
 * in job-billing.ts and are tested there. This is what every place that raises
 * an invoice, edits one, or writes and removes parts shares, so that the job
 * page, booking, the assistant and the integrations all bill a line once and
 * take a part off the shelf once.
 *
 * Everything reads and writes through the caller's own client, so RLS decides
 * whose job and whose stock this is.
 */

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export type InvoiceFigures = InvoiceStanding & {
  subtotalCents: number;
  taxCents: number;
  diagnosticCreditCents: number;
};

/** A job's invoices, newest first, with the figures a recount needs. */
export async function jobInvoices(
  database: FlexibleSupabaseClient,
  organizationId: string,
  jobId: string,
): Promise<InvoiceFigures[]> {
  const { data } = await database
    .from("invoices")
    .select(
      "id, invoice_number, status, subtotal_cents, tax_cents, diagnostic_credit_cents, total_cents, last_sent_at, paid_at, created_at",
    )
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: text(row.id),
    number: String(row.invoice_number ?? ""),
    status: text(row.status) || "draft",
    totalCents: Number(row.total_cents ?? 0),
    subtotalCents: Number(row.subtotal_cents ?? 0),
    taxCents: Number(row.tax_cents ?? 0),
    diagnosticCreditCents: Number(row.diagnostic_credit_cents ?? 0),
    lastSentAt: text(row.last_sent_at) || null,
    paidAt: text(row.paid_at) || null,
    createdAt: text(row.created_at),
  }));
}

/**
 * Put every unbilled line on an invoice: lines with none, and lines left on a
 * voided one.
 *
 * Each UPDATE carries its condition in its WHERE, so two taps arriving
 * together cannot both claim the same line — the second finds nothing left to
 * claim. What it returns is what was actually claimed, which is the only
 * honest thing to total.
 *
 * Two plain updates rather than one with an `or`: PostgREST builds an update
 * filtered by `or` against a name the statement does not have, and Postgres
 * answers that the column does not exist.
 */
export async function claimUnbilledLines(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; jobId: string; invoiceId: string; voidInvoiceIds: string[] },
): Promise<{ count: number; cents: number } | null> {
  const claim = () =>
    database
      .from("job_line_items")
      .update({ invoice_id: input.invoiceId })
      .eq("organization_id", input.organizationId)
      .eq("job_id", input.jobId);

  const results = await Promise.all([
    claim().is("invoice_id", null).select("quantity, unit_price_cents"),
    input.voidInvoiceIds.length
      ? claim().in("invoice_id", input.voidInvoiceIds).select("quantity, unit_price_cents")
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
  ]);

  const failed = results.find((result) => result.error)?.error;
  if (failed) {
    console.error("billing: lines could not be put on the invoice", failed);
    return null;
  }

  const rows = results.flatMap((result) => (result.data ?? []) as Record<string, unknown>[]);
  return {
    count: rows.length,
    // numeric arrives as a string over PostgREST, so it is read as a number
    // before anything multiplies it.
    cents: rows.reduce(
      (sum, row) =>
        sum + lineTotalCents({ quantity: Number(row.quantity ?? 0), unitPriceCents: Number(row.unit_price_cents ?? 0) }),
      0,
    ),
  };
}

export type BilledJob = {
  id: string;
  followUpOf: string | null;
  diagnosticPaid: boolean;
  diagnosticFeeCents: number;
};

/**
 * A draft's figures after its subtotal moved — lines put on it or taken off.
 *
 * The diagnostic credit it may carry is whatever of the fee is still to come
 * off anywhere, plus what this invoice already took: the recount must neither
 * give the credit twice nor lose the share it already had. The tax carries
 * across untouched; nothing here knows a rate.
 */
export async function retotalInvoice(
  database: FlexibleSupabaseClient,
  input: {
    organizationId: string;
    invoice: Pick<InvoiceFigures, "id" | "taxCents" | "diagnosticCreditCents">;
    job: BilledJob;
    subtotalCents: number;
  },
): Promise<{ totalCents: number } | null> {
  const left = await diagnosticCreditLeft(database, input.organizationId, input.job);
  const totals = invoiceTotals({
    subtotalCents: Math.max(0, input.subtotalCents),
    taxCents: input.invoice.taxCents,
    diagnosticPaidCents: left + Math.max(0, input.invoice.diagnosticCreditCents),
  });

  const { error } = await database
    .from("invoices")
    .update({
      subtotal_cents: totals.subtotalCents,
      diagnostic_credit_cents: totals.diagnosticCreditCents,
      tax_cents: totals.taxCents,
      total_cents: totals.totalCents,
      // A draft has had nothing paid against it, which is what lets it move.
      balance_due_cents: totals.totalCents,
      stripe_application_fee_cents: totals.applicationFeeCents,
    })
    .eq("id", input.invoice.id)
    .eq("organization_id", input.organizationId);

  if (error) {
    console.error("billing: an invoice could not be recounted", error);
    return null;
  }
  return { totalCents: totals.totalCents };
}

/** The business's own clock, which every date on a document is read in. */
export async function organizationTimeZone(
  database: FlexibleSupabaseClient,
  organizationId: string,
): Promise<string> {
  const { data } = await database
    .from("organizations")
    .select("timezone")
    .eq("id", organizationId)
    .maybeSingle();
  return text(data?.timezone) || "America/Los_Angeles";
}

/**
 * Lay an invoice's PDF out again after its lines changed.
 *
 * A new version rather than an overwrite, as every rebuild is. A failure is
 * reported back rather than undoing anything: the figures are the record, and
 * the job page can build the document again.
 */
export async function rebuildInvoiceDocument(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; invoiceId: string; uploadedBy: string },
): Promise<boolean> {
  const { generateInvoicePdf } = await import("@/lib/pdf/invoice-data");
  const result = await generateInvoicePdf({
    database,
    organizationId: input.organizationId,
    invoiceId: input.invoiceId,
    timeZone: await organizationTimeZone(database, input.organizationId),
    uploadedBy: input.uploadedBy,
  });
  if (result.error) console.error("billing: invoice PDF was not rebuilt", { invoiceId: input.invoiceId, error: result.error });
  return !result.error;
}

/**
 * Take parts off the shelf for lines just written.
 *
 * The cost is read off each item now and written onto its movement, because
 * what a breaker cost the day it was fitted is the expense — not what the same
 * breaker costs when somebody runs a report in April. An item that is not this
 * business's is not an item, and moves nothing.
 */
export async function takeFromStock(
  database: FlexibleSupabaseClient,
  input: {
    organizationId: string;
    jobId: string;
    lines: { lineId: string; itemId: string; quantity: number }[];
  },
): Promise<boolean> {
  const lines = input.lines.filter((line) => line.itemId && line.lineId && line.quantity > 0);
  if (lines.length === 0) return true;

  const { data: items } = await database
    .from("inventory_items")
    .select("id, unit_cost_cents")
    .eq("organization_id", input.organizationId)
    .in("id", [...new Set(lines.map((line) => line.itemId))]);

  const cost = new Map(
    ((items ?? []) as Record<string, unknown>[]).map((row) => [text(row.id), Number(row.unit_cost_cents ?? 0)]),
  );
  const moving = lines.filter((line) => cost.has(line.itemId));
  if (moving.length === 0) return lines.length === 0;

  const { error } = await database.from("inventory_movements").insert(
    moving.map((line) => ({
      organization_id: input.organizationId,
      item_id: line.itemId,
      quantity: -Math.abs(line.quantity),
      reason: "used_on_job",
      job_id: input.jobId,
      job_line_item_id: line.lineId,
      unit_cost_cents: cost.get(line.itemId) ?? 0,
    })),
  );

  if (error) console.error("billing: stock was not taken off the shelf", error);
  return !error && moving.length === lines.length;
}

/**
 * Put back whatever these lines took off the shelf and have not returned.
 *
 * Worked out from the ledger rather than assumed, so it can be asked twice: a
 * line whose parts already came back owes nothing, and a canceled job whose
 * line is later removed does not put the same breakers back a second time.
 * Written as the opposite movement, never by deleting the first — "three
 * breakers came back" is what happened, and the history then explains the
 * count instead of quietly agreeing with it.
 *
 * Call it before deleting a line: the movement names the line it returns.
 */
export async function returnStock(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; jobId: string; lineIds: string[]; note: string },
): Promise<number> {
  if (input.lineIds.length === 0) return 0;

  const { data, error } = await database
    .from("inventory_movements")
    .select("item_id, job_line_item_id, quantity, reason, unit_cost_cents")
    .eq("organization_id", input.organizationId)
    .in("job_line_item_id", input.lineIds);

  if (error) {
    console.error("billing: could not read what these lines took", error);
    return 0;
  }

  const owed = new Map<string, { itemId: string; quantity: number; unitCostCents: number }>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const lineId = text(row.job_line_item_id);
    const entry = owed.get(lineId) ?? { itemId: text(row.item_id), quantity: 0, unitCostCents: 0 };
    entry.quantity += Number(row.quantity ?? 0);
    if (text(row.reason) === "used_on_job") entry.unitCostCents = Number(row.unit_cost_cents ?? 0);
    owed.set(lineId, entry);
  }

  // Two decimal places, matching the column, so a sum like -2.00 + 2.00 that
  // lands a hair off zero in floating point is zero.
  const back = [...owed.entries()].filter(([, entry]) => Math.round(entry.quantity * 100) < 0);
  if (back.length === 0) return 0;

  const { error: returnError } = await database.from("inventory_movements").insert(
    back.map(([lineId, entry]) => ({
      organization_id: input.organizationId,
      item_id: entry.itemId,
      quantity: Math.round(-entry.quantity * 100) / 100,
      reason: "returned",
      job_id: input.jobId,
      job_line_item_id: lineId,
      unit_cost_cents: entry.unitCostCents,
      note: input.note,
    })),
  );

  if (returnError) {
    console.error("billing: stock was not put back", returnError);
    return 0;
  }
  return back.length;
}
