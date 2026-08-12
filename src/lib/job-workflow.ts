/**
 * One job, one place that knows what happens next.
 *
 * The database has twelve status strings and they were written out by hand in
 * five places: a dropdown of seven in the edit form, an array of four in the
 * status strip, a validation set in the actions, a display map in job-data, and
 * a colour map in the badge. So "arrived" was a button on one screen, an option
 * on another, and the words "In progress" everywhere it was actually read —
 * which is why a technician could set it and see nothing change.
 *
 * The twelve statuses stay: they are what the schedule, the dashboard and the
 * booking flow already write. What is new is that a screen no longer chooses
 * from them. It asks this module what state the job is in and what the single
 * next step is, and gets one answer.
 *
 * Import-free, so the transitions can be tested without a database.
 */

/**
 * Where a job is, from the point of view of somebody doing it.
 *
 * `no_show` is not in the flow and is not dropped either — the database allows
 * it, the edit form offers it, and a job marked no-show that still offered
 * "Start trip" would send somebody back to a house nobody answered.
 */
export const WORKFLOW_STATES = [
  "scheduled",
  "en_route",
  "arrived",
  "working",
  "review",
  "completed",
  "canceled",
  "no_show",
] as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[number];

/**
 * The stored status behind each state.
 *
 * `review` maps to `needs_review`, which has been a legal status since the
 * foundation migration and was never written by anything. It is exactly this:
 * the work is done and nobody has signed it off.
 */
const STATUS_FOR_STATE: Record<WorkflowState, string> = {
  scheduled: "confirmed",
  en_route: "en_route",
  arrived: "arrived",
  working: "in_progress",
  review: "needs_review",
  completed: "completed",
  canceled: "canceled",
  no_show: "no_show",
};

/**
 * Every stored status, read as a state.
 *
 * The scheduled bucket is wide on purpose: draft, awaiting payment, confirmed,
 * assigned and rescheduled differ in ways an office cares about and in no way
 * that changes what the person driving there does next.
 */
const STATE_FOR_STATUS: Record<string, WorkflowState> = {
  draft: "scheduled",
  awaiting_payment: "scheduled",
  confirmed: "scheduled",
  assigned: "scheduled",
  rescheduled: "scheduled",
  en_route: "en_route",
  arrived: "arrived",
  in_progress: "working",
  needs_review: "review",
  completed: "completed",
  canceled: "canceled",
  no_show: "no_show",
};

export function workflowStateOf(status: string): WorkflowState {
  return STATE_FOR_STATUS[status] ?? "scheduled";
}

export function jobStatusFor(state: WorkflowState): string {
  return STATUS_FOR_STATE[state];
}

export function isWorkflowState(value: unknown): value is WorkflowState {
  return typeof value === "string" && value in STATUS_FOR_STATE;
}

/**
 * What may follow what.
 *
 * Three of these are not the happy path and are here because the field is not.
 * `scheduled → arrived` is somebody who was already outside the house when they
 * opened the app. `scheduled → working` and `en_route → working` are somebody
 * who got on with it without ever being marked arrived — which is most people,
 * most days. All three used to be dead ends that could only be escaped through
 * the status dropdown, and the screen confirms the skipped arrival before
 * taking either of the last two.
 *
 * `review → working` goes backwards on purpose. Remembering a part after
 * tapping Finish job is ordinary, and a one-way door there means the line gets
 * added to the next job or to nothing.
 */
const TRANSITIONS: Record<WorkflowState, readonly WorkflowState[]> = {
  scheduled: ["en_route", "arrived", "working", "canceled", "no_show"],
  en_route: ["arrived", "working", "canceled", "no_show"],
  arrived: ["working", "canceled", "no_show"],
  working: ["review", "canceled"],
  review: ["completed", "working"],
  completed: [],
  canceled: [],
  no_show: [],
};

export function canAdvance(from: WorkflowState, to: WorkflowState): boolean {
  return TRANSITIONS[from].includes(to);
}

export type WorkflowStep = {
  /** The state the primary button moves the job to. */
  to: WorkflowState;
  /** What the button says. Electrician's words, not the database's. */
  label: string;
  /** What is happening while it saves. */
  pendingLabel: string;
};

/**
 * The one action worth showing.
 *
 * Null when there is nothing to do next — a completed, canceled or no-show job.
 * The screen shows no primary button at all rather than a disabled one, because
 * a greyed-out button is a thing people tap twice before reading why.
 */
export function nextStep(state: WorkflowState): WorkflowStep | null {
  switch (state) {
    case "scheduled":
      return { to: "en_route", label: "Start trip", pendingLabel: "Starting…" };
    case "en_route":
      // The button is Navigate while driving; arriving is meant to happen by
      // itself. This is the fallback, offered small, for when it does not.
      return { to: "arrived", label: "Mark arrived", pendingLabel: "Saving…" };
    case "arrived":
      return { to: "working", label: "Start work", pendingLabel: "Starting…" };
    case "working":
      return { to: "review", label: "Finish job", pendingLabel: "Finishing…" };
    case "review":
      return { to: "completed", label: "Review & complete", pendingLabel: "Completing…" };
    default:
      return null;
  }
}

/**
 * The state, in the two or three words that go above the action.
 *
 * One indicator per screen. The old page showed a badge, a lit button in a row
 * of four, and a selected option in a dropdown — three claims about the same
 * fact, which is three chances to disagree.
 */
export function stateLabel(state: WorkflowState): string {
  switch (state) {
    case "scheduled":
      return "Scheduled";
    case "en_route":
      return "On my way";
    case "arrived":
      return "Arrived";
    case "working":
      return "Working";
    case "review":
      return "Ready to complete";
    case "completed":
      return "Completed";
    case "canceled":
      return "Canceled";
    case "no_show":
      return "No-show";
  }
}

/** How loudly the state should be drawn. Tokens, not colours. */
export function stateTone(state: WorkflowState): "brand" | "positive" | "critical" | "muted" {
  switch (state) {
    case "en_route":
    case "arrived":
    case "working":
      return "brand";
    case "review":
    case "completed":
      return "positive";
    case "canceled":
    case "no_show":
      return "critical";
    default:
      return "muted";
  }
}

/** A job nobody is going to work on: nothing to start, nothing to finish. */
export function isClosed(state: WorkflowState): boolean {
  return state === "completed" || state === "canceled" || state === "no_show";
}

/**
 * Whether the workspace — hours, parts, photos, notes — should be on screen.
 *
 * Hidden before the technician is anywhere near the property. Somebody
 * scrolling past four empty forms to find the address is the thing this whole
 * redesign is against, and none of those four can be filled in from a van.
 *
 * Shown from `arrived` rather than from `working`, because a photo of the panel
 * as found is taken before anything is touched.
 */
export function showsWorkspace(state: WorkflowState): boolean {
  return state === "arrived" || state === "working" || state === "review" || state === "completed";
}

/**
 * Whether arrival is still being watched for.
 *
 * The only state that runs the device's location, and the reason this is a
 * function rather than a comment: it is read by the component that starts the
 * watch and by the one that stops it, and the two disagreeing is how an app
 * ends up tracking somebody all afternoon.
 */
export function watchesForArrival(state: WorkflowState): boolean {
  return state === "en_route";
}
