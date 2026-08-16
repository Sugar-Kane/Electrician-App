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

/**
 * How recently an invoice has to have been raised for a second attempt to be
 * the same tap arriving twice rather than a decision.
 *
 * Ten seconds is longer than any round trip and far shorter than the time it
 * takes somebody to decide they want a second invoice, walk through the
 * confirmation and press again.
 */
const DOUBLE_TAP_SECONDS = 10;

export type RaiseInvoiceState = {
  error: string;
  notice?: string;
  /**
   * Set when the job already has an invoice and the caller has not said they
   * meant it. The screen asks before a second one is created rather than
   * silently making one — a job billed twice is a customer who pays twice.
   */
  existing?: { number: string; totalLabel: string; invoiceId: string };
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
  // Set by the second screen, after somebody has been shown the invoice that
  // already exists and said they want another anyway.
  const confirmed = String(formData.get("confirmDuplicate") ?? "") === "yes";

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

  // Existing invoices decide three things: whether this is a follow-up at all,
  // how much of the diagnostic has already been given back, and whether to ask
  // before making another.
  const { data: existing } = await supabase
    .from("invoices")
    .select("id, invoice_number, total_cents, diagnostic_credit_cents, created_at")
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  const invoices = (existing ?? []) as Record<string, unknown>[];
  const latest = invoices[0];

  if (latest) {
    const createdAt = Date.parse(text(latest.created_at));
    const secondsOld = Number.isFinite(createdAt) ? (Date.now() - createdAt) / 1000 : Infinity;

    /*
     * Two guards, and they are different problems.
     *
     * The second is the accidental double tap: on a phone, a slow response
     * looks like a button that did nothing, so people press it again. The
     * screen disables the button, but a request already in flight when the
     * second tap lands is not something the screen can catch — so an invoice
     * raised seconds ago is treated as this same tap arriving twice and is
     * refused outright, whatever the caller says.
     */
    if (secondsOld < DOUBLE_TAP_SECONDS) {
      return {
        error: "",
        notice: "That invoice was already created.",
        invoiceId: text(latest.id),
      };
    }

    // The other is somebody genuinely invoicing a job twice, which is a real
    // thing to do — a deposit and a balance — and is asked about rather than
    // blocked or done silently.
    if (!confirmed) {
      return {
        error: "",
        existing: {
          number: String(latest.invoice_number ?? ""),
          totalLabel: formatMoney(Number(latest.total_cents ?? 0) / 100),
          invoiceId: text(latest.id),
        },
      };
    }
  }

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

  const { data: created, error } = await supabase
    .from("invoices")
    .insert({
      organization_id: organizationId,
      job_id: jobId,
      status: "draft",
      subtotal_cents: totals.subtotalCents,
      diagnostic_credit_cents: totals.diagnosticCreditCents,
      tax_cents: totals.taxCents,
      total_cents: totals.totalCents,
      balance_due_cents: totals.totalCents,
      stripe_application_fee_cents: totals.applicationFeeCents,
    })
    .select("id")
    .maybeSingle();

  if (error || !created) return { error: "That invoice could not be saved." };

  const invoiceId = text(created.id);

  // The document is made now rather than when somebody asks to look at it, so
  // the invoice the customer is sent and the one on screen are the same file
  // rather than two renders that could drift. A failure here is reported and
  // does not undo the invoice: money owed is a fact whether or not there is a
  // nice copy of it yet.
  const { generateInvoicePdf } = await import("@/lib/pdf/invoice-data");
  const document = await generateInvoicePdf({
    database: supabase,
    organizationId,
    invoiceId,
    timeZone: await organizationTimeZone(supabase, organizationId),
    uploadedBy: userId,
  });

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath("/invoices");

  const credited = totals.diagnosticCreditCents > 0
    ? ` The ${formatMoney(totals.diagnosticCreditCents / 100)} diagnostic they already paid has been taken off.`
    : "";

  if (document.error) {
    return {
      error: "",
      invoiceId,
      notice: `Invoice for ${formatMoney(totals.totalCents / 100)} created, but the PDF could not be produced. Open it to try again.`,
    };
  }

  return {
    error: "",
    invoiceId,
    notice: `Invoice for ${formatMoney(totals.totalCents / 100)} ready.${credited}`,
  };
}

/** The business's own clock, which every date on the document is read in. */
async function organizationTimeZone(
  supabase: ReturnType<typeof asFlexibleClient>,
  organizationId: string,
): Promise<string> {
  const { data } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", organizationId)
    .maybeSingle();

  return text(data?.timezone) || "America/Los_Angeles";
}
