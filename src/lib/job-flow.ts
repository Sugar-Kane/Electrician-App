/**
 * Where a job stands in its own flow, and the one thing to do next.
 *
 * A diagnostic and a work order are different jobs. A diagnostic is a visit to
 * find the fault: Intake · Schedule · Travel · Diagnose · Next step · Invoice ·
 * Paid, and the question at the end of it is what to do about what was found.
 * A work order is agreed work: Scope · Quotes · Estimate · Approval ·
 * Materials · Schedule · Work · Invoice · Paid, and nobody drives out until the scope is
 * priced, approved and the materials are in hand (or somebody says otherwise).
 *
 * Everything is read off what the job page already loads: the visit's state,
 * the six billing steps `jobProgress` works out, the lines, the agreement and
 * the work orders booked from a diagnostic. Nothing new is stored.
 *
 * Import-free, so it can be tested without a database.
 */

import type { ProgressStep, StepAction } from "./job-progress.ts";

export type JobFlow = "diagnostic" | "work_order";

export type StageKey =
  | "intake"
  | "schedule"
  | "travel"
  | "diagnose"
  | "decide"
  | "scope"
  | "quotes"
  | "estimate"
  | "approval"
  | "materials"
  | "work"
  | "invoice"
  | "paid";

export type StageStep = {
  key: StageKey;
  label: string;
  state: "done" | "current" | "todo";
  /**
   * Part done, as a share of the bar: the contract sent but not signed and the
   * invoice sent but not paid are a half; Materials goes in thirds (listed,
   * priced, picked up).
   */
  fill?: number;
};

/**
 * The single primary action.
 *
 * - `visit`: the visit card's own button is the action (Start trip, Start
 *   work, Finish job…). The label is what that button says, so the summary and
 *   the button agree; nothing else is drawn as primary.
 * - `go`: a section of this page, or another page, that finishes the step.
 * - `materials_ready`: one tap, done in place.
 * - `fee_invoice`: one tap: the diagnostic fee is invoiced and sent.
 * - `none`: nothing is left to do.
 */
export type PrimaryAction =
  | { kind: "visit"; label: string; href: string }
  | { kind: "fee_invoice"; label: string }
  | { kind: "go"; label: string; href: string }
  | { kind: "materials_ready"; label: string }
  | { kind: "none"; label: string };

export type FlowStage = {
  flow: JobFlow;
  steps: StageStep[];
  /** The two or three words for where the job is: "Scheduled", "Scope", "Awaiting approval". */
  status: string;
  primary: PrimaryAction;
  /** One short line under the action: why it is next, or what may be done instead. */
  hint: string;
  /** A diagnostic whose findings still need a decision: repair, estimate, return or bill. */
  needsDecision: boolean;
};

export type StageInput = {
  kindOfWork: string;
  workflowState: string;
  /** The job has a start time. */
  scheduled: boolean;
  scheduleHref: string;
  /** The six billing steps for the same job, from `jobProgress`. */
  progress: ProgressStep[];
  /** Lines of any kind (labor, material, fee) on the job. */
  lineCount: number;
  /** A diagnostic's own fee is still owed: it has one, it was not paid at booking, and it is not a follow-up. */
  diagnosticFeeDue?: boolean;
  /** Where the diagnostic's own fee invoice stands (diagnostic-outcome.ts `feeInvoiceStanding`). */
  feeInvoice?: "to_bill" | "billed_unpaid" | "paid" | "none";
  /** "$180.00": the fee, for the button that bills it. */
  feeLabel?: string;
  /** Lines other than the diagnostic fee: a repair done on site. Defaults to `lineCount`. */
  repairLineCount?: number;
  /** "$1,590.14": what the priced work comes to, said as the estimate. */
  estimateLabel?: string;
  partCount: number;
  /** Items on the materials list, priced or not. */
  materialListCount: number;
  /** Items on the materials list with no store price matched yet. */
  unpricedMaterialCount: number;
  materialsReady: boolean;
  /** The parts were bought (picked up counts as bought). */
  materialsBought?: boolean;
  agreement: { sent: boolean; signed: boolean } | null;
  /** Work orders booked from this diagnostic. */
  followUpCount: number;
  canceled: boolean;
};

