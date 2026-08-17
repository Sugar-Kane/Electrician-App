"use client";

import { useActionState, useState } from "react";
import { CalendarOff, ChevronLeft, ChevronRight, LoaderCircle, TriangleAlert } from "lucide-react";

import type { ElectricianState } from "@/app/technicians/actions";
import { CALENDAR_CELL, CALENDAR_ROW } from "@/components/ui/calendar-grid";
import { TimeField } from "@/components/ui/time-field";
import {
  dateLabel,
  monthGrid,
  monthLabel,
  shiftMonth,
  todayIso,
} from "@/lib/electrician-calendar";
import {
  DEFAULT_END,
  DEFAULT_START,
  describeWeek,
  WEEKDAYS,
  type DayHours,
} from "@/lib/electrician-hours";
import type { TechnicianBlackout } from "@/lib/job-data";

/**
 * When somebody works, as a month you can look at.
 *
 * This replaced seven stacked rows and fourteen inputs, which filled a phone
 * screen and still did not show the shape of a week.
 *
 * The month is the picture; the weekday is the control. Hours recur weekly —
 * the database stores a weekday, not a date — so tapping the 14th cannot mean
 * "set the hours for the 14th" without inventing a per-date table and quietly
 * turning the pattern into something else. Tapping any Wednesday toggles
 * Wednesdays, and the whole column changing at once is what makes that legible
 * rather than surprising.
 *
 * One component, two subjects. An electrician's week and the business's own
 * opening hours are the same control over different storage — a `weekday` row
 * per day in one case, a JSONB object in the other — and the action is passed
 * in rather than imported so neither has to know about the other. What does
 * differ is what *nothing selected* means, and that difference is the whole
 * reason `subject` exists: for a person it is permissive, for the business it
 * closes the booking page.
 *
 * The form contract is unchanged: the same `enabled-`, `start-` and `end-`
 * fields the seven rows posted, now hidden inputs driven by state.
 */

const initialState: ElectricianState = { error: "" };

type Subject = "electrician" | "business";

const COPY = {
  electrician: {
    prompt: "Tap a day to work it.",
    on: "working",
    off: "not working",
    marked: "Time off is marked. Change it in the Time off tab.",
    timeOff: "time off",
  },
  business: {
    prompt: "Tap a day to open.",
    on: "open",
    off: "closed",
    marked: "Closures are marked. Change them in the Closed tab.",
    timeOff: "closed",
  },
} satisfies Record<Subject, Record<string, string>>;

