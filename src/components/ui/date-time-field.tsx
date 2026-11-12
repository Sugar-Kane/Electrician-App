"use client";

import { useState } from "react";

import { DateField } from "@/components/ui/date-field";
import { TimeField } from "@/components/ui/time-field";

/**
 * A day and a time, posting the one string the server already reads.
 *
 * Replaces `<input type="datetime-local">`, which on a phone is the largest of
 * the system panels — two of them, in fact, one stacked on the other.
 *
 * The contract is the thing to be careful about here. `zonedWallClockToIso`
 * (`src/app/jobs/[jobId]/actions.ts`) parses exactly `YYYY-MM-DDTHH:mm` and
 * reads it as wall-clock time in the business's zone. Post anything else and a
 * job is scheduled at the wrong hour, which is the worst outcome available on
 * this screen — somebody drives to a house at the wrong time.
 *
 * Empty stays empty. `new-job-form` treats a blank start as "save it
 * unscheduled", so half a value has to post as nothing rather than as midnight
 * on a day nobody picked.
 */

/**
 * Two hours after a `YYYY-MM-DDTHH:mm` start, on the same day: the usual
 * arrival window. Stops at 23:45 rather than spilling into tomorrow; "" when
 * there is no start, or no room left in the day.
 */
export function arrivalWindowEnd(start: string, hours = 2): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(start);
  if (!match) return "";
  const startMinutes = Number(match[2]) * 60 + Number(match[3]);
  const endMinutes = Math.min(startMinutes + hours * 60, 23 * 60 + 45);
  if (endMinutes <= startMinutes) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${match[1]}T${pad(Math.floor(endMinutes / 60))}:${pad(endMinutes % 60)}`;
}

export function DateTimeField({
  name,
  defaultValue = "",
  label,
  timeZone,
  step = 15,
  onValueChange,
  windowFrom,
}: {
  name: string;
  /** `YYYY-MM-DDTHH:mm`, as the native input took it. */
  defaultValue?: string;
  /** Names both halves, e.g. "Arrival window starts". */
  label: string;
  timeZone: string;
  step?: number;
  /** Told the posted value whenever it changes: `YYYY-MM-DDTHH:mm`, or "". */
  onValueChange?: (value: string) => void;
  /**
   * The start of an arrival window this field ends. Each time it changes,
   * this field moves to two hours later the same day, until somebody picks
   * an end by hand.
   */
  windowFrom?: string;
}) {
  const [date, setDate] = useState(defaultValue.slice(0, 10));
  const [time, setTime] = useState(defaultValue.slice(11, 16));
  const [touched, setTouched] = useState(false);
  const [followed, setFollowed] = useState(windowFrom);

  // Adjusted while rendering rather than in an effect, so the new end is
  // drawn in the same pass as the start that set it.
  if (windowFrom !== followed) {
    setFollowed(windowFrom);
    const end = windowFrom ? arrivalWindowEnd(windowFrom) : "";
    if (end && !touched) {
      setDate(end.slice(0, 10));
      setTime(end.slice(11, 16));
    }
  }

  function pick(nextDate: string, nextTime: string) {
    setTouched(true);
    update(nextDate, nextTime);
  }

  function update(nextDate: string, nextTime: string) {
    setDate(nextDate);
    setTime(nextTime);
    onValueChange?.(nextDate && nextTime ? `${nextDate}T${nextTime}` : "");
  }

  /*
   * Stacked, not side by side. The calendar expands in flow underneath its
   * field, so its width is whatever column it is in — sharing a line with the
   * time field halved it, and the day cells measured 20px across at 390px.
   * The time list is happy narrow; the calendar is not, so the calendar gets
   * the row.
   */
  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={date && time ? `${date}T${time}` : ""} />

      <DateField
        value={date}
        // Picking a day and being left with no time is a value that never
        // posts. Eight in the morning is when this business starts.
        onChange={(next) => pick(next, next && !time ? "08:00" : time)}
        label={`${label} — day`}
        timeZone={timeZone}
      />
      <TimeField value={time} onChange={(next) => pick(date, next)} label={`${label} — time`} step={step} />
    </div>
  );
}
