import "server-only";

import { stillToGet } from "@/lib/buy-list";
import { attentionItems, openBookingRequests, unassignedToday, type AttentionItem, type AttentionKey } from "@/lib/dashboard-focus";
import { receivables } from "@/lib/dashboard-metrics";
import { followUps, isPastVisit } from "@/lib/follow-ups";
import { JOB_SELECT, UNBILLED_WINDOW_DAYS, agreementStatesFrom, mapJob, unbilledFrom } from "@/lib/job-data";
import { jobStage, type AgreementState } from "@/lib/job-stage";
import type { PilotJob } from "@/lib/pilot-data";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * "Needs your action": one list, three places to see it. The home screen, the
 * Tasks page and ChatGPT's daily list all come from `needsActionFromInputs`,
 * with the same rules, counts and words, so they can't disagree.
 *
 * The home screen passes what it has already loaded for itself. The Tasks page
 * and ChatGPT call `loadNeedsAction`, which reads the same rows (filtered to
 * the business) and passes them through the same mappers and rules.
 */

type Row = Record<string, unknown>;

export type NeedsActionDetail = { label: string; href: string };

export type NeedsAction = {
  items: (AttentionItem & { details: NeedsActionDetail[] })[];
};

export type NeedsActionInputs = {
  jobs: PilotJob[];
  agreements: Record<string, AgreementState>;
  unbilled: Record<string, number>;
  /** Quantity on hand of each stocked part. */
  stockQuantities: number[];
  /** Status of each buy-list line. */
  buyStatuses: string[];
  /** Status of each booking request still showing. */
  bookingStatuses: string[];
  money: { overdueCount: number; overdueCents: number; draftCount: number; draftCents: number };
  today: string;
  timeZone: string;
  now?: Date;
};

/** The list, from what is loaded. Exactly the home screen's rules. */
export function needsActionFromInputs(input: NeedsActionInputs): NeedsAction {
  const now = input.now ?? new Date();
  const loose = followUps({ jobs: input.jobs, unbilled: input.unbilled, now, timeZone: input.timeZone });
  const pastVisits = loose.filter(isPastVisit);
  const toInvoice = loose.filter((item) => item.kind === "not_invoiced");
  const stageOf = (job: PilotJob) =>
    jobStage({ status: job.status, scheduled: Boolean(job.startsAt), kindOfWork: job.kindOfWork, agreement: input.agreements[job.id] ?? null });
  const quotes = input.jobs.filter((job) => stageOf(job) === "needs_estimate");
  const awaiting = input.jobs.filter((job) => stageOf(job) === "awaiting_approval");
  const toGet = input.buyStatuses.filter((status) => stillToGet({ status } as never));
  const unassigned = input.jobs.filter((job) => job.date === input.today);

  const items = attentionItems({
    bookingRequests: openBookingRequests(input.bookingStatuses.map((status) => ({ status }))),
    pastVisits: pastVisits.length,
    overdueInvoices: input.money.overdueCount,
    overdueCents: input.money.overdueCents,
    unsentInvoices: input.money.draftCount,
    unsentCents: input.money.draftCents,
    toInvoice: toInvoice.length,
    toInvoiceCents: toInvoice.reduce((sum, item) => sum + (input.unbilled[item.jobNumber] ?? 0), 0),
    awaitingApproval: awaiting.length,
    awaitingApprovalCents: awaiting.reduce((sum, job) => sum + Math.max(0, input.agreements[job.id]?.totalCents ?? 0), 0),
    quotesToPrice: quotes.length,
    buyList: {
      toBuy: toGet.filter((status) => status === "need_to_buy").length,
      ordered: toGet.filter((status) => status === "ordered").length,
      ready: toGet.filter((status) => status === "ready_for_pickup").length,
    },
    lowStock: input.stockQuantities.filter((quantity) => quantity <= 0).length,
    unassignedToday: unassignedToday(unassigned, input.today),
  });

  const jobDetail = (job: PilotJob, extra = ""): NeedsActionDetail => ({
    label: `#${job.id} ${job.customer}${job.kindOfWork ? ` · ${job.kindOfWork}` : ""}${extra ? ` · ${extra}` : ""}`,
    href: `/jobs/${job.id}`,
  });
  const details: Partial<Record<AttentionKey, NeedsActionDetail[]>> = {
    past_visits: pastVisits.map((item) => ({ label: `#${item.jobNumber} ${item.customer} · ${item.detail}`, href: `/jobs/${item.jobNumber}` })),
    to_invoice: toInvoice.map((item) => ({ label: `#${item.jobNumber} ${item.customer} · ${item.detail}`, href: `/jobs/${item.jobNumber}` })),
    quotes_to_price: quotes.map((job) => jobDetail(job)),
    awaiting_approval: awaiting.map((job) => jobDetail(job)),
  };
  return { items: items.map((item) => ({ ...item, details: details[item.key] ?? [] })) };
}

function dayIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/**
 * The same list, read straight from the business's rows: for the Tasks page
 * (the signed-in person's client) and ChatGPT (the server client). Every
 * query is filtered to the business.
 */
export async function loadNeedsAction(db: FlexibleSupabaseClient, organizationId: string, timeZone: string): Promise<NeedsAction> {
  const since = new Date(Date.now() - UNBILLED_WINDOW_DAYS * 86_400_000).toISOString();
  const [jobs, contracts, completed, stock, buy, bookings, invoices] = await Promise.all([
    db.from("jobs").select(JOB_SELECT).eq("organization_id", organizationId).is("archived_at", null).order("scheduled_start", { ascending: true }),
    db
      .from("contracts")
      .select("status, signature_sent_at, signed_at, created_at, kind, total_cents, jobs ( job_number )")
      .eq("organization_id", organizationId)
      .neq("status", "void")
      .order("created_at", { ascending: false }),
    db
      .from("jobs")
      .select("job_number, invoices ( id, status ), job_line_items ( kind, quantity, unit_price_cents, invoice_id )")
      .eq("organization_id", organizationId)
      .eq("status", "completed")
      .is("archived_at", null)
      .gte("scheduled_start", since),
    db.from("inventory_items").select("quantity_on_hand").eq("organization_id", organizationId).is("archived_at", null),
    db.from("buy_list_items").select("status").eq("organization_id", organizationId),
    db.from("booking_requests").select("status").eq("organization_id", organizationId).is("archived_at", null).order("created_at", { ascending: false }).limit(100),
    db.from("invoices").select("status,total_cents,balance_due_cents,due_at,last_sent_at").eq("organization_id", organizationId),
  ]);
  const owed = receivables(
    ((invoices.data ?? []) as Row[]).map((invoice) => ({
      status: String(invoice.status ?? ""),
      dueAt: typeof invoice.due_at === "string" ? invoice.due_at : null,
      balanceDueCents: Number(invoice.balance_due_cents ?? 0),
      lastSentAt: typeof invoice.last_sent_at === "string" ? invoice.last_sent_at : null,
    })),
  );
  return needsActionFromInputs({
    jobs: ((jobs.data ?? []) as unknown[]).map((row) => mapJob(row, timeZone)),
    agreements: contracts.error ? {} : agreementStatesFrom((contracts.data ?? []) as Row[]),
    unbilled: completed.error || !completed.data ? {} : unbilledFrom(completed.data as unknown[]),
    stockQuantities: ((stock.data ?? []) as Row[]).map((row) => Number(row.quantity_on_hand ?? 0)),
    buyStatuses: ((buy.data ?? []) as Row[]).map((row) => String(row.status ?? "")),
    bookingStatuses: ((bookings.data ?? []) as Row[]).map((row) => String(row.status ?? "")),
    money: owed,
    today: dayIn(new Date(), timeZone),
    timeZone,
  });
}

/** The list as lines of text, for ChatGPT: each item, why, and the jobs or invoices in it. */
export function describeNeedsAction(needs: NeedsAction): string[] {
  if (needs.items.length === 0) return ["NEEDS YOUR ACTION: nothing waiting."];
  const lines = [`NEEDS YOUR ACTION (${needs.items.length}), the same list as Volteira's home screen`];
  needs.items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.label}${item.urgent ? " (urgent)" : ""}: ${item.reason}`);
    for (const detail of item.details.slice(0, 10)) lines.push(`   - ${detail.label}`);
  });
  return lines;
}
