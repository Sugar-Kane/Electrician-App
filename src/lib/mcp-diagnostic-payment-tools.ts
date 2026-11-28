import "server-only";

import { diagnosticCreditLeft } from "@/lib/diagnostic-credit";
import { DISPLAY_LABELS, money } from "@/lib/diagnostic-payment-policy";
import {
  collectDiagnosticPayment,
  completeDiagnostic,
  getJobDiagnosticPaymentStatus,
  sendRecoveryLink,
  sendSetupRequest,
} from "@/lib/diagnostic-payment-server";
import type { McpTool, ToolResult } from "@/lib/mcp-protocol";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Deferred diagnostic payments from ChatGPT or Claude.
 *
 * The same server functions the job screen uses, so the same rules: nothing is
 * collected before the diagnostic is documented complete, never more than the
 * customer authorized, never twice, and only on this business's own Stripe
 * account. Everything that reaches a customer or moves money waits in the
 * owner's AI approval inbox (mcp-approval.ts) before it runs. There is no tool
 * here that takes an amount: the amount is always the authorized one.
 */

const str = (description: string) => ({ type: "string", description });
const confirmed = {
  type: "boolean",
  description:
    "Leave false first to get the proposal to show the user. True only after they approved this exact action; anything that reaches a customer or moves money is then sent to the owner's Volteira approval inbox and runs once they approve.",
};
const jobNumber = str("The job number.");

