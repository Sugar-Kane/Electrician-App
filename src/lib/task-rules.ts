/**
 * The rules of a task, shared by the Tasks page, each job's Tasks section and
 * the ChatGPT/Claude connection. Import-free apart from the time arithmetic,
 * so every rule here can be tested directly.
 *
 * Four things are kept apart on purpose:
 *   - the due date says when the outcome is needed;
 *   - a reminder says when somebody is told;
 *   - scheduled execution says when an assistant starts;
 *   - recurrence says when the next one is made.
 * A due date never starts anything by itself.
 *
 * Overdue is worked out, never stored: an open task whose deadline has passed
 * where the business is.
 */

import { addDays, calendarDate, isoToZonedWallClock, zonedWallClockToIso } from "./schedule-labels.ts";

export const TASK_STATUSES = ["todo", "in_progress", "waiting_input", "waiting_approval", "complete", "canceled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  waiting_input: "Waiting for input",
  waiting_approval: "Waiting for approval",
  complete: "Complete",
  canceled: "Canceled",
};

export type TaskVisibility = "private" | "workspace";

export const TASK_VIEWS = ["today", "upcoming", "all", "completed"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const TASK_FILTERS = ["mine", "ai", "waiting_input", "waiting_approval", "overdue"] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];

export const TITLE_MAX = 300;
export const NOTES_MAX = 10_000;
export const BULK_MAX = 25;

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export function isTaskView(value: string): value is TaskView {
  return (TASK_VIEWS as readonly string[]).includes(value);
}

export function isTaskFilter(value: string): value is TaskFilter {
  return (TASK_FILTERS as readonly string[]).includes(value);
}

/** Done or called off: no longer asking anything of anybody. */
export function isClosed(status: string): boolean {
  return status === "complete" || status === "canceled";
}

/** A machine-readable reason, with words a person can act on. */
export type TaskError = { code: TaskErrorCode; message: string; field?: string };
export type TaskErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VERSION_CONFLICT"
  | "JOB_NOT_FOUND"
  | "JOB_AMBIGUOUS"
  | "VISIBILITY_CHANGE_NEEDS_CONFIRMATION"
  | "ARCHIVED"
  | "NOT_CONNECTED"
  | "RECURRENCE_SCOPE_REQUIRED"
  | "SAVE_FAILED";

export type Result<T> = { ok: true; value: T } | { ok: false; error: TaskError };