const VISIT_LABELS: Record<JobFlow, Record<string, { label: string; status: string }>> = {
  diagnostic: {
    scheduled: { label: "Start trip", status: "Scheduled" },
    en_route: { label: "I've arrived", status: "Traveling" },
    arrived: { label: "Start diagnostic", status: "On site" },
    working: { label: "Finish diagnostic", status: "Diagnosing" },
    review: { label: "Review & complete", status: "Wrapping up" },
  },
  work_order: {
    scheduled: { label: "Start trip", status: "Scheduled" },
    en_route: { label: "I've arrived", status: "Traveling" },
    arrived: { label: "Begin work", status: "On site" },
    working: { label: "Finish work", status: "In progress" },
    review: { label: "Review completion", status: "Wrapping up" },
  },
};

/** What the visit card's primary button says, per flow and state. */
export function visitActionLabel(flow: JobFlow, workflowState: string): string | null {
  return VISIT_LABELS[flow][workflowState]?.label ?? null;
}

const UNDER_WAY = new Set(["en_route", "arrived", "working", "review"]);
const ON_SITE = new Set(["arrived", "working", "review"]);

function go(label: string, href: string): PrimaryAction {
  return { kind: "go", label, href };
}

function fromStepAction(action: StepAction | null, fallback: string): PrimaryAction {
  if (!action) return { kind: "none", label: fallback };
  if (action.kind === "materials_ready") return { kind: "materials_ready", label: action.label };
  return go(action.label, action.href);
}

/**
 * Billing, once the work is done: generate, send, collect, close.
 *
 * Read from the invoice and paid steps so the wording and the rules stay the
 * ones the billing section already follows.
 */
function billing(progress: ProgressStep[]): { primary: PrimaryAction; status: string; hint: string; paid: boolean; key: StageKey } {
  const invoice = progress.find((step) => step.key === "invoice");
  const paid = progress.find((step) => step.key === "paid");
  if (invoice && invoice.state !== "done" && invoice.state !== "skipped") {
    const generate = invoice.action?.kind === "go" && /generate/i.test(invoice.action.label);
    return {
      primary: fromStepAction(invoice.action, "Generate invoice"),
      status: generate ? "Ready to invoice" : "Invoice draft",
      hint: invoice.note,
      paid: false,
      key: "invoice",
    };
  }
  if (paid && paid.state === "current") {
    return { primary: fromStepAction(paid.action, "Record payment"), status: "Invoiced", hint: paid.note, paid: false, key: "paid" };
  }
  if (paid && paid.state === "done") {
    return { primary: { kind: "none", label: "Job closed" }, status: "Paid", hint: "Paid in full. Nothing left to do.", paid: true, key: "paid" };
  }
  return {
    primary: go("Generate invoice", "#billing"),
    status: "Ready to invoice",
    hint: paid?.note ?? "No invoice yet",
    paid: false,
    key: "invoice",
  };
}

/*
 * The steps on the bar. Paying is the second half of the Invoice step (sent,
 * then paid) and signing the second half of the Contract step (sent, then
 * signed), so neither has a segment of its own; `paid` as the current stage
 * means the Invoice step.
 */
function steps(flow: JobFlow, current: StageKey, finished: boolean): StageStep[] {
  const order: StageKey[] =
    flow === "diagnostic"
      ? ["intake", "schedule", "travel", "diagnose", "decide", "invoice"]
      : ["scope", "estimate", "approval", "schedule", "work", "invoice"];
  if (current === "paid") current = "invoice";
  // The list, its quotes and picking the parts up are one Materials step.
  if (current === "quotes") current = "scope";
  if (current === "materials") {
    // Picking up comes after the contract: everything before Schedule is
    // done except Materials, which is the step being worked.
    return steps(flow, "schedule", finished).map((step) =>
      step.key === "scope" ? { ...step, state: "current" as const } : step.key === "schedule" ? { ...step, state: "todo" as const } : step,
    );
  }
  const labels: Record<StageKey, string> = {
    intake: "Intake",
    schedule: "Schedule",
    travel: "Travel",
    diagnose: "Diagnose",
    decide: "Next step",
    scope: "Materials",
    quotes: "Supplier quotes",
    estimate: "Estimate",
    approval: "Contract",
    materials: "Pick up parts",
    work: "Work",
    invoice: "Invoice",
    paid: "Paid",
  };
  const at = order.indexOf(current);
  return order.map((key, index) => ({
    key,
    label: labels[key],
    state: finished || index < at ? "done" : index === at ? "current" : "todo",
  }));
}

