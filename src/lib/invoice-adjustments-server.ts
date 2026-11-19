import "server-only";

import { recordActivity } from "@/lib/activity";
import { diagnosticCreditLeft } from "@/lib/diagnostic-credit";
import { invoiceLabel, invoiceRef } from "@/lib/invoice-label";
import {
  discountColumns,
  discountFromRow,
  discountLabel,
  discountOn,
  invoiceTotals,
  readDiscount,
  type InvoiceDiscount,
} from "@/lib/invoice-math";
import { readPrice } from "@/lib/job-lines";
import { rebuildInvoiceDocument } from "@/lib/job-billing-server";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * An invoice's adjustments: its discount, and what change orders added to it.
 *
 * `invoiceSummary` is the one reading of an invoice's figures that the invoice
 * page, its PDF, ChatGPT and the job share — the change orders it carries, the
 * discount, tax, payments and what is left — so none of them can tell the
 * customer a different number. The figures themselves are the ones the
 * invoice row holds, worked out by `invoiceTotals` when they last moved.
 */

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

export type InvoiceSummary = {
  invoiceId: string;
  invoiceNumber: string;
  jobNumber: string;
  status: string;
  /** The work before change orders: subtotal less what approved change orders added on this invoice. */
  originalSubtotalCents: number;
  changeOrders: { number: number; amountCents: number }[];
  changeOrderCents: number;
  subtotalCents: number;
  discount: InvoiceDiscount | null;
  /** "Discount (10%)" or "Discount". Empty when there is no discount, which means no line at all. */
  discountLabel: string;
  discountCents: number;
  /** A fixed discount larger than the work, held to the work. */
  discountCapped: boolean;
  discountReason: string;
  diagnosticCreditCents: number;
  taxCents: number;
  totalCents: number;
  /** Payments received: the total less what is still owed. */
  paidCents: number;
  balanceDueCents: number;
  revisionNumber: number;
  /** Sent, then changed: the copy the customer holds is out of date until it is sent again. */
  changedSinceSent: boolean;
  lastSentAt: string | null;
};

const INVOICE_COLUMNS = `id, invoice_number, number_label, status, subtotal_cents, discount_type, discount_value, discount_cents,
  discount_reason, diagnostic_credit_cents, tax_cents, total_cents, balance_due_cents, revision_number, last_sent_at,
  paid_at, stripe_invoice_id, job_id`;
const SUMMARY_COLUMNS = `${INVOICE_COLUMNS}, jobs ( job_number )`;

/** What each approved change order added to this invoice. */
export async function invoiceChangeOrders(
  database: FlexibleSupabaseClient,
  organizationId: string,
  invoiceId: string,
): Promise<{ number: number; amountCents: number }[]> {
  const { data } = await database
    .from("change_order_items")
    .select("net_cents, applied_effect, change_orders!inner ( number, status )")
    .eq("organization_id", organizationId)
    .eq("billed_invoice_id", invoiceId)
    .in("applied_effect", ["draft", "revision", "unbilled", "supplemental"]);
  const byNumber = new Map<number, number>();
  for (const row of (data ?? []) as Row[]) {
    const order = (Array.isArray(row.change_orders) ? row.change_orders[0] : row.change_orders) as Row | null;
    if (!order || text(order.status) !== "approved") continue;
    const number = num(order.number);
    byNumber.set(number, (byNumber.get(number) ?? 0) + num(row.net_cents));
  }
  return [...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([number, amountCents]) => ({ number, amountCents }));
}

function summarize(row: Row, changeOrders: { number: number; amountCents: number }[], lastRevisionAt: string | null): InvoiceSummary {
  const discount = discountFromRow(row);
  const subtotalCents = num(row.subtotal_cents);
  const discountCents = num(row.discount_cents);
  const totalCents = num(row.total_cents);
  const balanceDueCents = num(row.balance_due_cents ?? row.total_cents);
  const changeOrderCents = changeOrders.reduce((sum, entry) => sum + entry.amountCents, 0);
  const lastSentAt = text(row.last_sent_at) || null;
  const job = (row.jobs ?? null) as Row | null;
  return {
    invoiceId: text(row.id),
    invoiceNumber: invoiceLabel(row),
    jobNumber: String(job?.job_number ?? ""),
    status: text(row.status) || "draft",
    originalSubtotalCents: subtotalCents - changeOrderCents,
    changeOrders,
    changeOrderCents,
    subtotalCents,
    discount: discountCents > 0 ? discount : null,
    discountLabel: discountCents > 0 ? discountLabel(discount) : "",
    discountCents,
    discountCapped: discount?.type === "fixed" && discountOn(subtotalCents, discount).capped,
    discountReason: discountCents > 0 ? text(row.discount_reason) : "",
    diagnosticCreditCents: num(row.diagnostic_credit_cents),
    taxCents: num(row.tax_cents),
    totalCents,
    paidCents: Math.max(0, totalCents - balanceDueCents),
    balanceDueCents,
    revisionNumber: num(row.revision_number),
    changedSinceSent: Boolean(lastSentAt && lastRevisionAt && lastRevisionAt > lastSentAt),
    lastSentAt,
  };
}