export const DIAGNOSTIC_PAYMENT_MCP_TOOLS: McpTool[] = [
  {
    name: "get_diagnostic_payment_status",
    title: "Diagnostic payment status",
    description:
      "A diagnostic job's deferred payment: whether the customer authorized a saved payment method, the authorized amount, whether the diagnostic is completed, whether the fee can be collected now (and if not, why), what has been collected, and how much diagnostic credit is left for an approved repair. Read-only. In California the diagnostic fee is never collected before the contracted diagnostic service is completed.",
    inputSchema: { type: "object", properties: { job_number: jobNumber }, required: ["job_number"], additionalProperties: false },
  },
  {
    name: "complete_diagnostic",
    title: "Confirm diagnostic completion",
    description:
      "Record that the diagnostic service on a job is completed, with the findings (required) and how it ended: diagnostic_only (customer declined repairs; standalone), fix_now (repair done under the same contract; the fee is billed with it on the final invoice), or schedule_later (a work order; set separate_repair_contract true only if the customer will sign a separate new contract). The connected owner must be allowed to complete it. When the business collects automatically, a standalone diagnostic is then charged the authorized amount. Call without confirmed first.",
    inputSchema: {
      type: "object",
      properties: {
        job_number: jobNumber,
        outcome: { type: "string", enum: ["diagnostic_only", "fix_now", "schedule_later"] },
        findings: str("What the electrician found and did. At least a sentence."),
        separate_repair_contract: { type: "boolean", description: "Only for schedule_later: the repair is a separate, later contract." },
        confirmed,
      },
      required: ["job_number", "outcome", "findings", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "collect_diagnostic_payment",
    title: "Collect an authorized diagnostic payment",
    description:
      "Charge the customer's saved payment method the exact amount they authorized, for a diagnostic already documented complete. Refused before completion, for a repair under the same incomplete contract, after the customer revoked their authorization, if already paid or processing, or if anything would change the amount. Cannot charge any other amount. Call without confirmed first; it then waits for the owner's approval in Volteira.",
    inputSchema: { type: "object", properties: { job_number: jobNumber, confirmed }, required: ["job_number", "confirmed"], additionalProperties: false },
  },
  {
    name: "send_payment_method_setup_link",
    title: "Send the payment method setup link",
    description:
      "Text and email the customer the secure link to review the diagnostic agreement and save a payment method, for a booking whose time is held. Nothing is charged. Call without confirmed first.",
    inputSchema: { type: "object", properties: { job_number: str("The job number, if the booking already has one."), booking_token: str("Leave empty."), confirmed }, required: ["confirmed"], additionalProperties: false },
  },
  {
    name: "send_payment_recovery_link",
    title: "Send a failed-payment recovery link",
    description:
      "After the charge for a completed diagnostic failed or needs the customer's bank to confirm it: text and email them a secure Stripe link to update their payment method and pay the authorized amount. Refused when no payment failed. Call without confirmed first.",
    inputSchema: { type: "object", properties: { job_number: jobNumber, confirmed }, required: ["job_number", "confirmed"], additionalProperties: false },
  },
  {
    name: "list_payment_exceptions",
    title: "Review payment exceptions",
    description:
      "Recent diagnostic payments that need a person: failed charges, customers asked to verify with their bank, revoked authorizations, and payment questions the phone assistant passed on. Read-only.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
];

const NAMES = new Set(DIAGNOSTIC_PAYMENT_MCP_TOOLS.map((tool) => tool.name));
export function isDiagnosticPaymentTool(name: string): boolean {
  return NAMES.has(name);
}

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");

function gate(args: Record<string, unknown>, proposal: string): ToolResult | null {
  return args.confirmed === true ? null : { text: `CONFIRMATION REQUIRED. Nothing was changed. Proposed action: ${proposal}` };
}

async function findJob(database: FlexibleSupabaseClient, organizationId: string, number: unknown) {
  const value = Number(text(number).replace(/[^0-9]/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  const { data } = await database
    .from("jobs")
    .select("id, job_number, follow_up_of, diagnostic_paid, diagnostic_fee_cents")
    .eq("organization_id", organizationId)
    .eq("job_number", value)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

async function bookingToken(database: FlexibleSupabaseClient, organizationId: string, jobId: string): Promise<string> {
  const { data } = await database
    .from("booking_requests")
    .select("public_token")
    .eq("organization_id", organizationId)
    .eq("created_job_id", jobId)
    .limit(1)
    .maybeSingle();
  return text((data as Row | null)?.public_token);
}

export async function runDiagnosticPaymentTool(input: {
  database: FlexibleSupabaseClient;
  organizationId: string;
  /** The connected owner, verified for this connection; never the model's claim. */
  actorUserId: string | null;
  actorRole: string | null;
  name: string;
  args: Record<string, unknown>;
}): Promise<ToolResult> {
  const { database, organizationId, args } = input;

  if (input.name === "list_payment_exceptions") {
    const { data } = await database
      .from("activity_events")
      .select("event_type, label, created_at, job_id, jobs ( job_number )")
      .eq("organization_id", organizationId)
      .in("event_type", ["diagnostic.payment_failed", "diagnostic.payment_requires_action", "diagnostic.authorization_revoked", "diagnostic.payment_exception", "booking.payment_method_saved_but_unscheduled"])
      .order("created_at", { ascending: false })
      .limit(20);
    const rows = (data ?? []) as Row[];
    if (!rows.length) return { text: "No diagnostic payment exceptions." };
    return {
      text: rows
        .map((row) => {
          const job = (Array.isArray(row.jobs) ? row.jobs[0] : row.jobs) as Row | null;
          return `${text(row.created_at).slice(0, 10)} | ${job ? `job #${text(job.job_number)}` : "no job"} | ${text(row.label)}`;
        })
        .join("\n"),
    };
  }

  if (input.name === "send_payment_method_setup_link" && !args.job_number) {
    return { isError: true, text: "Give the job number of the held booking. Nothing was sent." };
  }

  const job = await findJob(database, organizationId, args.job_number);
  if (!job) return { isError: true, text: `Job #${text(args.job_number)} was not found. Nothing was changed.` };
  const jobId = text(job.id);
  const number = text(job.job_number);
  const canBill = input.actorRole !== null && input.actorRole !== "technician";

  if (input.name === "get_diagnostic_payment_status") {
    const status = await getJobDiagnosticPaymentStatus(organizationId, jobId, { role: input.actorRole, canBill });
    if (!status) return { isError: true, text: "That job could not be read." };
    const credit = await diagnosticCreditLeft(database, organizationId, {
      id: jobId,
      followUpOf: text(job.follow_up_of) || null,
      diagnosticPaid: job.diagnostic_paid === true,
      diagnosticFeeCents: Number(job.diagnostic_fee_cents ?? 0),
    });
    const { data: charges } = await database
      .from("diagnostic_charges")
      .select("status, amount_cents, via, created_at")
      .eq("organization_id", organizationId)
      .eq("job_id", jobId)
      .order("created_at", { ascending: true });
    const history = ((charges ?? []) as Row[]).map((row) => `${text(row.created_at).slice(0, 10)} ${money(Number(row.amount_cents))} ${text(row.status)} (${text(row.via)})`);
    return {
      text: [
        `Job #${number}: ${DISPLAY_LABELS[status.display].en}.`,
        status.policy.collectAt === "after_completion"
          ? `Authorized: ${money(status.amountCents)}, collected only after the diagnostic is completed. Due today at booking: $0.00.`
          : "This business collects its diagnostic fee at booking.",
        status.last4 ? `Saved payment method: ${status.brand || "card"} ending ${status.last4}.` : "No saved payment method.",
        status.completedAt ? `Diagnostic completed ${status.completedAt.slice(0, 10)} (${status.repairContract.replace(/_/g, " ")}).` : "Diagnostic not completed yet.",
        status.refusal ? `Cannot collect now: ${status.refusal}` : "Eligible: collect_diagnostic_payment can charge the authorized amount.",
        `Diagnostic credit left for an approved repair: ${money(credit)}.`,
        history.length ? `Charges: ${history.join("; ")}.` : "No charges yet.",
      ].join("\n"),
    };
  }

  if (input.name === "complete_diagnostic") {
    const outcome = text(args.outcome);
    if (outcome !== "diagnostic_only" && outcome !== "fix_now" && outcome !== "schedule_later") {
      return { isError: true, text: "Choose diagnostic_only, fix_now or schedule_later. Nothing was changed." };
    }
    const separate = args.separate_repair_contract === true;
    const findings = text(args.findings).trim();
    const held = gate(args, `Mark job #${number}'s diagnostic complete (${outcome.replace(/_/g, " ")}${outcome === "schedule_later" ? (separate ? ", repair under a separate contract" : ", repair under the same contract") : ""}) with findings: “${findings.slice(0, 300)}”. If the business collects automatically and this is a standalone diagnostic, the authorized amount is then charged to the saved card.`);
    if (held) return held;
    const result = await completeDiagnostic({ database, organizationId, jobId, outcome, findings, separateRepairContract: separate, actorId: input.actorUserId });
    return result.ok ? { text: result.message, record: { jobId } } : { isError: true, text: `${result.message} Nothing was changed.` };
  }

  if (input.name === "collect_diagnostic_payment") {
    const status = await getJobDiagnosticPaymentStatus(organizationId, jobId, { role: input.actorRole, canBill });
    if (!status) return { isError: true, text: "That job could not be read." };
    if (status.refusal) return { isError: true, text: `${status.refusal} Nothing was charged.` };
    const held = gate(args, `Charge the customer's saved payment method the authorized ${money(status.amountCents)} for job #${number}'s completed diagnostic.`);
    if (held) return { ...held, record: { jobId } };
    const result = await collectDiagnosticPayment({ organizationId, jobId, via: "mcp", actorId: input.actorUserId, actor: { role: input.actorRole, canBill } });
    return result.ok ? { text: result.message, record: { jobId } } : { isError: true, text: `${result.message} Nothing was charged.` };
  }

  const token = await bookingToken(database, organizationId, jobId);
  if (!token) return { isError: true, text: `Job #${number} has no online booking to send a link for. Nothing was sent.` };

  if (input.name === "send_payment_method_setup_link") {
    const held = gate(args, `Text and email the customer for job #${number} the secure link to authorize a saved payment method. Nothing is charged.`);
    if (held) return held;
    const sent = await sendSetupRequest(token);
    return sent.sent ? { text: "Secure setup link sent." } : { isError: true, text: "The link could not be sent." };
  }

  if (input.name === "send_payment_recovery_link") {
    const held = gate(args, `Text and email the customer for job #${number} a secure link to update their payment method and pay the completed diagnostic.`);
    if (held) return held;
    const sent = await sendRecoveryLink(token);
    return sent.sent ? { text: "Secure payment link sent." } : { isError: true, text: `${sent.reason ?? "The link could not be sent."} Nothing was sent.` };
  }

  return { isError: true, text: `Unknown tool: ${input.name}` };
}