export function fail<T = never>(code: TaskErrorCode, message: string, field?: string): Result<T> {
  return { ok: false, error: { code, message, ...(field ? { field } : {}) } };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** A real calendar date, written YYYY-MM-DD. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** A 24-hour clock time, HH:MM. */
export function isClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** An IANA zone the runtime knows. */
export function isTimeZone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The instant a dated, timed deadline falls on, where the task's zone is.
 *
 * A wall-clock time that does not exist (the hour skipped when clocks go
 * forward) lands on the same reading after the jump, so 2:30 on that night is
 * 3:30. One that happens twice (the hour repeated when clocks go back) is the
 * first of the two. Both follow from how the conversion probes the zone.
 */
export function dueInstant(dueDate: string, dueTime: string, timeZone: string): string {
  if (!dueDate || !dueTime) return "";
  const wanted = `${dueDate}T${dueTime}`;
  const iso = zonedWallClockToIso(wanted, timeZone);
  if (!iso || isoToZonedWallClock(iso, timeZone) === wanted) return iso;
  // The reading does not exist: it fell in the gap when clocks went forward,
  // and the conversion landed that far before it. Moving forward by the same
  // amount gives the reading it would have had after the jump (2:30 -> 3:30).
  const landed = isoToZonedWallClock(iso, timeZone);
  const gap = Date.parse(`${wanted}:00Z`) - Date.parse(`${landed}:00Z`);
  if (!Number.isFinite(gap) || gap <= 0 || gap > 3 * 3_600_000) return iso;
  return new Date(new Date(iso).getTime() + gap).toISOString();
}

/** Today's date where the business is. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return calendarDate(now.toISOString(), timeZone);
}

export type DueFacts = {
  status: string;
  due_date: string | null;
  due_at: string | null;
  archived_at?: string | null;
};

/**
 * An open task past its deadline. A date-only deadline is overdue from the
 * start of the next day; one with a time, from that minute.
 */
export function isOverdue(task: DueFacts, timeZone: string, now: Date = new Date()): boolean {
  if (isClosed(task.status) || task.archived_at || !task.due_date) return false;
  if (task.due_at) return new Date(task.due_at).getTime() < now.getTime();
  return task.due_date < todayIn(timeZone, now);
}

/** What a person may type or say to make or change a task. Only the title is required to create one. */
export type TaskInput = {
  title?: unknown;
  notes?: unknown;
  due_date?: unknown;
  due_time?: unknown;
  time_zone?: unknown;
  /** When to remind, as local wall-clock time "YYYY-MM-DDTHH:MM" in the task's zone. Empty clears it. */
  reminder_at?: unknown;
};

export type CleanTaskFields = {
  title?: string;
  notes?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  due_at?: string | null;
  time_zone?: string;
  reminder_at?: string | null;
};

/**
 * Read and check the fields of a task.
 *
 * `creating` requires a title. Anything left out is left alone on an update;
 * an empty string clears an optional field. A time needs a date: "at 9" with
 * no day is a question to ask, not something to guess.
 */
export function readTaskFields(
  input: TaskInput,
  options: {
    creating: boolean;
    defaultTimeZone: string;
    current?: { due_date: string | null; due_time: string | null; time_zone: string };
    now?: Date;
  },
): Result<CleanTaskFields> {
  const out: CleanTaskFields = {};

  if (input.title !== undefined || options.creating) {
    const title = clean(input.title);
    if (!title) return fail("INVALID_INPUT", "A task needs a title.", "title");
    if (title.length > TITLE_MAX) return fail("INVALID_INPUT", `Keep the title under ${TITLE_MAX} characters.`, "title");
    out.title = title;
  }

  if (input.notes !== undefined) {
    const notes = typeof input.notes === "string" ? input.notes.trim() : "";
    if (notes.length > NOTES_MAX) return fail("INVALID_INPUT", "The notes are too long.", "notes");
    out.notes = notes || null;
  }

  if (input.time_zone !== undefined) {
    const zone = clean(input.time_zone);
    if (zone && !isTimeZone(zone)) return fail("INVALID_INPUT", "That is not a time zone this app knows.", "time_zone");
    if (zone) out.time_zone = zone;
  }
  if (options.creating && !out.time_zone) out.time_zone = options.defaultTimeZone;

  const touchesDue = input.due_date !== undefined || input.due_time !== undefined || out.time_zone !== undefined;
  if (touchesDue) {
    const dueDate = input.due_date !== undefined ? clean(input.due_date) : (options.current?.due_date ?? "");
    const dueTime = input.due_time !== undefined ? clean(input.due_time).slice(0, 5) : (options.current?.due_time?.slice(0, 5) ?? "");
    const zone = out.time_zone ?? options.current?.time_zone ?? options.defaultTimeZone;
    if (dueDate && !isCalendarDate(dueDate)) return fail("INVALID_INPUT", "A due date looks like 2026-11-14.", "due_date");
    if (dueTime && !isClockTime(dueTime)) return fail("INVALID_INPUT", "A due time looks like 09:00 or 14:30.", "due_time");
    if (dueTime && !dueDate) return fail("INVALID_INPUT", "A due time needs a due date. Which day?", "due_date");
    out.due_date = dueDate || null;
    out.due_time = dueTime || null;
    out.due_at = dueDate && dueTime ? dueInstant(dueDate, dueTime, zone) : null;
  }

  // A reminder is when somebody is told, separate from the deadline. It must
  // be in the future: a reminder for a time already gone would only fire at
  // once and be read as a mistake.
  if (input.reminder_at !== undefined) {
    const local = clean(input.reminder_at).replace(" ", "T").slice(0, 16);
    if (!local) {
      out.reminder_at = null;
    } else {
      const [date = "", time = ""] = local.split("T");
      if (!isCalendarDate(date) || !isClockTime(time)) {
        return fail("INVALID_INPUT", "A reminder looks like 2026-11-14T09:00, in the business's time zone.", "reminder_at");
      }
      const zone = out.time_zone ?? options.current?.time_zone ?? options.defaultTimeZone;
      const instant = dueInstant(date, time, zone);
      if (new Date(instant).getTime() < (options.now ?? new Date()).getTime() - 60_000) {
        return fail("INVALID_INPUT", "That reminder time has already passed. Pick a time from now on.", "reminder_at");
      }
      out.reminder_at = instant;
    }
  }

  return { ok: true, value: out };
}

/**
 * Split one request into separate titles, for "order the panel, confirm the
 * appointment, and prepare permit paperwork". Only for a person typing several
 * at once; a single title with a comma in it stays whole unless it reads as a
 * list (two or more separators, or one " and ").
 */
export function splitTitles(text: string): string[] {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) return lines.slice(0, BULK_MAX);
  return [text.trim()].filter(Boolean);
}