export function jobFlow(input: StageInput): FlowStage {
  const stage = flowOf(input);
  const invoiceStep = input.progress.find((step) => step.key === "invoice");
  const paidStep = input.progress.find((step) => step.key === "paid");
  const invoiceSent = invoiceStep?.state === "done" || (paidStep !== undefined && paidStep.state !== "todo");
  const invoicePaid = paidStep?.state === "done";
  const contractSent = Boolean(input.agreement?.sent) || Boolean(input.agreement?.signed);
  const contractSigned = Boolean(input.agreement?.signed);
  // Materials in thirds: listed (and priced, which happen together), bought,
  // picked up. Labor only has nothing to buy, so listed is the whole step.
  const listed = input.materialListCount > 0 || input.lineCount > 0;
  const nothingToBuy = input.lineCount > 0 && input.partCount === 0;
  const pickedUp = input.materialsReady || nothingToBuy;
  const bought = Boolean(input.materialsBought) || pickedUp;
  const materialsShare = listed && pickedUp ? 1 : listed && bought ? 2 / 3 : listed ? 1 / 3 : 0;
  const partly = (step: StageStep, share: number): StageStep => ({
    ...step,
    // Part filled, and current only if the flow is on it: an invoice sent
    // ahead of the contract is not the step being worked.
    state: step.state === "current" ? "current" : "todo",
    fill: share,
  });
  return {
    ...stage,
    steps: stage.steps.map((step) => {
      // Sent fills half the bar; paid or signed fills the rest.
      if (step.key === "invoice") {
        if (invoicePaid) return { ...step, state: "done" as const, fill: undefined };
        if (invoiceSent) return partly(step, 1 / 2);
      }
      if (step.key === "approval") {
        if (contractSigned) return { ...step, state: "done" as const, fill: undefined };
        if (contractSent) return partly(step, 1 / 2);
      }
      if (step.key === "scope" && stage.flow === "work_order") {
        if (materialsShare === 1) return { ...step, state: "done" as const, fill: undefined };
        if (materialsShare > 0) return partly(step, materialsShare);
        return step;
      }
      return step;
    }),
  };
}

