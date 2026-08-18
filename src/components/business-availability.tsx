"use client";

import { useState } from "react";
import { CalendarOff, ChevronDown, Clock, Store } from "lucide-react";

import { saveBusinessHours } from "@/app/technicians/actions";
import { BlackoutManager } from "@/components/blackout-manager";
import { HoursCalendar } from "@/components/hours-calendar";
import type { DateHours } from "@/lib/date-hours";
import { describeWeek, type DayHours } from "@/lib/electrician-hours";
import type { TechnicianBlackout } from "@/lib/job-data";

/**
 * When the business is open, and the days it is shut.
 *
 * Above the crew rather than inside it, because neither is a property of any one
 * electrician — they outrank all of them. A closed day is skipped before
 * anybody's availability is counted, so hiring somebody in November cannot
 * accidentally reopen Christmas, and setting a person to work Saturdays cannot
 * open a business that shuts on Saturdays.
 *
 * Hours belong here rather than in Settings for the same reason the closures do:
 * everything that changes what a customer is offered is on one screen. Settings
 * points at it instead of holding a second copy of the same form.
 *
 * The card is shaped like an electrician's on purpose — tap the row, then Hours
 * or Closed. It is the same job for a different subject, and looking different
 * would suggest it worked differently.
 */

export function BusinessAvailability({
  hours,
  dateHours,
  closures,
  timeZone,
}: {
  hours: DayHours[];
  /** Days the business set its own hours for, whatever the usual week says. */
  dateHours: DateHours[];
  closures: TechnicianBlackout[];
  timeZone: string;
}) {
  const [sheet, setSheet] = useState<"closed" | "hours" | "time-off">("closed");
  const open = sheet !== "closed";

  return (
    <section className="rounded-panel border border-line bg-surface p-4 sm:p-5">
      <button
        type="button"
        onClick={() => setSheet(open ? "closed" : "hours")}
        aria-expanded={open}
        className="tap-row flex min-h-[52px] w-full items-center gap-3 text-left"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-caution-bg">
          <Store className="h-5 w-5 text-caution" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">Business hours</span>
          {/*
            The open days on the closed row, the same way an electrician's week
            reads without opening their card. "Closed every day" is worth seeing
            from here more than anything else this row could say.
          */}
          <span className="block truncate text-xs text-ink-muted">
            {hours.length === 0 ? "Closed every day" : describeWeek(hours)}
            {closures.length > 0
              ? ` · ${closures.length} ${closures.length === 1 ? "closure" : "closures"}`
              : ""}
          </span>
        </span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open ? (
        /* Padding-free on a phone for the same reason as an electrician's card:
           it is the calendar's width, one nesting level at a time. */
        <div className="mt-3 rounded-control border-line sm:border sm:p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setSheet("hours")}
              aria-pressed={sheet === "hours"}
              className={`tap-target flex min-h-12 items-center gap-2 rounded-control border px-3 text-left text-sm ${
                sheet === "hours" ? "border-brand bg-brand/10" : "border-line"
              }`}
            >
              <Clock className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-semibold">Hours</span>
            </button>

            <button
              type="button"
              onClick={() => setSheet("time-off")}
              aria-pressed={sheet === "time-off"}
              className={`tap-target flex min-h-12 items-center gap-2 rounded-control border px-3 text-left text-sm ${
                sheet === "time-off" ? "border-brand bg-brand/10" : "border-line"
              }`}
            >
              <CalendarOff className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-semibold">
                {closures.length === 0 ? "Closed" : `Closed · ${closures.length}`}
              </span>
            </button>
          </div>

          {sheet === "hours" ? (
            <HoursCalendar
              action={saveBusinessHours}
              subject="business"
              hours={hours}
              dateHours={dateHours}
              blackouts={closures}
              timeZone={timeZone}
            />
          ) : null}
          {sheet === "time-off" ? (
            <div className="mt-3">
              <BlackoutManager
                blackouts={closures}
                emptyText="The business is open on every working day."
                addLabel="Close the business"
                timeZone={timeZone}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
