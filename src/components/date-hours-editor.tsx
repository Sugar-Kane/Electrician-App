"use client";

import { useActionState } from "react";
import { CalendarCheck, LoaderCircle, RotateCcw } from "lucide-react";

import {
  clearDateHours,
  saveDateHours,
  type ElectricianState,
} from "@/app/technicians/actions";
import { TimeField } from "@/components/ui/time-field";
import { dateLabel } from "@/lib/electrician-calendar";
import { friendlyTime, type DayHours } from "@/lib/electrician-hours";
import { hoursOn, type DateHours } from "@/lib/date-hours";

/**
 * One day, set on its own.
 *
 * The weekly pattern above this can only describe a week that repeats forever.
 * This is where a week with a different shape gets said — next week is Tuesday
 * and Thursday, this Saturday is twelve until four — and it writes a dated row
 * that answers for that date completely, ahead of the pattern.
 *
 * Two forms rather than one with a mode: saving and clearing are different
 * verbs, and a single form that means "set" or "unset" depending on a hidden
 * field is the kind of thing that eventually unsets somebody's Saturday.
 */

const initialState: ElectricianState = { error: "" };

export function DateHoursEditor({
  technicianId,
  date,
  pattern,
  dated,
  subject,
}: {
  /** Omitted for the business, matching every other action on this screen. */
  technicianId?: string;
  /** YYYY-MM-DD. */
  date: string;
  pattern: DayHours[];
  dated: DateHours[];
  subject: "electrician" | "business";
}) {
  const [saveState, save, saving] = useActionState(saveDateHours, initialState);
  const [clearState, clear, clearing] = useActionState(clearDateHours, initialState);

  const resolved = hoursOn(date, pattern, dated);
  const isSet = resolved?.source === "date";

  // Seeded from whatever already applies, so opening a day and saving it does
  // not silently change the hours somebody already had.
  const start = resolved?.start ?? "08:00";
  const end = resolved?.end ?? "17:00";

  return (
    <div className="mt-3 rounded-control border border-brand/40 bg-brand/[0.06] p-3">
      <div className="flex items-start gap-2">
        <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{dateLabel(date)}</p>
          <p className="text-xs leading-5 text-ink-muted">
            {isSet
              ? `Set on its own, ${friendlyTime(resolved.start)}–${friendlyTime(resolved.end)}.`
              : resolved
                ? `Follows the usual week, ${friendlyTime(resolved.start)}–${friendlyTime(resolved.end)}.`
                : subject === "business"
                  ? "Closed on the usual week. Setting hours here opens it for this day only."
                  : "Not a working day on the usual week. Setting hours here adds it for this day only."}
          </p>
        </div>
      </div>

      <form action={save} className="mt-3">
        {technicianId ? <input type="hidden" name="technicianId" value={technicianId} /> : null}
        <input type="hidden" name="onDate" value={date} />

        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-[8rem] flex-1">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">Start</span>
            <TimeField name="start" defaultValue={start} label={`${dateLabel(date)} start`} />
          </div>
          <div className="min-w-[8rem] flex-1">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">Finish</span>
            <TimeField name="end" defaultValue={end} label={`${dateLabel(date)} finish`} />
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
          {saving ? "Saving…" : `Set ${dateLabel(date)} only`}
        </button>
      </form>

      {isSet ? (
        <form action={clear} className="mt-2">
          {technicianId ? <input type="hidden" name="technicianId" value={technicianId} /> : null}
          <input type="hidden" name="onDate" value={date} />

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
