"use server";

import { revalidatePath } from "next/cache";

import { formatMoney } from "@/lib/invoice-messages";
import { diagnosticCreditFor, invoiceTotals } from "@/lib/invoice-math";
import { jobLineTotals } from "@/lib/job-lines";
import { parseCostToCents } from "@/lib/new-job-input";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Raising an invoice against a job that has already happened.
 *
 * This is where the diagnostic credit matters. A customer pays a fee to have
 * somebody look at the problem; when the repair is invoiced afterwards, that
 * fee counts toward it. Previously nothing did this — the diagnostic was
 * collected and then the full repair was billed on top, which is a customer
 * paying twice for the first hour.
 *
 * The credit is applied once per job however many invoices it grows. A panel
 * job billed in three stages must not refund the diagnostic three times.
 */

export type RaiseInvoiceState = { error: string; notice?: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function raiseInvoice(
  _previous: RaiseInvoiceState,
  formData: FormData,
): Promise<RaiseInvoiceState> {
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return { error: "That job could not be found." };

  // Blank means "bill what the job says it is worth". A typed figure still
  // wins — an electrician who agreed a price on the doorstep is not overruled
  // by the sum of the lines they happened to write down.
  const typedAmount = String(formData.get("amount") ?? "").trim();
  const typedCents = typedAmount ? parseCostToCents(typedAmount) : null;
  if (typedAmount && typedCents === null) {
    return { error: "That amount could not be read. Try a figure like 1280 or 1280.50." };
  }

  const taxCents = parseCostToCents(String(formData.get("tax") ?? "")) ?? 0;

  const supabase = asFlexibleClient(await createClient());

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId = text(membership?.organization_id);
  if (!organizationId) return { error: "You are not a member of a business." };

  const { data: job } = await supabase
    .from("jobs")
    .select("id, diagnostic_paid, diagnostic_fee_cents")
    .eq("organization_id", organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  if (!job) return { error: "That job could not be found." };

  const jobId = text((job as Record<string, unknown>).id);

  let subtotalCents = typedCents ?? 0;

  if (typedCents === null) {
    const { data: lineRows } = await supabase
      .from("job_line_items")
      .select("kind, quantity, unit_price_cents")
      .eq("organization_id", organizationId)
      .eq("job_id", jobId);

    subtotalCents = jobLineTotals(
      (lineRows ?? []).map((row: Record<string, unknown>, index: number) => ({
        id: String(index),
        kind: row.kind === "labor" ? ("labor" as const) : ("material" as const),
        description: "",
        // numeric arrives as a string over PostgREST, so this would concatenate
        // rather than multiply if it were passed through untouched.
        quantity: Number(row.quantity ?? 0),
        unit: "each",
        unitPriceCents: Number(row.unit_price_cents ?? 0),
      })),
    ).subtotalCents;
  }

  if (subtotalCents <= 0) {
    return {
      error: typedCents === null
        ? "This job has no work or parts on it yet, so there is nothing to bill."
        : "An invoice needs an amount.",
    };
  }

  // Existing invoices decide two things: whether this is a follow-up at all,
  // and how much of the diagnostic has already been given back.
  const { data: existing } = await supabase
    .from("invoices")
    .select("diagnostic_credit_cents")
    .eq("organization_id", organizationId)
    .eq("job_id", jobId);

  const invoices = (existing ?? []) as Record<string, unknown>[];
  const alreadyCreditedCents = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.diagnostic_credit_cents ?? 0),
    0,
  );

  const diagnosticPaidCents = diagnosticCreditFor({
    diagnosticPaid: Boolean((job as Record<string, unknown>).diagnostic_paid),
    diagnosticFeeCents: Number((job as Record<string, unknown>).diagnostic_fee_cents ?? 0),
    existingInvoiceCount: invoices.length,
    alreadyCreditedCents,
  });

  const totals = invoiceTotals({ subtotalCents, taxCents, diagnosticPaidCents });

  const { error } = await supabase.from("invoices").insert({
    organization_id: organizationId,
    job_id: jobId,
    status: "draft",
    subtotal_cents: totals.subtotalCents,
    diagnostic_credit_cents: totals.diagnosticCreditCents,
    tax_cents: totals.taxCents,
    total_cents: totals.totalCents,
    balance_due_cents: totals.totalCents,
    stripe_application_fee_cents: totals.applicationFeeCents,
  });

  if (error) return { error: "That invoice could not be saved." };

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath("/invoices");

  const credited = totals.diagnosticCreditCents > 0
    ? ` The ${formatMoney(totals.diagnosticCreditCents / 100)} diagnostic they already paid has been taken off.`
    : "";

  return {
    error: "",
    notice: `Draft invoice for ${formatMoney(totals.totalCents / 100)} created.${credited}`,
  };
}
