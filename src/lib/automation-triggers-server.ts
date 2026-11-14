import "server-only";

import { proposalsFor, isoWeek, type AutomationEventType, type EventFacts } from "@/lib/automation-rules";
import { invoiceLabel } from "@/lib/invoice-label";
import { invoiceViewUrl } from "@/lib/invoice-messages";
import { readSmsConsent } from "@/lib/manual-sms-consent";
import { consentIsActive } from "@/lib/messaging-rules";
import { toE164 } from "@/lib/phone-format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient, type FlexibleSupabaseClient } from "@/lib/supabase/flexible";
import { createSupervisedProposal } from "@/lib/supervised-actions-server";

/**
 * Business events in, proposals out.
 *
 * A caller (the website intake, contract signing, finishing a job) reports
 * what happened with a stable key. The event is recorded once per business
 * (automation_events), the rules in automation-rules.ts say what it calls
 * for, and each proposal is recorded once (its dedupe key). A repeated
 * delivery finds the first event and proposes nothing.
 *
 * Off unless VOLTEIRA_PHASE2_TRIGGERS_ENABLED is "true". Never throws: a
 * trigger must never break the workflow that reported it.
 */

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));

export function triggersEnabled(): boolean {
  return process.env.VOLTEIRA_PHASE2_TRIGGERS_ENABLED === "true";
}

export type AutomationEventInput = {
  organizationId: string;
  type: AutomationEventType;
  key: string;
  jobId?: string | null;
  customerId?: string | null;
  /** Facts the caller already knows (a lead's service, an invoice's balance...). */
  facts?: Partial<EventFacts>;
};

