"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CalendarCheck, LoaderCircle, RotateCcw, X } from "lucide-react";

import {
  clearDateHours,
  saveDateHours,
  type ElectricianState,
} from "@/app/technicians/actions";
import { TimeField } from "@/components/ui/time-field";
import { dateLabel, listDates } from "@/lib/electrician-calendar";
import {
  DEFAULT_END,
  DEFAULT_START,
  friendlyTime,
  type DayHours,
} from "@/lib/electrician-hours";
import { hoursOn, type DateHours, type ResolvedDay } from "@/lib/date-hours";

/**
 * The days somebody picked out, set together.
 *
 * The weekly pattern above this can only describe a week that repeats forever.
 * This is where a week with a different shape gets said — next week is Tuesday
 * and Thursday, this Saturday is twelve until four — and it writes a dated row
 * per day that answers for that date completely, ahead of the pattern.
 *
 * Many dates rather than one, because the thing people actually came to do is a
 * week: tapping a day, setting hours, saving, and repeating that four times was
 * the same work done four times over. The dates travel as a repeated `onDate`
 * field, which is what `readDates` on the action reads.
 *
 * Two forms rather than one with a mode: saving and clearing are different
 * verbs, and a single form that means "set" or "unset" depending on a hidden
 * field is the kind of thing that eventually unsets somebody's Saturday.
 */

const initialState: ElectricianState = { error: "" };

/** Same hours or not, counting "not a working day" as an answer of its own. */
function spanOf(resolved: ResolvedDay | null): string {
  return resolved ? `${resolved.start}-${resolved.end}` : "off";
}

export function DateHoursEditor({
  technicianId,
  dates,
  pattern,
  dated,
  subject,
  onClear,
}: {
  /** Omitted for the business, matching every other action on this screen. */
  technicianId?: string;
  /** YYYY-MM-DD, in date order, never empty. */
  dates: string[];
  pattern: DayHours[];
  dated: DateHours[];
  subject: "electrician" | "business";
  /** Hands the selection back to the calendar, which owns it. */
  onClear: () => void;
}) {
  const [saveState, save, saving] = useActionState(saveDateHours, initialState);
  const [clearState, clear, clearing] = useActionState(clearDateHours, initialState);

  const resolved = dates.map((date) => hoursOn(date, pattern, dated));
  const anyDated = resolved.some((entry) => entry?.source === "date");
  const mixed = new Set(resolved.map(spanOf)).size > 1;

  /*
   * Seeded once, on the first day chosen.
   *
   * The panel mounts when the selection starts and stays mounted while more
   * days are added, so choosing a fourth day cannot overwrite times somebody
   * has just set. Clearing the selection unmounts it, and the next one seeds
   * fresh. A dated day is preferred over the pattern: if one of these days has
   * already been set on its own, that is the likeliest thing to be copying.
   */
  const [seed] = useState(
    () => resolved.find((entry) => entry?.source === "date") ?? resolved.find(Boolean) ?? null,
  );
  const [start, setStart] = useState(seed?.start ?? DEFAULT_START);
  const [end, setEnd] = useState(seed?.end ?? DEFAULT_END);

  const many = dates.length > 1;
  const first = dates[0] ?? "";

  /*
   * Bring the panel and the calendar under it into view together.
   *
   * This appears above the grid, so the grid slides down by the height of it —
   * measured at 234px — and on a phone that put the day somebody had just
   * tapped underneath the bottom bar. Scrolling to the top of the panel puts
   * the hours and the days they apply to on one screen, in both views.
   *
   * Only on mount, which is the moment the first day is chosen. Choosing a
   * second one must not yank the page while somebody is still tapping.
   */
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  /** What these days are now, before anything is saved. */
  function describe(): string {
    if (mixed) {
      return "These days do not all have the same hours now. Saving gives every one of them the times below.";
    }

    const one = resolved[0] ?? null;
    if (!one) {
      if (subject === "business") {
        return many
          ? "Closed on the usual week. Setting hours here opens these days only."
          : "Closed on the usual week. Setting hours here opens it for this day only.";
      }
      return many
        ? "Not working days on the usual week. Setting hours here adds them, for these days only."
        : "Not a working day on the usual week. Setting hours here adds it for this day only.";
    }

    const span = `${friendlyTime(one.start)}–${friendlyTime(one.end)}`;
    if (one.source === "date") {
      return many ? `Set on their own, ${span}.` : `Set on its own, ${span}.`;
    }
    return many
      ? `They all follow the usual week, ${span}.`
      : `Follows the usual week, ${span}.`;
  }

  return (
    <div
      ref={panel}
      className="mt-2 scroll-mt-3 rounded-control border border-brand/40 bg-brand/[0.06] p-3"
    >
      <div className="flex items-start gap-2">
        <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {many ? `${dates.length} days chosen` : dateLabel(first)}
            {many ? (
              <span className="ml-1 font-normal text-ink-muted">· {listDates(dates)}</span>
            ) : null}
          </p>
          <p className="text-xs leading-5 text-ink-muted">{describe()}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label={many ? "Clear the chosen days" : "Clear the chosen day"}
          className="tap-target -mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-control text-ink-muted"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <form action={save} className="mt-2">
        {technicianId ? <input type="hidden" name="technicianId" value={technicianId} /> : null}
        {/*
          One field per day, all named the same. `formData.getAll("onDate")` is
          how a set of days reaches the server without inventing a delimiter
          somebody's date has to be escaped out of.
        */}
        {dates.map((date) => (
          <input key={date} type="hidden" name="onDate" value={date} />
        ))}

        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-[8rem] flex-1">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">Start</span>
            <TimeField
              name="start"
              value={start}
              onChange={setStart}
              label={many ? "Start time for the chosen days" : `${dateLabel(first)} start`}
            />
          </div>
          <div className="min-w-[8rem] flex-1">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">Finish</span>
            <TimeField
              name="end"
              value={end}
              onChange={setEnd}
              label={many ? "Finish time for the chosen days" : `${dateLabel(first)} finish`}
            />
          </div>
        </div>

        {saveState.error ? <p className="mt-2 text-sm text-critical">{saveState.error}</p> : null}
        {saveState.notice ? <p className="mt-2 text-sm text-positive">{saveState.notice}</p> : null}

        <button
          type="submit"
          disabled={saving}
          className="tap-target mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60"
        >
          {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {saving
            ? "Saving…"
            : many
              ? `Set these ${dates.length} days`
              : `Set ${dateLabel(first)} only`}
        </button>
      </form>

      {anyDated ? (
        <form action={clear} className="mt-2">
          {technicianId ? <input type="hidden" name="technicianId" value={technicianId} /> : null}
          {dates.map((date) => (
            <input key={date} type="hidden" name="onDate" value={date} />
          ))}

          {clearState.error ? (
            <p className="mb-2 text-sm text-critical">{clearState.error}</p>
          ) : null}

          <button
            type="submit"
            disabled={clearing}
            className="tap-target inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-semibold disabled:opacity-60"
          >
            {clearing ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="h-4 w-4" aria-hidden />
            )}
            Use the usual week
          </button>
        </form>
      ) : null}
    </div>
  );
}