/**
 * Linking a task to a job makes it visible to the whole business, because
 * jobs are. A private task only changes once that has been agreed.
 */
export function visibilityForJobLink(
  current: TaskVisibility,
  confirmed: boolean,
): Result<{ visibility: "workspace"; changed: boolean }> {
  if (current === "workspace") return { ok: true, value: { visibility: "workspace", changed: false } };
  if (!confirmed) {
    return fail(
      "VISIBILITY_CHANGE_NEEDS_CONFIRMATION",
      "This task is private. Linking it to a job lets everyone in the business see it, including its notes. Confirm to go ahead.",
      "job",
    );
  }
  return { ok: true, value: { visibility: "workspace", changed: true } };
}

/** The status a task moves to when it is completed or reopened, or why it cannot. */
export function completeTransition(status: string): Result<TaskStatus> {
  if (status === "complete") return fail("INVALID_INPUT", "That task is already complete.");
  return { ok: true, value: "complete" };
}

export function reopenTransition(status: string): Result<TaskStatus> {
  if (!isClosed(status)) return fail("INVALID_INPUT", "That task is still open.");
  return { ok: true, value: "todo" };
}

export type ViewFacts = DueFacts & {
  assignee_type: string;
  assignee_user_id: string | null;
  created_by: string | null;
  owner_id: string | null;
};

/**
 * Which tasks belong in a view.
 *
 * Today: due today, overdue, or waiting on this person's input or approval.
 * Upcoming: open, due after today.
 * All: every open task, dated or not.
 * Completed: done or canceled.
 */
export function inView(task: ViewFacts, view: TaskView, userId: string, timeZone: string, now: Date = new Date()): boolean {
  if (task.archived_at) return false;
  const today = todayIn(timeZone, now);
  switch (view) {
    case "completed":
      return isClosed(task.status);
    case "all":
      return !isClosed(task.status);
    case "upcoming":
      return !isClosed(task.status) && Boolean(task.due_date && task.due_date > today);
    case "today": {
      if (isClosed(task.status)) return false;
      if (task.due_date === today || isOverdue(task, timeZone, now)) return true;
      const waitingOnMe =
        (task.status === "waiting_input" || task.status === "waiting_approval") &&
        (task.assignee_user_id === userId || task.owner_id === userId || task.created_by === userId || task.assignee_type === "assistant");
      return waitingOnMe;
    }
  }
}

export function matchesFilter(task: ViewFacts, filter: TaskFilter, userId: string, timeZone: string, now: Date = new Date()): boolean {
  switch (filter) {
    case "mine":
      return task.assignee_type === "user" && task.assignee_user_id === userId;
    case "ai":
      return task.assignee_type === "assistant";
    case "waiting_input":
      return task.status === "waiting_input";
    case "waiting_approval":
      return task.status === "waiting_approval";
    case "overdue":
      return isOverdue(task, timeZone, now);
  }
}

/** Upcoming tasks by day, soonest first. */
export function groupByDate<T extends { due_date: string | null }>(tasks: T[]): { date: string; tasks: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const task of tasks) {
    const key = task.due_date ?? "";
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([date, list]) => ({ date, tasks: list }));
}

/** "Today", "Tomorrow", "Fri, Nov 14", from the business's point of view. */
export function dueLabel(dueDate: string, dueTime: string | null, timeZone: string, now: Date = new Date()): string {
  const today = todayIn(timeZone, now);
  const day =
    dueDate === today
      ? "Today"
      : dueDate === addDays(today, 1)
        ? "Tomorrow"
        : dueDate === addDays(today, -1)
          ? "Yesterday"
          : new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
              new Date(`${dueDate}T12:00:00Z`),
            );
  if (!dueTime) return day;
  const [hour, minute] = dueTime.split(":").map(Number);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
    new Date(Date.UTC(2000, 0, 1, hour ?? 0, minute ?? 0)),
  );
  return `${day}, ${time}`;
}

/** The weekday of a calendar date, for telling a person which day a date they said resolved to. */
export function weekdayOf(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}
