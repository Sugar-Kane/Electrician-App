"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { CALENDAR_CELL, CALENDAR_ROW } from "@/components/ui/calendar-grid";
import { PopoverField, usePopoverClose } from "@/components/ui/popover-field";
import { shiftDays } from "@/lib/calendar";
import {
  dateLabel,
  monthGrid,
  monthLabel,
  shiftMonth,
  todayIso,
} from "@/lib/electrician-calendar";
import { WEEKDAYS } from "@/lib/electrician-hours";

/**
 * A day, from a calendar the app drew.
 *
 * Replaces `<input type="date">`, whose picker on a phone is an operating-system
 * panel — system blue, system layout, nothing of this app in it, and no CSS
 * anywhere near it.
 *
 * The month arithmetic is `electrician-calendar.ts`, already tested to death for
 * the weekly hours grid: months starting on a Saturday, February in a leap year,
 * and above all that column *n* is weekday *n*, which is the off-by-one that
 * would set the wrong day while looking perfectly fine.
 */

export function DateField({
  name,
  defaultValue = "",
  value,
  onChange,
  label,
  placeholder = "Pick a day",
  timeZone,
  disabled,
  required,
}: {
  name?: string;
  defaultValue?: string;
  /** Controlled. Leave unset for the ordinary form case. */
  value?: string;
  onChange?: (value: string) => void;
  /** Names the calendar for a screen reader, e.g. "First day off". */
  label: string;
  placeholder?: string;
  /** The business's clock, so "today" is ringed on the right date. */
  timeZone: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const [own, setOwn] = useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : own;

  function choose(next: string) {
    if (!controlled) setOwn(next);
    onChange?.(next);
  }

  return (
    <PopoverField
      name={name}
      value={current}
      display={dateLabel(current)}
      placeholder={placeholder}
      panelLabel={label}
      haspopup="dialog"
      icon={<CalendarDays className="h-4 w-4" aria-hidden />}
      disabled={disabled}
      required={required}
    >
      <MonthPicker current={current} label={label} timeZone={timeZone} onChoose={choose} />
    </PopoverField>
  );
}

/**
 * The open calendar.
 *
 * Mounted fresh on each open, so it always starts on the month of the chosen
 * day without an effect that has to work out when to re-run.
 */
function MonthPicker({
  current,
  label,
  timeZone,
  onChoose,
}: {
  current: string;
  label: string;
  timeZone: string;
  onChoose: (iso: string) => void;
}) {
  const today = todayIso(timeZone);
  const start = current || today;

  const close = usePopoverClose();
  const grid = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(start);
  const [viewing, setViewing] = useState(() => ({
    year: Number(start.slice(0, 4)),
    month: Number(start.slice(5, 7)),
  }));

  useEffect(() => {
    grid.current?.focus();
  }, []);

  function pick(iso: string) {
    onChoose(iso);
    close();
  }

  /**
   * Move the keyboard, following it with the month.
   *
   * Arrowing off the end of a month has to turn the page, or the days between
   * the 31st and the 1st are simply unreachable without the mouse.
   */
  function moveTo(iso: string) {
    setActive(iso);
    const year = Number(iso.slice(0, 4));
    const month = Number(iso.slice(5, 7));
    setViewing((seen) => (seen.year === year && seen.month === month ? seen : { year, month }));
  }

  function onKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        return moveTo(shiftDays(active, -1));
      case "ArrowRight":
        event.preventDefault();
        return moveTo(shiftDays(active, 1));
      case "ArrowUp":
        event.preventDefault();
        return moveTo(shiftDays(active, -7));
      case "ArrowDown":
        event.preventDefault();
        return moveTo(shiftDays(active, 7));
      case "Home":
        event.preventDefault();
        // The Sunday of this week, matching the column order.
        return moveTo(shiftDays(active, -new Date(`${active}T00:00:00Z`).getUTCDay()));
      case "End":
        event.preventDefault();
        return moveTo(shiftDays(active, 6 - new Date(`${active}T00:00:00Z`).getUTCDay()));
      case "PageUp":
      case "PageDown": {
        event.preventDefault();
        const next = shiftMonth(viewing.year, viewing.month, event.key === "PageUp" ? -1 : 1);
        setViewing(next);
        // Clamped, so paging from the 31st into a 30-day month lands on a date
        // that exists rather than silently skipping a month.
        const days = new Date(Date.UTC(next.year, next.month, 0)).getUTCDate();
        const day = Math.min(Number(active.slice(8, 10)), days);
        setActive(
          `${String(next.year).padStart(4, "0")}-${String(next.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        );
        return;
      }
      case "Enter":
      case " ":
        event.preventDefault();
        return pick(active);
      default:
        return;
    }
  }

  const weeks = monthGrid(viewing.year, viewing.month);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setViewing((seen) => shiftMonth(seen.year, seen.month, -1))}
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
          onClick={() => setViewing((seen) => shiftMonth(seen.year, seen.month, 1))}
          aria-label="Next month"
          className="tap-target grid h-11 w-11 place-items-center rounded-control border border-line"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/*
        `aria-activedescendant` rather than moving focus between 42 buttons.
        Focus stays on the grid, so it cannot be stranded on a cell that
        unmounted when the month turned over.
      */}
      <div
        ref={grid}
        role="grid"
        aria-label={label}
        tabIndex={-1}
        aria-activedescendant={`day-${active}`}
        onKeyDown={onKeyDown}
        className="mt-2 outline-none"
      >
        <div role="row" className={CALENDAR_ROW}>
          {WEEKDAYS.map((day) => (
            <span
              key={day.value}
              role="columnheader"
              aria-label={day.label}
              className="grid h-7 place-items-center text-[11px] font-bold uppercase tracking-wide text-ink-faint"
            >
              {day.short.slice(0, 1)}
            </span>
          ))}
        </div>

        {weeks.map((week) => (
          <div key={week[0]!.iso} role="row" className={`${CALENDAR_ROW} mt-0.5 sm:mt-1`}>
            {week.map((cell) => {
              const selected = cell.iso === current;
              const isToday = cell.iso === today;

              return (
                <button
                  key={cell.iso}
                  id={`day-${cell.iso}`}
                  role="gridcell"
                  type="button"
                  tabIndex={-1}
                  aria-selected={selected}
                  aria-current={isToday ? "date" : undefined}
                  aria-label={dateLabel(cell.iso)}
                  onClick={() => pick(cell.iso)}
                  className={`${CALENDAR_CELL} grid place-items-center rounded-control text-sm font-semibold transition-colors ${
                    selected ? "bg-brand text-on-brand" : "border border-line text-ink-muted"
                  } ${cell.inMonth ? "" : "opacity-35"} ${
                    isToday && !selected ? "ring-2 ring-info ring-offset-1 ring-offset-sunken" : ""
                  } ${cell.iso === active ? "outline outline-2 outline-brand outline-offset-1" : ""}`}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