async function baseFacts(db: FlexibleSupabaseClient, input: AutomationEventInput): Promise<EventFacts> {
  const [{ data: organization }, { data: job }] = await Promise.all([
    db.from("organizations").select("name").eq("id", input.organizationId).maybeSingle(),
    input.jobId
      ? db.from("jobs").select("id, job_number, customer_id").eq("organization_id", input.organizationId).eq("id", input.jobId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const customerId = input.customerId || text((job as Row | null)?.customer_id) || null;
  const { data: customer } = customerId
    ? await db.from("customers").select("id, first_name, last_name, company_name, phone").eq("organization_id", input.organizationId).eq("id", customerId).maybeSingle()
    : { data: null };
  const consent = customer ? await readSmsConsent(db, input.organizationId, customerId ?? "") : null;
  const row = (customer ?? null) as Row | null;
  return {
    businessName: text((organization as Row | null)?.name) || "your electrician",
    customerId: row ? text(row.id) : null,
    customerFirstName: text(row?.first_name) || text(row?.company_name) || "there",
    customerName: [text(row?.first_name), text(row?.last_name)].filter(Boolean).join(" ") || text(row?.company_name),
    customerPhone: toE164(text(row?.phone)) ?? "",
    // Proactive texts need an active opt-in, not merely the absence of a STOP.
    textingConsent: consent !== null && consent !== "unknown" && consentIsActive(consent),
    jobId: job ? text((job as Row).id) : null,
    jobNumber: job ? text((job as Row).job_number) : "",
    ...input.facts,
  };
}

/** Records the event and its proposals. Returns how many proposals it made. */
export async function emitAutomationEvent(input: AutomationEventInput, db?: FlexibleSupabaseClient): Promise<number> {
  if (!triggersEnabled()) return 0;
  const database = db ?? asFlexibleClient(getSupabaseAdmin());
  try {
    const { data, error } = await database.rpc("record_automation_event", {
      p_organization_id: input.organizationId,
      p_event_type: input.type,
      p_event_key: input.key.slice(0, 200),
      p_job_id: input.jobId ?? null,
      p_customer_id: input.customerId ?? null,
      p_subject: {},
    });
    const event = (Array.isArray(data) ? data[0] : data) as Row | null;
    if (error || !event?.event_id) {
      console.error("automation event not recorded", { type: input.type, code: error?.code });
      return 0;
    }
    // Seen before: its proposals were made the first time.
    if (event.created !== true) return 0;
    const eventId = text(event.event_id);

    const facts = await baseFacts(database, input);
    const drafts = proposalsFor(input.type, input.key, facts);
    let made = 0;
    for (const draft of drafts) {
      const created = await createSupervisedProposal({
        organizationId: input.organizationId,
        actionType: draft.actionType,
        content: draft.content,
        reason: draft.reason,
        source: "event",
        proposedBy: null,
        proposedByKind: "system",
        expiresInHours: draft.expiresInHours,
        jobId: facts.jobId,
        customerId: facts.customerId,
        recipient: draft.recipient,
        amountCents: draft.amountCents,
        templateKey: draft.templateKey,
        payload: draft.payload,
        dedupeKey: draft.dedupeKey,
        eventId,
      });
      if (created.ok && created.created) made += 1;
    }
    await database
      .from("automation_events")
      .update({ status: drafts.length > 0 ? "processed" : "ignored", processed_at: new Date().toISOString() })
      .eq("id", eventId)
      .eq("organization_id", input.organizationId);
    return made;
  } catch (thrown) {
    console.error("automation event failed", { type: input.type, message: thrown instanceof Error ? thrown.message : "unknown" });
    return 0;
  }
}

/**
 * The time-based triggers, for the worker: invoices gone past due, and stock
 * below its reorder point. Each is keyed so it proposes once (an invoice once
 * per due date, an item once a week).
 */
export async function scanScheduledAutomationEvents(now: Date = new Date()): Promise<{ overdue: number; shortages: number }> {
  if (!triggersEnabled()) return { overdue: 0, shortages: 0 };
  const db = asFlexibleClient(getSupabaseAdmin());
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  let overdue = 0;
  let shortages = 0;

  const { data: invoices } = await db
    .from("invoices")
    .select("id, organization_id, invoice_number, number_label, due_at, balance_due_cents, preview_token, last_sent_at, status, jobs ( id, customer_id )")
    .lt("due_at", now.toISOString())
    .gt("balance_due_cents", 0)
    .not("last_sent_at", "is", null)
    .not("status", "in", "(paid,void,draft)")
    .order("due_at", { ascending: true })
    .limit(200);
  for (const row of (invoices ?? []) as Row[]) {
    const job = (row.jobs ?? null) as Row | null;
    const dueAt = text(row.due_at);
    overdue += await emitAutomationEvent(
      {
        organizationId: text(row.organization_id),
        type: "invoice.overdue",
        key: `${text(row.id)}:${dueAt.slice(0, 10)}`,
        jobId: job ? text(job.id) : null,
        customerId: job ? text(job.customer_id) || null : null,
        facts: {
          invoiceId: text(row.id),
          invoiceLabel: `INV-${invoiceLabel(row)}`,
          balanceCents: Number(row.balance_due_cents ?? 0),
          dueDate: dueAt ? new Date(dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "",
          dueAt: dueAt || undefined,
          payLink: origin ? invoiceViewUrl(origin, text(row.preview_token)) : undefined,
        },
      },
      db,
    );
  }

  const { data: items } = await db
    .from("inventory_items")
    .select("id, organization_id, name, unit, quantity_on_hand, reorder_point, unit_cost_cents")
    .is("archived_at", null)
    .gt("reorder_point", 0)
    .limit(1000);
  const week = isoWeek(now);
  for (const row of (items ?? []) as Row[]) {
    const onHand = Number(row.quantity_on_hand ?? 0);
    const reorderPoint = Number(row.reorder_point ?? 0);
    if (!(onHand < reorderPoint)) continue;
    shortages += await emitAutomationEvent(
      {
        organizationId: text(row.organization_id),
        type: "materials.shortage",
        key: `${text(row.id)}:${week}`,
        facts: {
          itemId: text(row.id),
          itemName: text(row.name),
          unit: text(row.unit),
          onHand,
          reorderPoint,
          reorderCostCents: Math.max(0, (reorderPoint - onHand) * Number(row.unit_cost_cents ?? 0)),
        },
      },
      db,
    );
  }
  return { overdue, shortages };
}

/** A job's work was marked complete. */
export async function emitJobCompleted(organizationId: string, jobId: string): Promise<void> {
  if (!triggersEnabled() || !organizationId || !jobId) return;
  const db = asFlexibleClient(getSupabaseAdmin());
  const { data: invoice } = await db
    .from("invoices")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .neq("status", "void")
    .limit(1)
    .maybeSingle();
  await emitAutomationEvent({ organizationId, type: "appointment.completed", key: jobId, jobId, facts: { hasInvoice: Boolean(invoice) } }, db);
}

/** A customer signed a contract (in Volteira, signing is also accepting the price). */
export async function emitContractSigned(organizationId: string, contractId: string): Promise<void> {
  if (!triggersEnabled() || !organizationId || !contractId) return;
  const db = asFlexibleClient(getSupabaseAdmin());
  const { data: contract } = await db
    .from("contracts")
    .select("id, job_id")
    .eq("organization_id", organizationId)
    .eq("id", contractId)
    .maybeSingle();
  const jobId = text((contract as Row | null)?.job_id);
  if (!jobId) return;
  await emitAutomationEvent({ organizationId, type: "contract.signed", key: contractId, jobId }, db);
}
