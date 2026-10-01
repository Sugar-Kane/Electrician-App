/**
 * What the working day left undone, and is still somebody's to do.
 *
 * A job whose time came and went without anybody starting it read
 * "Scheduled" on every screen for ever after, and one left running read
 * "In progress" days later — nothing in the app noticed either. The owner
 * found out from the customer. These are the loose ends, worked out from the
 * jobs the dashboard already has, so the end of the day can be a look at one
 * list rather than a walk through the schedule.
 *
 * Import-free, so every boundary can be tested against a fixed clock without a
 * database.
 */

/** Committed to and not yet started: the workflow's "scheduled" state. */
const WAITING = new Set(["confirmed", "assigned", "rescheduled"]);

/** Somebody set off or started and never closed it. */
const UNDERWAY = new Set(["en_route", "arrived", "in_progress"]);

/**
 * How long a job can go untouched past its time before it reads as missed.
 *
 * Fifteen minutes, so the 8:00 visit a technician is pulling up to at 8:05 is
 * not flagged, and the one nobody went to is flagged while it is still today.
 */
export const GRACE_MINUTES = 15;

export type Lateness = "not_started" | "not_finished";

export type FollowUpKind = "not_finished" | "not_started" | "to_complete" | "not_invoiced";

/** The parts of a job these read. `PilotJob` has them all. */
export type FollowUpJob = {
  /** The job number. */
  id: string;
  customer: string;
  /** The stored status, `jobs.status`. */
  stage?: string;
  startsAt?: string;
  endsAt?: string;
};

export type FollowUp = {
  kind: FollowUpKind;
  jobNumber: string;
  customer: string;
  /** The line under the customer: what is left and when it was for. */
  detail: string;
  /** The time it is about, for ordering. */
  at: string;
};

const KIND_ORDER: FollowUpKind[] = ["not_finished", "not_started", "to_complete", "not_invoiced"];

const KIND_LABEL: Record<FollowUpKind, string> = {
  not_finished: "Not finished",
  not_started: "Not started",
  to_complete: "Work done, not signed off",
  not_invoiced: "Not invoiced",
};

function instant(iso: string | undefined): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : at;
}

/**
 * Whether a job's time has gone by without it being started, or finished.
 *
 * Not started: still waiting fifteen minutes after it was due to begin. Not
 * finished: under way fifteen minutes after it was due to end — or, with no end
 * time on it, after it was due to begin, which is the best it says. Anything
 * else, a draft or a booking waiting on payment included, is not late: neither
 * is a commitment anybody made.
 */
export function lateness(
  job: { stage?: string; startsAt?: string; endsAt?: string },
  now: Date,
): Lateness | null {
  const stage = job.stage ?? "";
  const grace = GRACE_MINUTES * 60_000;

  if (WAITING.has(stage)) {
    const start = instant(job.startsAt);
    return start !== null && now.getTime() >= start + grace ? "not_started" : null;
  }

  if (UNDERWAY.has(stage)) {
    const end = instant(job.endsAt) ?? instant(job.startsAt);
    return end !== null && now.getTime() >= end + grace ? "not_finished" : null;
  }

  return null;
}

/** What a late job's status reads as, wherever its status is shown. */
export function lateLabel(late: Lateness): "Not started" | "Not finished" {
  return late === "not_started" ? "Not started" : "Not finished";
}

/** The late ones among these jobs, by job number. */
export function lateJobs(jobs: FollowUpJob[], now: Date): Record<string, Lateness> {
  const late: Record<string, Lateness> = {};
  for (const job of jobs) {
    const found = lateness(job, now);
    if (found) late[job.id] = found;
  }
  return late;
}

/** A calendar day, YYYY-MM-DD, as it is where the business is. */
function dayIn(at: Date, timeZone: string): string {
  // en-CA writes dates as YYYY-MM-DD, which compare as strings.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function dayBefore(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const previous = new Date(Date.UTC(year!, month! - 1, date! - 1));
  return previous.toISOString().slice(0, 10);
}

/** "Today, 2:00 PM", "Yesterday, 2:00 PM", or "Tue, Sep 29, 10:00 AM". */
export function whenLabel(iso: string, now: Date, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";

  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
  const day = dayIn(at, timeZone);
  const today = dayIn(now, timeZone);

  if (day === today) return `Today, ${time}`;
  if (day === dayBefore(today)) return `Yesterday, ${time}`;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/**
 * Everything left to finish or follow up on, most pressing first.
 *
 * Late jobs, work done that nobody has signed off, and finished work with
 * nothing billed for it — `unbilled` is that last one, worked out by the caller
 * from the job's recorded hours and parts, so a prepaid diagnostic with nothing
 * more to charge never appears as something to chase. Each kind is listed
 * newest first: yesterday's missed visit is the one somebody can still save.
 */
export function followUps(input: {
  jobs: FollowUpJob[];
  /** Cents of recorded work on finished jobs with no invoice, by job number. */
  unbilled: Record<string, number>;
  now: Date;
  timeZone: string;
}): FollowUp[] {
  const { jobs, unbilled, now, timeZone } = input;
  const items: FollowUp[] = [];

  for (const job of jobs) {
    const late = lateness(job, now);
    const startsAt = job.startsAt ?? "";

    if (late) {
      items.push({
        kind: late,
        jobNumber: job.id,
        customer: job.customer,
        detail: `${KIND_LABEL[late]} · ${whenLabel(startsAt, now, timeZone)}`,
        at: startsAt,
      });
      continue;
    }

    // Work finished and waiting for somebody to close it — but only once its
    // time has come. The status has been written ahead of a visit before,
    // and "work done" on a job that has not happened yet would be untrue.
    const start = instant(job.startsAt);
    if (job.stage === "needs_review" && start !== null && start <= now.getTime()) {
      items.push({
        kind: "to_complete",
        jobNumber: job.id,
        customer: job.customer,
        detail: `${KIND_LABEL.to_complete} · ${whenLabel(startsAt, now, timeZone)}`,
        at: startsAt,
      });
      continue;
    }

    const owed = unbilled[job.id] ?? 0;
    if (job.stage === "completed" && owed > 0) {
      items.push({
        kind: "not_invoiced",
        jobNumber: job.id,
        customer: job.customer,
        detail: `${KIND_LABEL.not_invoiced} · ${money(owed)} of work · ${whenLabel(startsAt, now, timeZone)}`,
        at: startsAt,
      });
    }
  }

  return items.sort((a, b) => {
    const kind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (kind !== 0) return kind;
    return (instant(b.at) ?? 0) - (instant(a.at) ?? 0);
  });
}
