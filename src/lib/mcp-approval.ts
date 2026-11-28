/**
 * Which ChatGPT (MCP) tool calls need a person to approve them in Volteira.
 *
 * A tool that reaches a customer or moves money used to run as soon as the
 * model passed `confirmed: true`, a flag the model sets itself. Now such a call
 * is recorded as a supervised proposal of type "chatgpt_tool" and runs only
 * after the owner approves it in Volteira's AI approval inbox (compliance
 * findings SEC-007-008/009, FED-010-003). Internal edits (customers, jobs,
 * scope, materials, business hours) keep the existing confirmation step.
 *
 * Free of imports, so the rules are tested directly.
 */

/** Tools that always reach a customer or touch money when confirmed. */
export const APPROVAL_TOOLS: ReadonlySet<string> = new Set([
  // Messages to the customer
  "send_text",
  "send_estimate",
  "send_invoice",
  "send_contract_for_signature",
  "send_paid_invoice",
  // Money
  "create_invoice",
  "bill_job",
  "mark_invoice_paid",
  "set_invoice_discount",
  "close_out_job",
  // Deferred diagnostic payments (mcp-diagnostic-payment-tools.ts)
  "complete_diagnostic",
  "collect_diagnostic_payment",
  "send_payment_method_setup_link",
  "send_payment_recovery_link",
  // Purchases
  "prepare_supplier_order",
  "submit_supplier_order",
  // Telling the customer their job is off
  "cancel_job",
]);

/**
 * Whether this call must wait for approval in Volteira instead of running.
 * Only a confirmed call: an unconfirmed one already changes nothing and just
 * returns the proposal for the person to look at.
 */
export function needsVolteiraApproval(name: string, args: Record<string, unknown>): boolean {
  if (args.confirmed !== true) return false;
  // These two only reach the customer in some cases.
  if (name === "reschedule_job") return args.tell_customer === true;
  if (name === "update_job_status") return args.step === "on_the_way";
  return APPROVAL_TOOLS.has(name);
}

const GATE = /^CONFIRMATION REQUIRED\.\s*(?:Nothing (?:was|has been) (?:changed|sent)[^.]*\.\s*)?(?:Proposed action:\s*)?/i;

/**
 * The plain description of what a tool would do, from the reply it gives when
 * called without `confirmed`. Null when the reply is not a confirmation
 * request (an error, or a tool that ran without asking): then nothing is
 * proposed.
 */
export function proposalFromPreview(previewText: string): string | null {
  const textValue = previewText.trim();
  if (!GATE.test(textValue)) return null;
  const described = textValue.replace(GATE, "").trim();
  return described || null;
}

/** The call's arguments as they will be replayed after approval: without `confirmed`, keys sorted. */
export function approvalArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(args).sort()) {
    if (key === "confirmed") continue;
    out[key] = args[key];
  }
  return out;
}

/**
 * One proposal per connection, tool, arguments and day: asking twice for the
 * same thing on the same day returns the first proposal instead of queueing a
 * duplicate. `argsHash` is a hash of `approvalArgs`.
 */
export function approvalIdempotencyKey(credentialId: string, name: string, argsHash: string, now: Date): string {
  return `chatgpt-tool:${credentialId}:${name}:${argsHash}:${now.toISOString().slice(0, 10)}`;
}

/** What ChatGPT is told after a confirmed call was queued for approval. */
export function awaitingApprovalText(proposal: string, status: string): string {
  if (status && status !== "pending") {
    return `This exact request was already made today and is ${status.replace(/_/g, " ")} in Volteira's AI approval inbox. Nothing new was queued: ${proposal}`;
  }
  return [
    "WAITING FOR APPROVAL IN VOLTEIRA. Nothing has been sent or changed yet.",
    `Requested: ${proposal}`,
    "The owner approves or rejects it in Volteira → Operations (AI approval inbox); it runs once approved.",
    "Tell the user that, and do not call this tool again for the same action.",
  ].join("\n");
}