/** "Saturdays", "Saturdays and Sundays", "Mondays, Saturdays and Sundays". */
function listDays(weekdays: number[]): string {
  const names = weekdays.map((weekday) => `${WEEKDAYS[weekday]?.label}s`);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function HoursCalendar({
  action,
  subject,
  technicianId,
  hours,
  blackouts,
  businessHours,
  timeZone,
}: {
  /** Passed in, not imported, so one calendar serves a person and the business. */
  action: (state: ElectricianState, formData: FormData) => Promise<ElectricianState>;
  subject: Subject;
  /** Omitted when the subject is the business, which has nobody to name. */
  technicianId?: string;
  hours: DayHours[];
  /** Drawn, never edited here. Time off is its own tab. */
  blackouts: TechnicianBlackout[];
  /**
   * The days the business is open, for an electrician's calendar only. A person
   * set to work a day the business is shut is never offered to anybody, and
   * until now nothing on this screen said so.
   */
  businessHours?: DayHours[];
  timeZone: string;
}) {
  const [state, submit, saving] = useActionState(action, initialState);
  const copy = COPY[subject];

  const today = todayIso(timeZone);
  const [viewing, setViewing] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  }));

  // The pattern being edited. Seeded from what is saved; a day that is not
  // worked is simply absent, which is the same shape the table uses.
  const [pattern, setPattern] = useState<Map<number, { start: string; end: string }>>(
    () => new Map(hours.map((entry) => [entry.weekday, { start: entry.start, end: entry.end }])),
  );
  const [showPerDay, setShowPerDay] = useState(false);

  const selected = [...pattern.keys()].sort((a, b) => a - b);

  // The hours the shared fields show. Every selected day agreeing is the common
  // case by a mile, and when they do not the fields show the earliest start and
  // latest finish rather than pretending one day speaks for the rest.
  const shared = selected.length
    ? {
        start: selected.reduce(
          (earliest, day) => {
            const value = pattern.get(day)!.start;
            return value < earliest ? value : earliest;
          },
          pattern.get(selected[0]!)!.start,
        ),
        end: selected.reduce((latest, day) => {
          const value = pattern.get(day)!.end;
          return value > latest ? value : latest;
        }, pattern.get(selected[0]!)!.end),
      }
    : { start: DEFAULT_START, end: DEFAULT_END };

  const mixed = selected.some((day) => {
    const entry = pattern.get(day)!;
    return entry.start !== shared.start || entry.end !== shared.end;
  });

  function toggleWeekday(weekday: number) {
    setPattern((current) => {
      const next = new Map(current);
      if (next.has(weekday)) next.delete(weekday);
      else next.set(weekday, { start: shared.start, end: shared.end });
      return next;
    });
  }

  /** Move every selected day together, which is what the shared fields mean. */
  function setSharedHours(part: "start" | "end", value: string) {
    setPattern((current) => {
      const next = new Map(current);
      for (const [weekday, entry] of next) next.set(weekday, { ...entry, [part]: value });
      return next;
    });
  }

  function setDayHours(weekday: number, part: "start" | "end", value: string) {
    setPattern((current) => {
      const next = new Map(current);
      const entry = next.get(weekday);
      if (entry) next.set(weekday, { ...entry, [part]: value });
      return next;
    });
  }

  const weeks = monthGrid(viewing.year, viewing.month);
  const blockedDates = new Set(
    blackouts.map((blackout) => blackout.startsAt.slice(0, 10)).filter(Boolean),
  );

  // Only meaningful on an electrician's calendar. The business's own calendar is
  // what defines these days, so shading itself would be circular.
  const openWeekdays = businessHours ? new Set(businessHours.map((day) => day.weekday)) : null;
  const isShut = (weekday: number) => openWeekdays !== null && !openWeekdays.has(weekday);

  // Named only when it actually costs something. Saturday being shut is not
  // news; setting somebody to work a Saturday that is shut is.
  const wasted = selected.filter(isShut);

  /*
   * Flush to the inside of the card on a phone. `-mx-4` cancels the card's own
   * `p-4` — a number that stays right if the card's padding ever changes,
   * rather than a measured constant that quietly goes stale — and the
   * disclosure panel around this drops its padding below `sm` so there is
   * nothing else in the way.
   *
   * Worth the trouble because of the arithmetic: seven 44px columns with their
   * gaps need 332px, and every pixel of nesting comes straight off the cells.
   * Measured, not guessed — an earlier version overflowed its own grid on a
   * 390px viewport while the page reported no overflow at all, which is why
   * nobody could see the last column was being clipped.
   */
  return (
    <form action={submit} className="-mx-4 mt-3 rounded-control border border-line p-1 sm:mx-0 sm:p-3">
      {technicianId ? <input type="hidden" name="technicianId" value={technicianId} /> : null}
      {/*
        The whole pattern, in the fields the action has always read. Rendering
        them rather than reading the calendar on the server keeps this component
        swappable and both actions reading one contract.
      */}
      {WEEKDAYS.map((day) => {
        const entry = pattern.get(day.value);
        return entry ? (
          <span key={day.value}>
            <input type="hidden" name={`enabled-${day.value}`} value="yes" />
            <input type="hidden" name={`start-${day.value}`} value={entry.start} />
            <input type="hidden" name={`end-${day.value}`} value={entry.end} />
          </span>
        ) : null;
      })}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setViewing((current) => shiftMonth(current.year, current.month, -1))}
          aria-label="Previous month"
          className="tap-target grid h-11 w-11 place-items-center rounded-control border border-line"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <p className="text-sm font-semibold" aria-live="polite">
          {monthLabel(viewing.year, viewing.month)}
        </p>
        <button
          type="button"
          onClick={() => setViewing((current) => shiftMonth(current.year, current.month, 1))}
          aria-label="Next month"
          className="tap-target grid h-11 w-11 place-items-center rounded-control border border-line"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/*
        The header row is a control too. Tapping a date is the discoverable way
        in, but somebody who has understood that this is a weekly pattern
        reaches for the column, and finding it inert would be a small betrayal.
      */}
      <div className={`mt-2 ${CALENDAR_ROW}`}>
        {WEEKDAYS.map((day) => (
          <button
            key={day.value}
            type="button"
            onClick={() => toggleWeekday(day.value)}
            aria-pressed={pattern.has(day.value)}
            aria-label={`${day.label}s`}
            /*
              A real control, so a real target. It duplicates what the cells
              below do, which is an argument for keeping it small and a worse
              argument than not shipping a 32px button.
            */
            className={`grid min-h-11 min-w-0 place-items-center rounded-control text-[11px] font-bold uppercase tracking-wide ${
              pattern.has(day.value) ? "bg-brand/20 text-brand" : "text-ink-faint"
            } ${isShut(day.value) ? "opacity-60" : ""}`}
          >
            {day.short.slice(0, 1)}
          </button>
        ))}
      </div>

      <div className={`mt-1 ${CALENDAR_ROW}`}>
        {weeks.flat().map((cell) => {
          const working = pattern.has(cell.weekday);
          const blocked = blockedDates.has(cell.iso);
          const shut = isShut(cell.weekday);

          /*
           * Four states, and the pair that matters is a day set on a weekday the
           * business is shut: it keeps the brand fill, because it is genuinely
           * set, but washed out, because it currently does nothing. A
           * background, not more opacity — out-of-month cells are already at
           * 35%, and two dimmings multiplied together are unreadable.
           */
          const fill = working
            ? shut
              ? "bg-brand/25 text-ink-muted"
              : "bg-brand text-on-brand"
            : shut
              ? "border border-line bg-sunken text-ink-faint"
              : "border border-line text-ink-muted";

          return (
            <button
              key={cell.iso}
              type="button"
              onClick={() => toggleWeekday(cell.weekday)}
              aria-pressed={working}
              aria-label={`${WEEKDAYS[cell.weekday]?.label}s, ${working ? copy.on : copy.off}${
                shut ? ", the business is closed" : ""
              }${blocked ? `, ${copy.timeOff} on ${dateLabel(cell.iso)}` : ""}`}
              /*
                Square where there is room, never shorter than 44px anywhere.
                Seven 44px columns need the entire 320px of the narrowest phone,
                so a square that big cannot fit there — and height is the
                dimension a thumb misses on, so height is the one that holds.

                All three sizing classes are load-bearing, and `max-w-full` is
                the one that is not obvious. An aspect-ratio box transfers its
                `min-height` back through the ratio into a minimum *width*, and
                `min-w-0` does not stop it: measured at 320px, the track came out
                40px and the button rendered 44px inside it, overflowing the grid
                by 4px — the same invisible clipping as before, arriving by a
                different route. `max-w-full` clamps the button to its track,
                and the min-height keeps the 44.
              */
              className={`${CALENDAR_CELL} relative grid place-items-center rounded-control text-sm font-semibold transition-colors ${fill} ${
                cell.inMonth ? "" : "opacity-35"
              } ${cell.iso === today ? "ring-2 ring-info ring-offset-1 ring-offset-surface" : ""}`}
            >
              {cell.day}
              {/*
                Time off, shown and not touchable. A calendar that showed
                somebody working on a day they are booked off would be lying;
                editing it here would merge two tabs that are deliberately
                apart.
              */}
              {blocked ? (
                /*
                  Coloured against whatever it sits on. Amber on the brand
                  yellow of a working day is invisible — which is exactly the
                  day it most needs to be seen, because that is the one where
                  the pattern and the time off disagree.
                */
                <CalendarOff
                  className={`absolute bottom-0.5 right-0.5 h-3 w-3 ${
                    working && !shut ? "text-on-brand" : "text-caution"
                  }`}
                  aria-hidden
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-xs leading-5 text-ink-muted">
        {copy.prompt}{" "}
        {selected.length === 0 && subject === "business"
          ? "Closed every day."
          : describeWeek(selected.map((weekday) => ({ weekday, ...pattern.get(weekday)! })))}
      </p>

      {blackouts.length > 0 ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-ink-faint">
          <CalendarOff className="h-3 w-3 shrink-0 text-caution" aria-hidden />
          {copy.marked}
        </p>
      ) : null}

      {wasted.length > 0 ? (
        <p className="mt-1 flex items-start gap-1 text-xs leading-5 text-caution">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          The business is closed {listDays(wasted)}, so nobody is offered then. Open the day on
          Business hours to use it.
        </p>
      ) : null}

      {subject === "business" ? (
        <p className="mt-1 text-xs leading-5 text-ink-faint">
          Appointments are offered as 8–10, 10–12, 1–3 and 3–5, and only when the window fits
          inside these hours.
        </p>
      ) : null}

      {selected.length > 0 ? (
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-[8rem] flex-1">
              <span className="mb-1 block text-xs font-semibold text-ink-muted">Start</span>
              <TimeField
                value={shared.start}
                onChange={(next) => setSharedHours("start", next)}
                label="Start time for the selected days"
              />
            </div>
            <div className="min-w-[8rem] flex-1">
              <span className="mb-1 block text-xs font-semibold text-ink-muted">Finish</span>
              <TimeField
                value={shared.end}
                onChange={(next) => setSharedHours("end", next)}
                label="Finish time for the selected days"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowPerDay(!showPerDay)}
            aria-expanded={showPerDay}
            className="tap-target mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand"
          >
            {showPerDay ? "Same hours every day" : "Different hours on some days"}
          </button>

          {mixed && !showPerDay ? (
            <p className="text-xs text-caution">
              Some days differ. Open the list below to see them; changing the times above sets
              every day at once.
            </p>
          ) : null}

          {showPerDay ? (
            <ul className="mt-2 space-y-2">
              {selected.map((weekday) => {
                const entry = pattern.get(weekday)!;
                return (
                  <li key={weekday} className="flex flex-wrap items-start gap-2">
                    <span className="mt-3 w-full text-sm font-semibold sm:mt-0 sm:w-auto sm:min-w-[5rem] sm:flex-1">
                      {WEEKDAYS[weekday]?.label}
                    </span>
                    <div className="min-w-[7rem] flex-1">
                      <TimeField
                        value={entry.start}
                        onChange={(next) => setDayHours(weekday, "start", next)}
                        label={`${WEEKDAYS[weekday]?.label} start`}
                      />
                    </div>
                    <div className="min-w-[7rem] flex-1">
                      <TimeField
                        value={entry.end}
                        onChange={(next) => setDayHours(weekday, "end", next)}
                        label={`${WEEKDAYS[weekday]?.label} finish`}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : subject === "business" ? (
        /*
          Said before the tap, not after it. Saving no days shuts the booking
          page completely — every slot gone, for everybody — and finding that
          out from a success message would be too late.
        */
        <p className="mt-3 flex items-start gap-2 rounded-control bg-critical-bg p-3 text-xs leading-5 text-critical">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            No days open. Saving this closes the business — the booking page will offer no
            appointments at all, whoever is working.
          </span>
        </p>
      ) : (
        <p className="mt-3 rounded-control bg-sunken p-3 text-xs leading-5 text-ink-muted">
          No days selected, so they are available whenever the business is open. Tap a day to
          narrow that.
        </p>
      )}

      {state.error ? <p className="mt-2 text-sm text-critical">{state.error}</p> : null}
      {state.notice ? <p className="mt-2 text-sm text-positive">{state.notice}</p> : null}

      <button
        type="submit"
        disabled={saving}
        className="tap-target mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60"
      >
        {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {saving ? "Saving…" : "Save hours"}
      </button>
    </form>
  );
}
