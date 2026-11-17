import "server-only";

import { recordActivity } from "@/lib/activity";
import { deliverInvoice } from "@/lib/invoice-delivery";
import { invoiceLabel } from "@/lib/invoice-label";
import { describeDelivery, invoiceCanBeSent, invoiceViewUrl, type DeliveryChannel } from "@/lib/invoice-messages";
import { claimUnbilledLines, jobInvoices, rebuildInvoiceDocument, retotalInvoice } from "@/lib/job-billing-server";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Sending the customer an invoice that changed after they were sent it.
 *
 * Exactly once per revision. The revision is claimed (pending → sending) by a
 * conditional update before anything goes out, so a retried approval, a second
 * tab, or the "send it now" button racing the automatic send finds nothing to
 * claim and sends nothing. Immediately before sending, the invoice is read
 * again: a revision another one has already replaced is not sent (the newer
 * one is), and nothing is sent for an invoice that is void, paid or owes
 * nothing.
 *
 * Every attempt is written on the invoice's delivery log, as every send is,
 * and the revision records how it went, so a failed one is offered again on
 * the job.
 */

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

function customerName(customer: Row | null): string {
  if (!customer) return "";
  return text(customer.company_name).trim() || [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(" ").trim();
}

/** How this customer has been reached with invoices before: the same way again. */
function channelsFor(deliveries: unknown, customer: Row | null): DeliveryChannel[] {
  const used = new Set<DeliveryChannel>();
  for (const entry of Array.isArray(deliveries) ? (deliveries as Row[]) : []) {
    if (entry.ok !== true || entry.kind === "preview") continue;
    if (entry.channel === "sms" || entry.channel === "email") used.add(entry.channel);
  }
  if (used.size > 0) return [...used];
  // Never reached before (a supplemental invoice on a job billed in person):
  // whatever the customer record has. Texting still answers to STOP in sendSms.
  const fallback: DeliveryChannel[] = [];
  if (text(customer?.phone)) fallback.push("sms");
  if (text(customer?.email)) fallback.push("email");
  return fallback;
}

const INVOICE_COLUMNS = `id, organization_id, invoice_number, number_label, status, total_cents, balance_due_cents, due_at,
  stripe_hosted_invoice_url, preview_token, deliveries, revision_number,
  jobs ( id, job_number, customer_description, customers ( id, first_name, last_name, company_name, phone, email ) ),
  organizations ( name, phone, timezone )`;

function dueLabel(iso: string, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

export type SendReport = { invoiceNumber: string; ok: boolean; message: string };

/**
 * Send one revision's updated invoice, if it still needs sending. Safe to call
 * any number of times: only the first call that claims it sends.
 */
export async function resendInvoiceRevision(
  admin: FlexibleSupabaseClient,
  input: { organizationId: string; revisionId: string },
): Promise<SendReport | null> {
  const staleClaim = new Date(Date.now() - 10 * 60_000).toISOString();
  // pending or failed → sending. A claim left by a send that died part-way
  // (ten minutes and no answer) can be taken again.
  const claim = async (from: "fresh" | "stale") => {
    const query = admin
      .from("invoice_revisions")
      .update({ resend_status: "sending", resend_claimed_at: new Date().toISOString() })
      .eq("organization_id", input.organizationId)
      .eq("id", input.revisionId);
    const scoped = from === "fresh"
      ? query.in("resend_status", ["pending", "failed"])
      : query.eq("resend_status", "sending").lt("resend_claimed_at", staleClaim);
    const { data } = await scoped.select("id, invoice_id, revision_number, change_order_id, previous").maybeSingle();
    return (data ?? null) as Row | null;
  };
  const revision = (await claim("fresh")) ?? (await claim("stale"));
  if (!revision) return null;

  const finish = async (status: "sent" | "failed" | "not_needed", detail: string) => {
    await admin
      .from("invoice_revisions")
      .update({ resend_status: status, resend_detail: detail.slice(0, 500), ...(status === "sent" ? { resent_at: new Date().toISOString() } : {}) })
      .eq("id", input.revisionId)
      .eq("resend_status", "sending");
  };

  const { data } = await admin
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .eq("organization_id", input.organizationId)
    .eq("id", text(revision.invoice_id))
    .maybeSingle();
  if (!data) {
    await finish("not_needed", "The invoice no longer exists.");
    return null;
  }
  const invoice = data as Row;
  const number = invoiceLabel(invoice);
  const job = (invoice.jobs ?? null) as Row | null;
  const customer = (job?.customers ?? null) as Row | null;
  const organization = (invoice.organizations ?? null) as Row | null;

  // A newer revision waiting to go out replaces this one: send that, not both.
  const { data: newer } = await admin
    .from("invoice_revisions")
    .select("id")
    .eq("invoice_id", text(invoice.id))
    .gt("revision_number", num(revision.revision_number))
    .in("resend_status", ["pending", "sending"])
    .limit(1);
  if (Array.isArray(newer) && newer.length > 0) {
    await finish("not_needed", "A later update to this invoice replaces it.");
    return null;
  }

  const owed = num(invoice.balance_due_cents);
  const permitted = invoiceCanBeSent({ status: text(invoice.status), amountDue: owed / 100 });
  if (text(invoice.status) === "void" || !permitted.ok) {
    await finish("not_needed", text(invoice.status) === "void" ? "The invoice is void." : permitted.ok ? "" : permitted.reason);
    return null;
  }

  const channels = channelsFor(invoice.deliveries, customer);
  if (channels.length === 0) {
    await finish("failed", "The customer has no phone or email to send it to.");
    return { invoiceNumber: number, ok: false, message: "The customer has no phone or email to send it to." };
  }

  let revisionNote = "Updated after a change to the work";
  const changeOrderId = text(revision.change_order_id);
  if (changeOrderId) {
    const { data: order } = await admin.from("change_orders").select("number").eq("id", changeOrderId).maybeSingle();
    if (order) revisionNote = `Updated for change order #${num(order.number)}, which you approved`;
  }
  const previous = (revision.previous ?? {}) as Row;
  const timeZone = text(organization?.timezone) || "America/Los_Angeles";

  const attempts = await deliverInvoice({
    invoiceId: text(invoice.id),
    organizationId: input.organizationId,
    channels,
    customerPhone: text(customer?.phone),
    customerEmail: text(customer?.email),
    customerId: text(customer?.id) || undefined,
    kind: "revised",
    facts: {
      businessName: text(organization?.name) || "Your electrician",
      businessPhone: text(organization?.phone) || "our office",
      contactName: customerName(customer),
      invoiceNumber: `INV-${number}`,
      // What is owed now: an updated bill with money already paid on it asks
      // for the rest, and says what it used to ask for.
      amountDue: owed / 100,
      previousAmount: num(previous.balance_due_cents ?? previous.total_cents) / 100,
      revisionNote,
      dueLabel: dueLabel(text(invoice.due_at), timeZone),
      payUrl: text(invoice.stripe_hosted_invoice_url) || undefined,
      workSummary: text(job?.customer_description) || undefined,
      viewUrl: invoiceViewUrl(process.env.NEXT_PUBLIC_APP_URL ?? "", text(invoice.preview_token)),
    },
  });
  const outcome = describeDelivery(attempts, "Updated invoice");
  await finish(outcome.ok ? "sent" : "failed", outcome.message);

  await recordActivity(admin, {
    organizationId: input.organizationId,
    eventType: outcome.ok ? "invoice.revised_sent" : "invoice.revised_send_failed",
    label: outcome.ok ? `Updated INV-${number} sent` : `Updated INV-${number} not sent`,
    jobId: text(job?.id) || null,
    metadata: {
      invoice_id: text(invoice.id),
      revision_id: input.revisionId,
      amount_cents: owed,
      via: channels.join(" and "),
      ...(outcome.ok ? {} : { reason: outcome.message }),
    },
  });

  return { invoiceNumber: number, ok: outcome.ok, message: outcome.message };
}

/**
 * Every update a change order still owes the customer: the revisions it just
 * made, and any an earlier attempt left pending or failed.
 */
export async function resendPendingRevisions(
  admin: FlexibleSupabaseClient,
  input: { organizationId: string; changeOrderId: string; revisionIds?: string[] },
): Promise<SendReport[]> {
  const { data } = await admin
    .from("invoice_revisions")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("change_order_id", input.changeOrderId)
    .in("resend_status", ["pending", "failed", "sending"])
    .order("revision_number", { ascending: true });
  const ids = [...new Set([...(input.revisionIds ?? []), ...((data ?? []) as Row[]).map((row) => text(row.id))])];
  const reports: SendReport[] = [];
  for (const revisionId of ids) {
    const report = await resendInvoiceRevision(admin, { organizationId: input.organizationId, revisionId });
    if (report) reports.push(report);
  }
  return reports;
}

/**
 * A new invoice for work an approved change order added when the job's newest
 * invoice was already paid: the paid one never moves, so the difference is
 * billed on its own and sent to the customer, the way it is reached for
 * invoices.
 */
export async function raiseSupplementalInvoice(
  admin: FlexibleSupabaseClient,
  input: { organizationId: string; jobId: string; changeOrderNumber: number; uploadedBy: string },
): Promise<{ invoiceId: string | null; sent: SendReport | null }> {
  const { data: jobRow } = await admin
    .from("jobs")
    .select("id, job_number, diagnostic_paid, diagnostic_fee_cents, follow_up_of, customer_description, customers ( id, first_name, last_name, company_name, phone, email ), organizations ( name, phone, timezone )")
    .eq("organization_id", input.organizationId)
    .eq("id", input.jobId)
    .maybeSingle();
  if (!jobRow) return { invoiceId: null, sent: null };
  const job = jobRow as Row;
  const billedJob = {
    id: input.jobId,
    followUpOf: text(job.follow_up_of) || null,
    diagnosticPaid: job.diagnostic_paid === true,
    diagnosticFeeCents: num(job.diagnostic_fee_cents),
  };
  const invoices = await jobInvoices(admin, input.organizationId, input.jobId);
  const voidInvoiceIds = invoices.filter((invoice) => invoice.status === "void").map((invoice) => invoice.id);

  // Raised empty, then given exactly the lines it claims, so it never bills
  // a figure it does not hold.
  const { data: created, error } = await admin
    .from("invoices")
    .insert({
      organization_id: input.organizationId,
      job_id: input.jobId,
      status: "draft",
      subtotal_cents: 0,
      diagnostic_credit_cents: 0,
      tax_cents: 0,
      total_cents: 0,
      balance_due_cents: 0,
      stripe_application_fee_cents: 0,
    })
    .select("id, invoice_number, number_label, deliveries")
    .maybeSingle();
  if (error || !created) {
    console.error("change orders: the invoice for the difference could not be raised", error);
    return { invoiceId: null, sent: null };
  }
  const invoiceId = text(created.id);
  const claimed = await claimUnbilledLines(admin, { organizationId: input.organizationId, jobId: input.jobId, invoiceId, voidInvoiceIds });
  if (!claimed || claimed.cents <= 0) {
    // Somebody billed these a moment ago; an empty invoice is not left behind.
    await admin.from("invoices").delete().eq("id", invoiceId).eq("organization_id", input.organizationId);
    return { invoiceId: null, sent: null };
  }
  await retotalInvoice(admin, {
    organizationId: input.organizationId,
    invoice: { id: invoiceId, taxCents: 0, diagnosticCreditCents: 0 },
    job: billedJob,
    subtotalCents: claimed.cents,
  });
  await rebuildInvoiceDocument(admin, { organizationId: input.organizationId, invoiceId, uploadedBy: input.uploadedBy });

  const number = invoiceLabel(created);
  const customer = (job.customers ?? null) as Row | null;
  const organization = (job.organizations ?? null) as Row | null;
  // Reached the way the job's earlier invoices reached them (newest first).
  const earlier = invoices.find((invoice) => invoice.lastSentAt);
  const { data: earlierRow } = earlier
    ? await admin.from("invoices").select("deliveries").eq("id", earlier.id).maybeSingle()
    : { data: null };
  const channels = channelsFor((earlierRow as Row | null)?.deliveries, customer);

  await recordActivity(admin, {
    organizationId: input.organizationId,
    eventType: "invoice.created",
    label: `INV-${number} raised for change order #${input.changeOrderNumber}`,
    jobId: input.jobId,
    metadata: { invoice_id: invoiceId, amount_cents: claimed.cents },
  });

  if (channels.length === 0) {
    return { invoiceId, sent: { invoiceNumber: number, ok: false, message: "The customer has no phone or email, so it was not sent." } };
  }
  const { data: fresh } = await admin
    .from("invoices")
    .select("total_cents, preview_token")
    .eq("id", invoiceId)
    .maybeSingle();
  const totalCents = num((fresh as Row | null)?.total_cents);
  const attempts = await deliverInvoice({
    invoiceId,
    organizationId: input.organizationId,
    channels,
    customerPhone: text(customer?.phone),
    customerEmail: text(customer?.email),
    customerId: text(customer?.id) || undefined,
    facts: {
      businessName: text(organization?.name) || "Your electrician",
      businessPhone: text(organization?.phone) || "our office",
      contactName: customerName(customer),
      invoiceNumber: `INV-${number}`,
      amountDue: totalCents / 100,
      dueLabel: "",
      workSummary: `Additional work from change order #${input.changeOrderNumber}, which you approved`,
      viewUrl: invoiceViewUrl(process.env.NEXT_PUBLIC_APP_URL ?? "", text((fresh as Row | null)?.preview_token)),
    },
  });
  const outcome = describeDelivery(attempts);
  await recordActivity(admin, {
    organizationId: input.organizationId,
    eventType: outcome.ok ? "invoice.sent" : "invoice.send_failed",
    label: outcome.ok ? "Invoice sent" : "Invoice not sent",
    jobId: input.jobId,
    metadata: { invoice_id: invoiceId, amount_cents: totalCents, via: channels.join(" and "), ...(outcome.ok ? {} : { reason: outcome.message }) },
  });
  return { invoiceId, sent: { invoiceNumber: number, ok: outcome.ok, message: outcome.message } };
}
