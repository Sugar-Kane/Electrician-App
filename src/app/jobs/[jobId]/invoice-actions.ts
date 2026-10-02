"use server";

import { revalidatePath } from "next/cache";

import { diagnosticCreditLeft } from "@/lib/diagnostic-credit";
import { formatMoney } from "@/lib/invoice-messages";
import { invoiceTotals } from "@/lib/invoice-math";
import { invoiceIsLive, nextBillingStep } from "@/lib/job-billing";
import {
  claimUnbilledLines,
  jobInvoices,
  rebuildInvoiceDocument,
  retotalInvoice,
  type BilledJob,
  type InvoiceFigures,
} from "@/lib/job-billing-server";
import { parseCostToCents } from "@/lib/new-job-input";
import { asFlexibleClient, type FlexibleSupabaseClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Billing what a job has not billed yet.
 *
 * Each line remembers the invoice that billed it, so this never bills a line
 * twice and never bills the whole job again because one part was remembered
 * late. Where the unbilled lines go is the rule in job-billing.ts:
 *
 * - no invoice yet: the first one, for everything;
 * - the newest invoice is a draft the customer has never seen: onto that
 *   draft, which is recounted and laid out again;
 * - the newest invoice has gone out or been paid: a new invoice for the
 *   difference. A sent or paid invoice's figures never move.
 *
 * This is also where the diagnostic credit matters. A customer pays a fee to
 * have somebody look at the problem; when the repair is invoiced afterwards,
 * that fee counts toward it — once, however many invoices the work grows to,
 * and once across a diagnostic and the work order booked from it
 * (diagnostic-credit.ts).
 */

/**
 * How recently an invoice has to have been raised for a second attempt to be
 * the same tap arriving twice rather than a decision.
 *
 * Ten seconds is longer than any round trip and far shorter than the time it
 * takes somebody to add a forgotten part and bill it.
 */
const DOUBLE_TAP_SECONDS = 10;

export type RaiseInvoiceState = {
  error: string;
  notice?: string;
  /** Where to send somebody once there is a document to look at. */
  invoiceId?: string;
};

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

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? "";
  if (!userId) return { error: "You are not signed in." };

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId = text(membership?.organization_id);
  if (!organizationId) return { error: "You are not a member of a business." };

  const { data: job } = await supabase
    .from("jobs")
    .select("id, diagnostic_paid, diagnostic_fee_cents, follow_up_of")
    .eq("organization_id", organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  if (!job) return { error: "That job could not be found." };

  const row = job as Record<string, unknown>;
  const billedJob: BilledJob = {
    id: text(row.id),
    followUpOf: text(row.follow_up_of) || null,
    diagnosticPaid: Boolean(row.diagnostic_paid),
    diagnosticFeeCents: Number(row.diagnostic_fee_cents ?? 0),
  };

  const invoices = await jobInvoices(supabase, organizationId, billedJob.id);
  const latest = invoices[0];

  /*
   * The accidental double tap: on a phone, a slow response looks like a button
   * that did nothing, so people press it again. Billing by claiming lines
   * already makes a second tap harmless — it finds nothing left to bill — so
   * this only decides what it is told: an invoice raised seconds ago is that
   * same tap, said as such rather than as "nothing to bill".
   *
   * Never a reason to refuse. A part remembered a moment after the invoice was
   * raised is work to bill, however fresh the invoice is.
   */
  const createdAt = latest ? Date.parse(latest.createdAt) : NaN;
  const justRaised = Number.isFinite(createdAt) && (Date.now() - createdAt) / 1000 < DOUBLE_TAP_SECONDS;
  if (typedCents !== null && justRaised && latest) {
    return { error: "", notice: "That invoice was already created.", invoiceId: latest.id };
  }

  const { data: lineRows } = await supabase
    .from("job_line_items")
    .select("quantity, unit_price_cents, invoice_id")
    .eq("organization_id", organizationId)
    .eq("job_id", billedJob.id);

  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map((line) => ({
    // numeric arrives as a string over PostgREST, so this would concatenate
    // rather than multiply if it were passed through untouched.
    quantity: Number(line.quantity ?? 0),
    unitPriceCents: Number(line.unit_price_cents ?? 0),
    invoiceId: text(line.invoice_id) || null,
  }));

  const step = nextBillingStep(lines, invoices);
  const voidInvoiceIds = invoices.filter((invoice) => !invoiceIsLive(invoice)).map((invoice) => invoice.id);

  if (typedCents === null) {
    if (step.kind === "nothing") {
      if (justRaised && latest) {
        return { error: "", notice: "That invoice was already created.", invoiceId: latest.id };
      }
      return {
        error:
          lines.length === 0
            ? "This job has no work or parts on it yet, so there is nothing to bill."
            : "Everything on this job is already on an invoice.",
      };
    }

    if (step.kind === "add_to_draft") {
      const draft = invoices.find((invoice) => invoice.id === step.invoice.id)!;
      return addToDraft({ supabase, organizationId, userId, jobNumber, job: billedJob, draft, voidInvoiceIds });
    }
  }

  const expectedCents = typedCents ?? (step.kind === "nothing" ? 0 : step.cents);
  if (expectedCents <= 0) return { error: "An invoice needs an amount." };

  const totals = invoiceTotals({
    subtotalCents: expectedCents,
    taxCents,
    diagnosticPaidCents: await diagnosticCreditLeft(supabase, organizationId, billedJob),
  });

  const { data: created, error } = await supabase
    .from("invoices")
    .insert({
      organization_id: organizationId,
      job_id: billedJob.id,
      status: "draft",
      subtotal_cents: totals.subtotalCents,
      diagnostic_credit_cents: totals.diagnosticCreditCents,
      tax_cents: totals.taxCents,
      total_cents: totals.totalCents,
      balance_due_cents: totals.totalCents,
      stripe_application_fee_cents: totals.applicationFeeCents,
    })
    .select("id, invoice_number")
    .maybeSingle();

  if (error || !created) return { error: "That invoice could not be saved." };

  const invoiceId = text(created.id);
  const number = String(created.invoice_number ?? "");

  // The lines this invoice bills: everything unbilled, claimed in one go. A
  // typed amount claims them too — it is the price of those lines, and leaving
  // them unbilled would offer to bill them a second time.
  const claimed = await claimUnbilledLines(supabase, {
    organizationId,
    jobId: billedJob.id,
    invoiceId,
    voidInvoiceIds,
  });

  let totalCents = totals.totalCents;
  if (typedCents === null && claimed && claimed.cents !== expectedCents) {
    // Another tap or another phone billed some of them in between. What this
    // invoice actually holds is what it bills.
    if (claimed.cents <= 0) {
      await supabase.from("invoices").delete().eq("id", invoiceId).eq("organization_id", organizationId);
      return { error: "", notice: "Those lines were already billed." };
    }
    const recounted = await retotalInvoice(supabase, {
      organizationId,
      invoice: { id: invoiceId, taxCents: totals.taxCents, diagnosticCreditCents: totals.diagnosticCreditCents },
      job: billedJob,
      subtotalCents: claimed.cents,
    });
    if (recounted) totalCents = recounted.totalCents;
  }

  // The document is made now rather than when somebody asks to look at it, so
  // the invoice the customer is sent and the one on screen are the same file
  // rather than two renders that could drift. A failure here is reported and
  // does not undo the invoice: money owed is a fact whether or not there is a
  // nice copy of it yet.
  const document = await rebuildInvoiceDocument(supabase, { organizationId, invoiceId, uploadedBy: userId });

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath("/invoices");
  revalidatePath("/");

  if (!document) {
    return {
      error: "",
      invoiceId,
      notice: `Invoice for ${formatMoney(totalCents / 100)} created, but the PDF could not be produced. Open it to try again.`,
    };
  }

  if (step.kind === "bill_difference" && typedCents === null) {
    return {
      error: "",
      invoiceId,
      notice: `INV-${number} for ${formatMoney(totalCents / 100)} ready — what was added after INV-${step.after.number}.`,
    };
  }

  const credited = totals.diagnosticCreditCents > 0
    ? ` The ${formatMoney(totals.diagnosticCreditCents / 100)} diagnostic they already paid has been taken off.`
    : "";

  return {
    error: "",
    invoiceId,
    notice: `Invoice for ${formatMoney(totalCents / 100)} ready.${credited}`,
  };
}

/**
 * Put the unbilled lines on a draft nobody has seen, and recount it.
 *
 * The subtotal moves by what the added lines come to rather than being summed
 * again from scratch, so a price typed onto the draft when it was raised is
 * kept and the added parts go on top of it.
 */
async function addToDraft(input: {
  supabase: FlexibleSupabaseClient;
  organizationId: string;
  userId: string;
  jobNumber: string;
  job: BilledJob;
  draft: InvoiceFigures;
  voidInvoiceIds: string[];
}): Promise<RaiseInvoiceState> {
  const { supabase, organizationId, draft } = input;

  const claimed = await claimUnbilledLines(supabase, {
    organizationId,
    jobId: input.job.id,
    invoiceId: draft.id,
    voidInvoiceIds: input.voidInvoiceIds,
  });

  if (!claimed) return { error: `Those lines could not be added to INV-${draft.number}.` };
  if (claimed.count === 0) {
    return { error: "", notice: `Everything is already on INV-${draft.number}.`, invoiceId: draft.id };
  }

  const recounted = await retotalInvoice(supabase, {
    organizationId,
    invoice: draft,
    job: input.job,
    subtotalCents: draft.subtotalCents + claimed.cents,
  });

  revalidatePath(`/jobs/${input.jobNumber}`);
  revalidatePath("/invoices");
  revalidatePath("/");

  if (!recounted) {
    return {
      error: `The lines are on INV-${draft.number}, but its total could not be updated. Open the invoice before sending it.`,
      invoiceId: draft.id,
    };
  }

  const document = await rebuildInvoiceDocument(supabase, {
    organizationId,
    invoiceId: draft.id,
    uploadedBy: input.userId,
  });

  const added = `Added ${formatMoney(claimed.cents / 100)} to INV-${draft.number}, which now comes to ${formatMoney(recounted.totalCents / 100)}.`;
  return {
    error: "",
    invoiceId: draft.id,
    notice: document ? added : `${added} The PDF could not be rebuilt — open the invoice to try again.`,
  };
}