function flowOf(input: StageInput): FlowStage {
  const flow: JobFlow = input.kindOfWork === "Diagnostic" ? "diagnostic" : "work_order";
  const state = input.workflowState;

  if (input.canceled || state === "canceled") {
    return {
      flow,
      steps: steps(flow, flow === "diagnostic" ? "intake" : "scope", false),
      status: "Canceled",
      primary: { kind: "none", label: "Canceled" },
      hint: "",
      needsDecision: false,
    };
  }

  // The visit itself: whatever else is open, a technician on the road or on
  // site has one thing to do, and it is the visit card's button.
  if (UNDER_WAY.has(state)) {
    const visit = VISIT_LABELS[flow][state];
    // Decided once anything is on the job to bill here (the fee, or a repair
    // done on site) or the bigger job is booked as a work order.
    const decide =
      flow === "diagnostic" && ON_SITE.has(state) && input.followUpCount === 0 && (input.repairLineCount ?? input.lineCount) === 0;
    return {
      flow,
      steps: steps(flow, flow === "work_order" ? "work" : state === "en_route" ? "travel" : "diagnose", false),
      status: visit.status,
      // Where the step's result shows: the findings and work once work starts,
      // the visit card for everything else.
      primary: { kind: "visit", label: visit.label, href: state === "arrived" ? "#findings" : "#work" },
      hint:
        state === "en_route"
          ? "Arrival is marked automatically when you get there."
          : flow === "diagnostic" && state === "working"
            ? decide
              ? "Write down what you found, then choose below: diagnostic only, fix it now, or schedule the bigger job."
              : "Write down what you found, with photos."
            : flow === "diagnostic" && state === "arrived"
              ? "Confirm the problem with the customer before you start."
              : "",
      needsDecision: decide && state !== "arrived",
    };
  }

  if (flow === "diagnostic") {
    if (state === "completed") {
      const money = billing(input.progress);
      // Something to bill on this job: the fee, a repair done on site, or both.
      if (input.lineCount > 0 || money.paid || input.progress.some((s) => s.key === "invoice" && s.state === "done")) {
        return {
          flow,
          steps: steps(flow, money.key, money.paid),
          status: money.status,
          primary: money.primary,
          hint: money.hint,
          needsDecision: false,
        };
      }
      // The bigger job is booked as a work order, and the fee was paid when
      // they booked (or there is none): nothing is billed on this visit.
      if (input.followUpCount > 0 && !input.diagnosticFeeDue) {
        return {
          flow,
          steps: steps(flow, "paid", true),
          status: "Work order booked",
          primary: { kind: "none", label: "Diagnostic closed" },
          hint: "The repair is its own work order. Nothing more to bill on this visit.",
          needsDecision: false,
        };
      }
      // Still to decide, while the fee is owed: diagnostic only, fix it now, or
      // the bigger job as a work order.
      if (input.diagnosticFeeDue) {
        return {
          flow,
          steps: steps(flow, "decide", false),
          status: "Diagnosed",
          primary: go("Select next action", "#next-action"),
          hint: "Diagnostic only, fix it now, or schedule the bigger job as a work order.",
          needsDecision: true,
        };
      }
      return {
        flow,
        steps: steps(flow, "paid", true),
        status: "Paid",
        primary: { kind: "none", label: "Diagnostic closed" },
        hint: "The diagnostic was paid when they booked. Nothing more to bill.",
        needsDecision: false,
      };
    }
    // The fee first: a diagnostic added by hand has not been paid for yet,
    // and it is collected before anybody drives out.
    if (input.feeInvoice === "to_bill") {
      return {
        flow,
        steps: steps(flow, "intake", false),
        status: "Fee not sent",
        primary: { kind: "fee_invoice", label: `Send diagnostic fee invoice${input.feeLabel ? ` (${input.feeLabel})` : ""}` },
        hint: "Texted and emailed to the customer with a link to pay. Then schedule the visit.",
        needsDecision: false,
      };
    }
    const feeOut = input.feeInvoice === "billed_unpaid";
    if (!input.scheduled) {
      return {
        flow,
        steps: steps(flow, "schedule", false),
        status: feeOut ? "Needs a time · fee unpaid" : "Needs a time",
        primary: go("Schedule visit", input.scheduleHref),
        hint: feeOut
          ? "The fee invoice is out, not paid yet. Set the arrival window, then the customer is told."
          : "Set the arrival window, then the customer is told.",
        needsDecision: false,
      };
    }
    return {
      flow,
      steps: steps(flow, "travel", false),
      status: feeOut ? "Scheduled · fee unpaid" : "Scheduled",
      primary: { kind: "visit", label: "Start trip", href: "#work" },
      hint: feeOut
        ? "The fee invoice is not paid yet. The customer is texted that you are on the way."
        : "The customer is texted that you are on the way.",
      needsDecision: false,
    };
  }

  // A work order.
  if (state === "completed") {
    const money = billing(input.progress);
    return {
      flow,
      steps: steps(flow, money.key, money.paid),
      status: money.status,
      primary: money.primary,
      hint: money.hint,
      needsDecision: false,
    };
  }

  /*
   * An invoice can go out before the work, and before the customer has
   * signed. Approval still comes first: nothing moves past it until the
   * customer signs. Once signed, collecting is next if it is unpaid, then the
   * visit. Either way the Invoice and Paid steps show what has really
   * happened, so Nick can see where the job stands.
   */
  const invoiceStep = input.progress.find((step) => step.key === "invoice");
  const paidStep = input.progress.find((step) => step.key === "paid");
  const invoiced = invoiceStep?.state === "done" || (paidStep !== undefined && paidStep.state !== "todo");
  const paidUp = paidStep?.state === "done";
  const signed = Boolean(input.agreement?.signed);
  const sent = Boolean(input.agreement?.sent);

  if (invoiced && signed && !paidUp) {
    const money = billing(input.progress);
    // The billing steps are done; the visit's are as they really are.
    const still = (key: StageKey) =>
      key === "work" ||
      (key === "schedule" && !input.scheduled) ||
      (key === "materials" && input.partCount > 0 && !input.materialsReady);
    return {
      flow,
      steps: steps(flow, money.key, false).map((step) => (still(step.key) ? { ...step, state: "todo" as const } : step)),
      status: money.status,
      primary: money.primary,
      hint: input.scheduled ? `${money.hint}. The visit is still booked.` : money.hint,
      needsDecision: false,
    };
  }

  const next = ((): FlowStage => {

    // Scope: nothing on the job, and no list to start from.
    if (input.lineCount === 0 && input.materialListCount === 0) {
      return {
        flow,
        steps: steps(flow, "scope", false),
        status: "Materials list",
        primary: go("Build material list", "#work-materials"),
        hint: "List the parts and labor, or type them in yourself.",
        needsDecision: false,
      };
    }
    // A list with items nobody has priced yet.
    if (input.lineCount === 0 && input.unpricedMaterialCount > 0) {
      return {
        flow,
        steps: steps(flow, "quotes", false),
        status: "Quotes needed",
        primary: go("Get supplier quotes", "#work-materials"),
        hint: `${input.unpricedMaterialCount} ${input.unpricedMaterialCount === 1 ? "item has" : "items have"} no price yet.`,
        needsDecision: false,
      };
    }
    if (input.lineCount === 0) {
      return {
        flow,
        steps: steps(flow, "estimate", false),
        status: "Estimate",
        primary: go("Add work & materials", "#work-materials"),
        hint: "Put the priced list on the job: its total is the estimate.",
        needsDecision: false,
      };
    }
    if (!signed) {
      // Invoiced or not, nothing moves past approval until the customer signs.
      // An invoice already out is said, so Nick knows where the job stands.
      const owed = paidUp ? "The invoice is paid" : `The invoice is out (${(paidStep?.note ?? "waiting for payment").toLowerCase()})`;
      return {
        flow,
        steps: steps(flow, "approval", false),
        status: invoiced
          ? sent
            ? "Invoiced · contract not signed"
            : "Invoiced · contract not sent"
          : sent
            ? "Contract sent · awaiting signature"
            : "Send contract",
        primary: sent ? go("View contract", "#contract") : go("Send contract", "#contract"),
        hint: invoiced
          ? `${owed}, but the customer has not signed the contract yet. Get it signed before the work goes ahead.`
          : sent
            ? "Waiting for the customer to sign. Resend it, or have them sign in person."
            : input.estimateLabel
              ? `Estimate: ${input.estimateLabel}. The customer signs the contract for it before the work is booked.`
              : "The customer signs the contract for the price before the work is booked.",
        needsDecision: false,
      };
    }
    if (input.partCount > 0 && !input.materialsReady) {
      return {
        flow,
        steps: steps(flow, "materials", false),
        status: "Pick up parts",
        primary: { kind: "materials_ready", label: "Mark picked up" },
        hint: input.scheduled
          ? "Have the parts in hand before you drive out. You can still start the trip if they are on the truck."
          : "Have the parts in hand, then book the visit.",
        needsDecision: false,
      };
    }
    if (!input.scheduled) {
      return {
        flow,
        steps: steps(flow, "schedule", false),
        status: "Ready to schedule",
        primary: go("Confirm appointment", input.scheduleHref),
        hint: "Approved and ready. Set the arrival window.",
        needsDecision: false,
      };
    }
    return {
      flow,
      steps: steps(flow, "work", false),
      status: "Scheduled",
      primary: { kind: "visit", label: "Start trip", href: "#work" },
      hint: "Approved, and the materials are ready.",
      needsDecision: false,
    };
  })();

  // Steps done out of order show as done: parts already picked up, a visit
  // already booked, an invoice already out or paid. The current step and the
  // one action stay where the flow puts them.
  const doneEarly = (key: StageKey) =>
    (key === "materials" && input.materialsReady && input.partCount > 0) ||
    (key === "schedule" && input.scheduled) ||
    (invoiced && key === "invoice") ||
    (paidUp && key === "paid");
  return {
    ...next,
    steps: next.steps.map((step) => (step.state === "todo" && doneEarly(step.key) ? { ...step, state: "done" as const } : step)),
  };
}
