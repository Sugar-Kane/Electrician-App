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
};

/**
 * The single primary action.
 *
 * - `visit`: the visit card's own button is the action (Start trip, Start
 *   work, Finish job…). The label is what that button says, so the summary and
 *   the button agree; nothing else is drawn as primary.
 * - `go`: a section of this page, or another page, that finishes the step.
 * - `materials_ready`: one tap, done in place.
 * - `none`: nothing is left to do.
 */
export type PrimaryAction =
  | { kind: "visit"; label: string; href: string }
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
  partCount: number;
  /** Items on the materials list, priced or not. */
  materialListCount: number;
  /** Items on the materials list with no store price matched yet. */
  unpricedMaterialCount: number;
  materialsReady: boolean;
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

function steps(flow: JobFlow, current: StageKey, finished: boolean): StageStep[] {
  const order: StageKey[] =
    flow === "diagnostic"
      ? ["intake", "schedule", "travel", "diagnose", "decide", "invoice", "paid"]
      : ["scope", "quotes", "estimate", "approval", "materials", "schedule", "work", "invoice", "paid"];
  const labels: Record<StageKey, string> = {
    intake: "Intake",
    schedule: "Schedule",
    travel: "Travel",
    diagnose: "Diagnose",
    decide: "Next step",
    scope: "Scope",
    quotes: "Quotes",
    estimate: "Estimate",
    approval: "Approval",
    materials: "Materials",
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
    const decide = flow === "diagnostic" && ON_SITE.has(state) && input.followUpCount === 0;
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
            ? "Write down what you found, with photos, then choose what happens next."
            : flow === "diagnostic" && state === "arrived"
              ? "Confirm the problem with the customer before you start."
              : "",
      needsDecision: decide && state !== "arrived",
    };
  }

  if (flow === "diagnostic") {
    if (state === "completed") {
      const money = billing(input.progress);
      // What was found still has to be decided on, unless the customer has
      // already paid or a repair was booked.
      if (input.followUpCount === 0 && !money.paid && !input.progress.some((s) => s.key === "invoice" && s.state === "done")) {
        return {
          flow,
          steps: steps(flow, "decide", false),
          status: "Diagnosed",
          primary: go("Select next action", "#next-action"),
          hint: "Repair now, send an estimate, book a return visit, or bill the diagnostic only.",
          needsDecision: true,
        };
      }
      return {
        flow,
        steps: steps(flow, money.key, money.paid),
        status: money.status,
        primary: money.primary,
        hint: money.hint,
        needsDecision: false,
      };
    }
    if (!input.scheduled) {
      return {
        flow,
        steps: steps(flow, "schedule", false),
        status: "Needs a time",
        primary: go("Schedule visit", input.scheduleHref),
        hint: "Set the arrival window, then the customer is told.",
        needsDecision: false,
      };
    }
    return {
      flow,
      steps: steps(flow, "travel", false),
      status: "Scheduled",
      primary: { kind: "visit", label: "Start trip", href: "#work" },
      hint: "The customer is texted that you are on the way.",
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

  const signed = Boolean(input.agreement?.signed);
  const sent = Boolean(input.agreement?.sent);

  // Scope: nothing on the job, and no list to start from.
  if (input.lineCount === 0 && input.materialListCount === 0) {
    return {
      flow,
      steps: steps(flow, "scope", false),
      status: "Scope",
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
      hint: "Put the priced list on the job to make the estimate.",
      needsDecision: false,
    };
  }
  if (!signed) {
    return {
      flow,
      steps: steps(flow, sent ? "approval" : "estimate", false),
      status: sent ? "Awaiting approval" : "Estimate",
      primary: sent ? go("View approval", "#contract") : go("Send estimate", "#contract"),
      hint: sent
        ? "Waiting for the customer to sign. Resend it, or have them sign in person."
        : "The customer approves the price before the work is booked.",
      needsDecision: false,
    };
  }
  if (input.partCount > 0 && !input.materialsReady) {
    return {
      flow,
      steps: steps(flow, "materials", false),
      status: "Materials",
      primary: { kind: "materials_ready", label: "Mark materials ready" },
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
}
