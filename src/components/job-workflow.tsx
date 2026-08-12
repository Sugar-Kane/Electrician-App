"use client";

import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Check,
  LoaderCircle,
  MessageSquare,
  Navigation,
  Phone,
  Radar,
  TriangleAlert,
} from "lucide-react";

import { advanceJob, type WorkflowActionState } from "@/app/jobs/[jobId]/workflow-actions";
import {
  describeArrivalError,
  evaluateArrival,
  formatDistance,
  IDLE_WATCH,
  type ArrivalWatchState,
  type Coordinates,
} from "@/lib/arrival";
import { nextStep, stateLabel, watchesForArrival, type WorkflowState } from "@/lib/job-workflow";

/**
 * The one thing to do next, and the app noticing when it has been done.
 *
 * This replaces a row of four buttons — On my way, Arrived, Working, Complete —
 * that were on screen at all times. Four buttons is four decisions and three of
 * them are always wrong. Worse, it made the workflow the technician's job to
 * remember: the app knew perfectly well what came after "arrived" and asked
 * anyway.
 *
 * So there is one button, it says what happens next, and arriving is not a
 * button at all under normal conditions — the phone can tell that the van
 * stopped outside the house and stayed there.
 *
 * What none of that does is make the job depend on it. Every automatic path has
 * a tap behind it: no GPS, refused permission, an address nobody ever geocoded,
 * a detached shop half a mile down the drive. Each costs one tap and nothing
 * else, because a technician who cannot finish a job until a satellite agrees
 * with them will stop using the app by lunchtime.
 */

const initialState: WorkflowActionState = { error: "" };

/**
 * Whether this phone has agreed to automatic arrival.
 *
 * On the device rather than the account, because it is a decision about this
 * phone's location: saying yes on your own phone has not said yes on the shop
 * tablet. Written before the browser is ever asked, so "Not now" is remembered
 * even though no permission prompt was ever raised — which is the whole point
 * of asking in our own words first.
 */
const CHOICE_KEY = "volteira:auto-arrival:v1";

type Choice = "on" | "off" | null;

function readChoice(): Choice {
  try {
    const stored = window.localStorage.getItem(CHOICE_KEY);
    return stored === "on" || stored === "off" ? stored : null;
  } catch {
    // Private browsing can refuse reads. Asking again is the safe failure.
    return null;
  }
}

/**
 * The stored answer, as something React can subscribe to.
 *
 * Read through `useSyncExternalStore` rather than in an effect, because the
 * server has no localStorage: the first paint has to say "not answered" on both
 * sides or hydration mismatches, and a `useEffect` that then calls setState
 * costs a second render on every phone that has answered.
 */
const listeners = new Set<() => void>();
let cached: Choice | undefined;

