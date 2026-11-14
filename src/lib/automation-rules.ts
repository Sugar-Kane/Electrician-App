/**
 * What a business event calls for: the proposals each automation trigger
 * makes. Pure and import-light, so the rules can be tested directly.
 *
 * Every proposal has a dedupe key derived from the event, so the same event
 * seen twice proposes nothing new (the database enforces it). Customer-facing
 * messages are always proposals for a person to approve; only internal
 * follow-ups (a note in the history) go ahead on their own.
 *
 * Event text (a customer's request, a name) is data. It fills template
 * values and nothing else: it never chooses the action or the recipient.
 */
import type { SupervisedAction } from "./supervised-actions.ts";
import { renderTemplate, type TemplateKey } from "./supervised-templates.ts";

export type AutomationEventType =
  | "lead.received"
  | "estimate.accepted"
  | "contract.signed"
  | "appointment.completed"
  | "invoice.overdue"
  | "materials.shortage";

export type EventFacts = {
  businessName: string;
  customerId: string | null;
  customerFirstName: string;
  customerName: string;
  /** E.164, or empty. */
  customerPhone: string;
  /** An active texting opt-in, and no STOP. */
  textingConsent: boolean;
  jobId: string | null;
  jobNumber: string;
  // lead.received
  requestId?: string;
  service?: string;
  contactMethod?: string;
  // appointment.completed
  hasInvoice?: boolean;
  // invoice.overdue
  invoiceId?: string;
  invoiceLabel?: string;
  balanceCents?: number;
  /** Display form, e.g. "Nov 1". */
  dueDate?: string;
  /** ISO due date, kept with the proposal so the reminder is checked against it before sending. */
  dueAt?: string;
  payLink?: string;
  // materials.shortage
  itemId?: string;
  itemName?: string;
  onHand?: number;
  reorderPoint?: number;
  unit?: string;
  reorderCostCents?: number;
};

export type ProposalDraft = {
  actionType: SupervisedAction;
  content: string;
  reason: string;
  templateKey: TemplateKey | null;
  recipient: string | null;
  amountCents: number | null;
  dedupeKey: string;
  expiresInHours: number;
  payload: Record<string, unknown>;
};

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function note(content: string, reason: string, dedupeKey: string, payload: Record<string, unknown> = {}): ProposalDraft {
  return { actionType: "create_internal_task", content, reason, templateKey: null, recipient: null, amountCents: null, dedupeKey, expiresInHours: 72, payload };
}

/** The proposals an event calls for, possibly none. `eventKey` is the event's own stable key. */
export function proposalsFor(type: AutomationEventType, eventKey: string, facts: EventFacts): ProposalDraft[] {
  const key = (suffix: string) => `${type}:${eventKey}:${suffix}`.slice(0, 200);
  const canText = facts.textingConsent && Boolean(facts.customerPhone) && Boolean(facts.customerId);

  switch (type) {
    case "lead.received": {
      const rendered = renderTemplate("lead_follow_up", {
        name: facts.customerName || "the customer",
        service: facts.service ? ` (${facts.service})` : "",
        contact_method: facts.contactMethod || "phone",
      });
      if (!rendered.ok || !facts.customerId) return [];
      return [{ ...note(rendered.text, "A new request came in from the website.", key("follow_up")), templateKey: "lead_follow_up" }];
    }

    case "estimate.accepted": {
      if (!canText || !facts.jobNumber) return [];
      const rendered = renderTemplate("estimate_accepted", {
        first_name: facts.customerFirstName,
        job: facts.jobNumber,
        business: facts.businessName,
      });
      if (!rendered.ok) return [];
      return [
        {
          actionType: "send_customer_message",
          content: rendered.text,
          reason: `The customer accepted the estimate for job #${facts.jobNumber}.`,
          templateKey: "estimate_accepted",
          recipient: facts.customerPhone,
          amountCents: null,
          dedupeKey: key("thanks"),
          expiresInHours: 48,
          payload: {},
        },
      ];
    }

    case "contract.signed":
      if (!facts.jobNumber) return [];
      return [note(`Job #${facts.jobNumber}'s contract is signed. Book the work and order the materials.`, "The customer signed the contract.", key("book_work"))];

    case "appointment.completed":
      if (!facts.jobNumber || facts.hasInvoice) return [];
      return [note(`Job #${facts.jobNumber} is finished but has no invoice yet.`, "The work was marked complete with nothing billed.", key("invoice_it"))];

    case "invoice.overdue": {
      const balance = Math.max(0, Math.round(facts.balanceCents ?? 0));
      if (!facts.invoiceId || balance <= 0) return [];
      const label = facts.invoiceLabel || "your invoice";
      if (canText && facts.payLink) {
        const rendered = renderTemplate("invoice_overdue", {
          first_name: facts.customerFirstName,
          business: facts.businessName,
          invoice: label,
          amount: money(balance),
          due_date: facts.dueDate ?? "",
          pay_link: facts.payLink,
        });
        if (rendered.ok) {
          return [
            {
              actionType: "send_customer_message",
              content: rendered.text,
              reason: `${label} is past due with ${money(balance)} unpaid.`,
              templateKey: "invoice_overdue",
              recipient: facts.customerPhone,
              amountCents: balance,
              dedupeKey: key("reminder"),
              expiresInHours: 72,
              payload: { invoice_id: facts.invoiceId, due_at: facts.dueAt ?? null },
            },
          ];
        }
      }
      return [
        note(
          `${label} for ${facts.customerName || "a customer"} is past due with ${money(balance)} unpaid. They can't be texted, so call them.`,
          "An overdue invoice whose customer has not agreed to texts.",
          key("call"),
          { invoice_id: facts.invoiceId },
        ),
      ];
    }

    case "materials.shortage": {
      if (!facts.itemId || !facts.itemName) return [];
      const unit = facts.unit || "each";
      return [
        {
          actionType: "purchase_materials",
          content: `Reorder ${facts.itemName}: ${facts.onHand ?? 0} ${unit} on hand, reorder point ${facts.reorderPoint ?? 0} ${unit}.`,
          reason: "Stock fell below its reorder point.",
          templateKey: null,
          recipient: null,
          amountCents: facts.reorderCostCents && facts.reorderCostCents > 0 ? Math.round(facts.reorderCostCents) : null,
          dedupeKey: key("reorder"),
          expiresInHours: 168,
          payload: { inventory_item_id: facts.itemId, on_hand: facts.onHand ?? 0, reorder_point: facts.reorderPoint ?? 0 },
        },
      ];
    }
  }
}

/** The ISO week, "2026-W46": one shortage proposal per item per week at most. */
export function isoWeek(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