/** The invoice's figures, as every screen and ChatGPT reads them. */
export async function invoiceSummary(
  database: FlexibleSupabaseClient,
  organizationId: string,
  invoiceId: string,
): Promise<InvoiceSummary | null> {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return null;
  const [{ data }, changeOrders, { data: revision }] = await Promise.all([
    database.from("invoices").select(SUMMARY_COLUMNS).eq("organization_id", organizationId).eq("id", invoiceId).maybeSingle(),
    invoiceChangeOrders(database, organizationId, invoiceId),
    database
      .from("invoice_revisions")
      .select("created_at")
      .eq("organization_id", organizationId)
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!data) return null;
  return summarize(data as Row, changeOrders, text((revision as Row | null)?.created_at) || null);
}

/** An invoice id from what somebody said: an INV- number, or the one open invoice on a job. */
export async function findInvoiceId(
  database: FlexibleSupabaseClient,
  organizationId: string,
  input: { invoiceId?: string; invoiceNumber?: string; jobNumber?: string },
): Promise<{ invoiceId: string } | { problem: string }> {
  if (input.invoiceId && /^[0-9a-f-]{36}$/i.test(input.invoiceId)) return { invoiceId: input.invoiceId };
  const label = invoiceRef(input.invoiceNumber ?? "");
  if (label) {
    const { data } = await database.from("invoices").select("id").eq("organization_id", organizationId).eq("number_label", label).maybeSingle();
    return data ? { invoiceId: text(data.id) } : { problem: `INV-${label} was not found.` };
  }
  const jobNumber = Number(String(input.jobNumber ?? "").replace(/^#/, ""));
  if (!Number.isInteger(jobNumber)) return { problem: "Give the invoice number or the job number." };
  const { data: job } = await database.from("jobs").select("id").eq("organization_id", organizationId).eq("job_number", jobNumber).maybeSingle();
  if (!job) return { problem: `Job #${jobNumber} was not found.` };
  const { data: rows } = await database
    .from("invoices")
    .select("id, number_label, invoice_number, status, total_cents")
    .eq("organization_id", organizationId)
    .eq("job_id", text(job.id))
    .order("created_at", { ascending: false });
  const live = ((rows ?? []) as Row[]).filter((row) => text(row.status) !== "void");
  const open = live.filter((row) => text(row.status) !== "paid");
  const pick = open.length === 1 ? open : live.length === 1 ? live : [];
  if (pick.length === 1) return { invoiceId: text(pick[0]!.id) };
  if (live.length === 0) return { problem: `Job #${jobNumber} has no invoice yet.` };
  return {
    problem: `Job #${jobNumber} has more than one invoice: ${live
      .map((row) => `INV-${invoiceLabel(row)} (${text(row.status)})`)
      .join(", ")}. Say which one.`,
  };
}

export type DiscountResult =
  | { ok: true; summary: InvoiceSummary; revised: boolean; message: string }
  | { ok: false; error: string };

/**
 * Set, replace or take off an invoice's discount — one at a time, never two —
 * and recount the invoice.
 *
 * `type` is percentage, fixed or none; `value` as typed. A tax amount, when
 * given, replaces the invoice's tax in the same change (tax here is an amount
 * the business enters, not a rate, so a discount that changes what is taxable
 * is the moment to correct it). The caller has already checked the person may
 * change billing; the database checks again for a signed-in member.
 */
export async function setInvoiceDiscount(
  database: FlexibleSupabaseClient,
  input: {
    organizationId: string;
    invoiceId: string;
    type: string;
    value: string;
    reason?: string;
    tax?: string | null;
    actorUserId: string | null;
  },
): Promise<DiscountResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data } = await database
      .from("invoices")
      .select(`${INVOICE_COLUMNS}, jobs ( id, job_number, diagnostic_paid, diagnostic_fee_cents, follow_up_of )`)
      .eq("organization_id", input.organizationId)
      .eq("id", input.invoiceId)
      .maybeSingle();
    if (!data) return { ok: false, error: "That invoice could not be found." };
    const row = data as Row;
    const number = invoiceLabel(row);
    const status = text(row.status);
    if (status === "void") return { ok: false, error: `INV-${number} is void.` };
    if (status === "paid" || text(row.paid_at)) return { ok: false, error: `INV-${number} is paid, so its discount cannot change. Refund the customer instead if they are owed money.` };
    if (text(row.stripe_invoice_id)) return { ok: false, error: `INV-${number} is collected through Stripe and cannot be discounted here.` };

    const subtotalCents = num(row.subtotal_cents);
    const read = readDiscount({ type: input.type, value: input.value, eligibleCents: subtotalCents });
    if (!read.ok) return { ok: false, error: read.reason };

    let taxCents = num(row.tax_cents);
    if (typeof input.tax === "string" && input.tax.trim() !== "") {
      const tax = readPrice(input.tax);
      if (tax.state !== "set") return { ok: false, error: "That tax amount could not be read. Something like 12.40 works." };
      taxCents = tax.cents;
    }

    const job = (row.jobs ?? null) as Row | null;
    const left = job
      ? await diagnosticCreditLeft(database, input.organizationId, {
          id: text(job.id),
          followUpOf: text(job.follow_up_of) || null,
          diagnosticPaid: job.diagnostic_paid === true,
          diagnosticFeeCents: num(job.diagnostic_fee_cents),
        })
      : 0;
    const totals = invoiceTotals({
      subtotalCents,
      discount: read.discount,
      taxCents,
      diagnosticPaidCents: num(row.diagnostic_credit_cents) + left,
    });
    const columns = discountColumns(read.discount);

    const { data: result, error } = await database.rpc("set_invoice_discount", {
      p_invoice_id: input.invoiceId,
      p_expected: {
        status,
        subtotal_cents: subtotalCents,
        total_cents: num(row.total_cents),
        balance_due_cents: num(row.balance_due_cents),
        revision_number: num(row.revision_number),
      },
      p_next: {
        subtotal_cents: totals.subtotalCents,
        discount_cents: totals.discountCents,
        diagnostic_credit_cents: totals.diagnosticCreditCents,
        tax_cents: totals.taxCents,
        total_cents: totals.totalCents,
        stripe_application_fee_cents: totals.applicationFeeCents,
      },
      p_discount_type: columns.discount_type,
      p_discount_value: columns.discount_value,
      p_reason: (input.reason ?? "").trim().slice(0, 300) || null,
      p_actor: input.actorUserId,
    });
    if (error) {
      if (error.code === "40001" && attempt === 0) continue;
      if (error.code === "42501") return { ok: false, error: "Your business owner has turned off billing changes for technicians. Ask an owner or admin to do this." };
      if (error.code === "22023") return { ok: false, error: `Not changed: ${error.message}.` };
      console.error("invoice discount: not saved", error);
      return { ok: false, error: "The discount could not be saved. Try again." };
    }

    await rebuildInvoiceDocument(database, { organizationId: input.organizationId, invoiceId: input.invoiceId, uploadedBy: input.actorUserId ?? "" });
    const revised = Boolean((result as Row | null)?.revised);
    await recordActivity(database, {
      organizationId: input.organizationId,
      eventType: read.discount ? "invoice.discount_set" : "invoice.discount_removed",
      label: read.discount ? `${discountLabel(read.discount)} on INV-${number}` : `Discount taken off INV-${number}`,
      jobId: text(job?.id) || null,
      actorUserId: input.actorUserId,
      metadata: { invoice_id: input.invoiceId, discount_cents: totals.discountCents, total_cents: totals.totalCents },
    });

    const summary = await invoiceSummary(database, input.organizationId, input.invoiceId);
    if (!summary) return { ok: false, error: "The discount was saved, but the invoice could not be read back. Reload it." };
    const dollars = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
    const said = read.discount
      ? `${discountLabel(read.discount)} applied: −${dollars(summary.discountCents)}. INV-${number} now comes to ${dollars(summary.totalCents)}.`
      : `Discount removed. INV-${number} now comes to ${dollars(summary.totalCents)}.`;
    return {
      ok: true,
      summary,
      revised,
      message: revised ? `${said} The customer has the earlier copy: send it again so they have this one.` : said,
    };
  }
  return { ok: false, error: "The invoice changed a moment ago. Reload it and try again." };
}
