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

export function DateTimeField({
  name,
  defaultValue = "",
  label,
  timeZone,
  step = 15,
}: {
  name: string;
  /** `YYYY-MM-DDTHH:mm`, as the native input took it. */
  defaultValue?: string;
  /** Names both halves, e.g. "Arrival window starts". */
  label: string;
  timeZone: string;
  step?: number;
}) {
  const [date, setDate] = useState(defaultValue.slice(0, 10));
  const [time, setTime] = useState(defaultValue.slice(11, 16));

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
        onChange={(next) => {
          setDate(next);
          // Picking a day and being left with no time is a value that never
          // posts. Eight in the morning is when this business starts.
          if (next && !time) setTime("08:00");
        }}
        label={`${label} — day`}
        timeZone={timeZone}
      />
      <TimeField value={time} onChange={setTime} label={`${label} — time`} step={step} />
    </div>
  );
}