function subscribeChoice(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Must be referentially stable between changes, which a string or null is. */
function choiceSnapshot(): Choice {
  if (cached === undefined) cached = readChoice();
  return cached;
}

function serverChoiceSnapshot(): Choice {
  return null;
}

function rememberChoice(choice: Exclude<Choice, null>) {
  try {
    window.localStorage.setItem(CHOICE_KEY, choice);
  } catch {
    // The trip still works; the explainer just comes back next time.
  }
  cached = choice;
  for (const listener of listeners) listener();
}

/**
 * Whether this browser can locate itself at all.
 *
 * The server snapshot is `true` so the first paint does not flash a warning at
 * every phone that is perfectly capable. A browser without the API never fires
 * the error callback either, so without this check the screen would promise an
 * automatic arrival that nothing was watching for.
 */
const subscribeToNothing = () => () => {};
const geolocationOnClient = () =>
  typeof navigator !== "undefined" && typeof navigator.geolocation === "object";
const geolocationOnServer = () => true;

export type JobWorkflowProps = {
  jobNumber: string;
  state: WorkflowState;
  /** Null until the address has been geocoded. Never 0,0. */
  destination: Coordinates | null;
  radiusMeters: number;
  tripStartedLabel: string;
  arrivedLabel: string;
  workStartedLabel: string;
  arrivalSource: "geofence" | "manual" | "";
  customerEnRouteNotified: boolean;
  customerArrivalNotified: boolean;
  customerEnRouteMessages: boolean;
  customerArrivalMessages: boolean;
  customerReachable: boolean;
  navigateUrl: string;
  phone: string;
  /**
   * Who, what and where, rendered above the status.
   *
   * Passed in from the page rather than duplicated here so it stays one card:
   * the three facts and the one action belong to the same glance, and two
   * bordered panels stacked at the top of a phone is the pattern this redesign
   * exists to undo.
   */
  children?: React.ReactNode;
};

type Nearby = { distanceMeters: number | null; secondsRemaining: number; settling: boolean };

const PRIMARY =
  "tap-target inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-base font-bold text-on-brand disabled:opacity-60";
const SECONDARY =
  "tap-target inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-control border border-line bg-raised px-4 text-sm font-semibold disabled:opacity-60";
/**
 * A real action, said quietly.
 *
 * Deliberately not yellow. Yellow is the primary action, the current selection
 * and the workflow state, and an escape hatch used twice a month competing with
 * Start trip for the same colour is how a screen ends up with four things
 * shouting and nothing leading.
 */
const QUIET =
  "tap-target inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-muted underline underline-offset-4 disabled:opacity-60";

export function JobWorkflow({
  jobNumber,
  state,
  destination,
  radiusMeters,
  tripStartedLabel,
  arrivedLabel,
  workStartedLabel,
  arrivalSource,
  customerEnRouteNotified,
  customerArrivalNotified,
  customerEnRouteMessages,
  customerArrivalMessages,
  customerReachable,
  navigateUrl,
  phone,
  children,
}: JobWorkflowProps) {
  const [result, submit, pending] = useActionState(advanceJob, initialState);
  const [asking, setAsking] = useState(false);
  const [confirmingWork, setConfirmingWork] = useState(false);
  const [nearby, setNearby] = useState<Nearby | null>(null);
  const [locationProblem, setLocationProblem] = useState("");

  const choice = useSyncExternalStore(subscribeChoice, choiceSnapshot, serverChoiceSnapshot);
  const geolocationAvailable = useSyncExternalStore(
    subscribeToNothing,
    geolocationOnClient,
    geolocationOnServer,
  );

  // Object identity would restart the watch on every render, so the effect
  // depends on the two numbers rather than the point they make up.
  const latitude = destination?.lat ?? null;
  const longitude = destination?.lng ?? null;
  const placed = latitude !== null && longitude !== null;

  // Whether this component has already told the server about an arrival it
  // detected. Position callbacks arrive faster than a round trip, and without
  // this the same arrival is posted four times.
  const reported = useRef(false);

  const advance = useCallback(
    (to: WorkflowState, source: "manual" | "geofence") => {
      const data = new FormData();
      data.set("jobNumber", jobNumber);
      data.set("to", to);
      data.set("source", source);
      startTransition(() => submit(data));
    },
    [jobNumber, submit],
  );

  /**
   * Watching for arrival — and only while travelling.
   *
   * The effect exists in exactly one state, so leaving that state tears the
   * watch down. This is the privacy promise made concrete rather than
   * documented: there is no code path that reads this phone's location while a
   * job is scheduled, being worked on, or finished, and nothing here writes a
   * position anywhere. What survives is one timestamp saying when the geofence
   * was satisfied.
   */
  useEffect(() => {
    if (!watchesForArrival(state)) return;
    if (choice !== "on") return;
    // Both of these are said on screen rather than set here — they are facts
    // about the job and the browser, not events, and deriving them keeps this
    // effect to the one thing it subscribes to.
    if (latitude === null || longitude === null) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    const target = { lat: latitude, lng: longitude };
    let carried: ArrivalWatchState = IDLE_WATCH;
    let stopped = false;
    reported.current = false;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (stopped) return;

        const outcome = evaluateArrival({
          reading: {
            coordinates: { lat: position.coords.latitude, lng: position.coords.longitude },
            accuracyMeters: position.coords.accuracy,
            atMs: position.timestamp || Date.now(),
          },
          target,
          radiusMeters,
          previous: carried,
        });

        carried = outcome.next;
        setLocationProblem("");
        setNearby({
          distanceMeters: outcome.distanceMeters,
          secondsRemaining: outcome.secondsRemaining,
          settling: outcome.phase === "settling",
        });

        if (outcome.arrived && !reported.current) {
          reported.current = true;
          advance("arrived", "geofence");
        }
      },
      (error: GeolocationPositionError) => {
        if (stopped) return;
        setLocationProblem(describeArrivalError(error?.code));
      },
      // High accuracy because a 500m town-level fix cannot tell one house from
      // another. A fix up to fifteen seconds old is fine — nobody arrives twice
      // in fifteen seconds — and refusing one costs battery for no answer.
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    );

    return () => {
      stopped = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [state, choice, latitude, longitude, radiusMeters, advance]);

  function startTrip() {
    // Asked at the moment it becomes useful, never at signup. Somebody who has
    // already answered on this phone is not asked again.
    if (choice === null) {
      setAsking(true);
      return;
    }
    advance("en_route", "manual");
  }

  function answer(enabled: boolean) {
    rememberChoice(enabled ? "on" : "off");
    setAsking(false);
    // The trip starts either way. A permission answer is not a condition of
    // driving to a job.
    advance("en_route", "manual");
  }

  const step = nextStep(state);
  const closed = state === "completed" || state === "canceled" || state === "no_show";
  const travelling = state === "en_route";
  const dialable = phone.replace(/[^\d+]/g, "");

  /**
   * What the customer is about to be sent, before any of it happens.
   *
   * Worth one line before Start trip, because setting off is the point of no
   * return on it: a technician who did not know the customer gets a text has
   * just told somebody to expect them. Which of the two goes out is the
   * business's own switch at /settings/messages, and a customer with no phone
   * number gets neither, so all four cases are said plainly rather than
   * promising something that quietly will not happen.
   */
  const expectedTexts =
    !customerReachable
      ? ""
      : customerEnRouteMessages && customerArrivalMessages
        ? "The customer gets a text when you set off and when you arrive."
        : customerEnRouteMessages
          ? "The customer gets a text when you set off."
          : customerArrivalMessages
            ? "The customer gets a text when you arrive."
            : "";

  // Said rather than stored: an address nobody has geocoded and a browser with
  // no location API are both facts about this render, and a promise of
  // automatic arrival that nothing is watching for is the one thing this screen
  // must never make.
  const problem =
    locationProblem ||
    (!placed
      ? "This address has not been placed on a map yet, so arrival will not be picked up automatically."
      : !geolocationAvailable
        ? "This phone cannot share its location, so mark arrived when you get there."
        : "");

  return (
    <>
      <section className="rounded-panel border border-line bg-surface p-4 sm:p-5">
        {children ? <div className="mb-4">{children}</div> : null}

        <Headline
          state={state}
          arrivedLabel={arrivedLabel}
          arrivalSource={arrivalSource}
          tripStartedLabel={tripStartedLabel}
          workStartedLabel={workStartedLabel}
        />

        {asking ? (
          <PermissionExplainer onAnswer={answer} pending={pending} />
        ) : confirmingWork ? (
          <ConfirmEarlyWork
            pending={pending}
            onConfirm={() => {
              setConfirmingWork(false);
              advance("working", "manual");
            }}
            onCancel={() => setConfirmingWork(false)}
          />
        ) : (
          <>
            {travelling ? (
              <TravelStatus
                choice={choice}
                nearby={nearby}
                problem={problem}
                onEnable={() => rememberChoice("on")}
              />
            ) : null}

            {/*
              Said after the fact, never as a promise. Whether a text actually
              went depends on consent, the STOP ledger and quiet hours, all of
              which are decided at the moment of sending — so this reports what
              happened rather than what was supposed to.
            */}
            {travelling && customerEnRouteNotified ? (
              <p className="mt-3 text-sm text-ink-muted">
                The customer has been told you are on the way.
              </p>
            ) : null}

            {state === "arrived" && customerArrivalNotified ? (
              <p className="mt-3 text-sm text-ink-muted">The customer has been told you are here.</p>
            ) : null}

            {state === "scheduled" && expectedTexts ? (
              <p className="mt-3 text-sm text-ink-muted">{expectedTexts}</p>
            ) : null}

            {result.error ? (
              <p className="mt-3 flex items-start gap-2 text-sm text-critical">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {result.error}
              </p>
            ) : null}

            {!closed ? (
              <div className="mt-4 flex gap-2">
                {/*
                  Not while travelling: Navigate is the big button in the action
                  bar then, and the same control twice on one card is the kind
                  of thing that makes a screen feel busier than it is. Gone
                  entirely once arrived — directions to where you are standing.
                */}
                {state === "scheduled" ? (
                  <a
                    href={navigateUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="tap-target inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control border border-brand/40 bg-brand/[0.08] text-sm font-semibold text-brand"
                  >
                    <Navigation className="h-4 w-4" aria-hidden />
                    Navigate
                  </a>
                ) : null}

                {dialable ? (
                  <>
                    <a
                      href={`tel:${dialable}`}
                      className="tap-target inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control border border-line text-sm font-semibold"
                    >
                      <Phone className="h-4 w-4" aria-hidden />
                      Call
                    </a>
                    <a
                      href={`sms:${dialable}`}
                      className="tap-target inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control border border-line text-sm font-semibold"
                    >
                      <MessageSquare className="h-4 w-4" aria-hidden />
                      Text
                    </a>
                  </>
                ) : null}
              </div>
            ) : null}

            {/*
              The way out of the dead end. Somebody who parked, walked in and
              got on with it never tapped Start trip, and used to have no way to
              record work without first pretending to drive there.
            */}
            {state === "scheduled" || travelling ? (
              <button
                type="button"
                onClick={() => setConfirmingWork(true)}
                disabled={pending}
                className={`${QUIET} mt-3`}
              >
                Already on site? Start work
              </button>
            ) : null}
          </>
        )}
      </section>

      {step && !closed && !asking ? (
        <ActionBar
          state={state}
          step={step}
          pending={pending}
          navigateUrl={navigateUrl}
          onAdvance={() => (state === "scheduled" ? startTrip() : advance(step.to, "manual"))}
        />
      ) : null}
    </>
  );
}

/**
 * One status, said once.
 *
 * The old page said it three times — a badge, a lit button among four, and a
 * selected option in a dropdown — which is three chances to disagree with
 * itself, and it took them.
 */
function Headline({
  state,
  arrivedLabel,
  arrivalSource,
  tripStartedLabel,
  workStartedLabel,
}: {
  state: WorkflowState;
  arrivedLabel: string;
  arrivalSource: "geofence" | "manual" | "";
  tripStartedLabel: string;
  workStartedLabel: string;
}) {
  const arrived = state === "arrived";
  const tone =
    state === "completed" || arrived
      ? "text-positive"
      : state === "canceled" || state === "no_show"
        ? "text-critical"
        : state === "scheduled"
          ? "text-ink-muted"
          : "text-brand";

  const detail =
    arrived && arrivedLabel
      ? `${arrivalSource === "geofence" ? "Automatically" : "Marked"} at ${arrivedLabel}`
      : state === "working" && workStartedLabel
        ? `Started ${workStartedLabel}`
        : state === "en_route" && tripStartedLabel
          ? `Left ${tripStartedLabel}`
          : "";

  return (
    <div>
      <p
        className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${tone}`}
        role="status"
      >
        {arrived ? <Check className="h-4 w-4" aria-hidden /> : null}
        {stateLabel(state)}
      </p>
      {detail ? <p className="mt-1 text-sm text-ink-muted">{detail}</p> : null}
    </div>
  );
}

/**
 * Why the app wants a location, in the sentence that is actually true.
 *
 * Not "allow Volteira to track your location", which describes something this
 * does not do and reads as a company watching a van all day. What it does is
 * one thing, for one leg of one job, and saying so is both more honest and more
 * likely to get a yes.
 */
function PermissionExplainer({
  onAnswer,
  pending,
}: {
  onAnswer: (enabled: boolean) => void;
  pending: boolean;
}) {
  return (
    <div className="mt-4 rounded-control border border-brand/30 bg-brand/[0.06] p-4">
      <p className="flex items-start gap-2 text-sm font-semibold">
        <Radar className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
        Volteira can mark you arrived when you reach the job.
      </p>
      <p className="mt-2 text-sm leading-6 text-ink-muted">
        Your location is only checked while you are driving to this job, and stops the moment you
        get there. Nothing is kept but the time you arrived.
      </p>
      <div className="mt-4 grid gap-2">
        <button type="button" onClick={() => onAnswer(true)} disabled={pending} className={PRIMARY}>
          {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : null}
          Enable automatic arrival
        </button>
        <button type="button" onClick={() => onAnswer(false)} disabled={pending} className={SECONDARY}>
          Not now
        </button>
      </div>
    </div>
  );
}

/** Starting work on a job nobody was ever marked arrived at. */
function ConfirmEarlyWork({
  onConfirm,
  onCancel,
  pending,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  return (
    <div className="mt-4 rounded-control border border-line bg-raised p-4">
      <p className="text-sm font-semibold">Mark yourself arrived and start work?</p>
      <p className="mt-1 text-sm leading-6 text-ink-muted">
        The arrival time will be recorded as now.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={onConfirm} disabled={pending} className={PRIMARY}>
          {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : null}
          Yes, start work
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={SECONDARY}>
          Not yet
        </button>
      </div>
    </div>
  );
}

/**
 * What the app is doing about arrival while somebody drives.
 *
 * Every branch here ends somewhere useful. A technician reading "couldn't
 * confirm your location" needs to know that the job carries on regardless, and
 * the Mark arrived button two inches below is the answer rather than a support
 * call.
 */
function TravelStatus({
  choice,
  nearby,
  problem,
  onEnable,
}: {
  choice: Choice;
  nearby: Nearby | null;
  problem: string;
  onEnable: () => void;
}) {
  // The technician's own choice is read first. Telling somebody who said "not
  // now" that the address has not been geocoded answers a question they did not
  // ask, and hides the one thing they could actually change.
  if (choice !== "on") {
    return (
      <div className="mt-3">
        <p className="text-sm leading-6 text-ink-muted">
          Automatic arrival is off on this phone, so mark arrived when you get there.
        </p>
        <button type="button" onClick={onEnable} className={`${QUIET} mt-1`}>
          Turn it on
        </button>
      </div>
    );
  }

  if (problem) {
    return (
      <p className="mt-3 flex items-start gap-2 text-sm leading-6 text-caution" role="status">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {problem}
      </p>
    );
  }

  if (nearby?.settling) {
    return (
      <p className="mt-3 text-sm leading-6 text-ink-muted" role="status" aria-live="polite">
        Nearly there. Confirming you have stopped
        {nearby.secondsRemaining > 0 ? ` — ${nearby.secondsRemaining}s` : ""}.
      </p>
    );
  }

  return (
    <p className="mt-3 text-sm leading-6 text-ink-muted" role="status" aria-live="polite">
      We will mark you arrived automatically
      {nearby?.distanceMeters !== null && nearby?.distanceMeters !== undefined
        ? ` — ${formatDistance(nearby.distanceMeters)} away`
        : ""}
      .
    </p>
  );
}

/**
 * The next step, still under the thumb after scrolling.
 *
 * Fixed above the bottom bar on a phone, because the reason to scroll a job
 * page is to fill something in and the reason to stop is to move the job on —
 * and the second should not require finding your way back to the top.
 *
 * On a desktop it drops back into the flow: a bar floating over 1400px of
 * screen is a phone pattern wearing the wrong size.
 */
function ActionBar({
  state,
  step,
  pending,
  navigateUrl,
  onAdvance,
}: {
  state: WorkflowState;
  step: NonNullable<ReturnType<typeof nextStep>>;
  pending: boolean;
  navigateUrl: string;
  onAdvance: () => void;
}) {
  const travelling = state === "en_route";

  return (
    <div
      className={
        // Clears the floating nav — 64px tall, 12px off the bottom, plus the
        // home indicator underneath it.
        "fixed inset-x-2 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-30 rounded-control " +
        "border border-line bg-sunken/95 p-2 shadow-2xl shadow-black/40 backdrop-blur " +
        "lg:static lg:mt-3 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none"
      }
    >
      {travelling ? (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <a
            href={navigateUrl}
            target="_blank"
            rel="noreferrer"
            className={PRIMARY}
          >
            <Navigation className="h-5 w-5" aria-hidden />
            Navigate
          </a>
          <button
            type="button"
            onClick={onAdvance}
            disabled={pending}
            className={`${SECONDARY} w-auto px-4`}
          >
            {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : null}
            {step.label}
          </button>
        </div>
      ) : (
        <button type="button" onClick={onAdvance} disabled={pending} className={PRIMARY}>
          {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : null}
          {pending ? step.pendingLabel : step.label}
        </button>
      )}
    </div>
  );
}
