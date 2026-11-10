"use client";

import { useState } from "react";
import { DateField } from "@/components/ui/date-field";

import { inputClass } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * How a task repeats. Empty "Repeats" means no change (or no repeat on a new
 * task). Monthly on a day a month lacks uses its last day, which is said here.
 */
export function RepeatFields({ label = "Repeats", timeZone }: { label?: string; timeZone: string }) {
  const [freq, setFreq] = useState("");
  return (
    <fieldset className="grid gap-3 sm:col-span-2">
      <div className="grid gap-1 text-xs font-semibold text-ink-muted">
        <span>{label}</span>
        <SelectField
          name="repeat_freq"
          label={label}
          value={freq}
          onChange={setFreq}
          choices={[
            { value: "", label: label === "Repeats" ? "Does not repeat" : "No change" },
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
            { value: "monthly", label: "Monthly" },
          ]}
        />
      </div>
      {freq ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-ink-muted">
            Every
            <input type="number" name="repeat_interval" min={1} max={99} defaultValue={1} className={inputClass} />
          </label>
          {freq === "monthly" ? (
            <label className="grid gap-1 text-xs font-semibold text-ink-muted">
              On day of the month
              <input type="number" name="repeat_monthday" min={1} max={31} placeholder="Due date's day" className={inputClass} />
            </label>
          ) : null}
          {freq === "weekly" ? (
            <div role="group" aria-label="On these days" className="flex flex-wrap gap-2 sm:col-span-2">
              {DAYS.map((day, index) => (
                <label key={day} className="tap-target inline-flex min-h-10 items-center gap-1.5 rounded-control border border-line px-3 text-sm text-ink">
                  <input type="checkbox" name="repeat_weekdays" value={index} />
                  {day}
                </label>
              ))}
            </div>
          ) : null}
          <div className="grid gap-1 text-xs font-semibold text-ink-muted">
            <span>Until (optional)</span>
            <DateField name="repeat_until" label="Until" timeZone={timeZone} placeholder="No end date" />
          </div>
          <label className="grid gap-1 text-xs font-semibold text-ink-muted">
            Or this many times (optional)
            <input type="number" name="repeat_count" min={1} max={500} className={inputClass} />
          </label>
          <p className="text-xs leading-5 text-ink-faint sm:col-span-2">
            Each time is its own task, made a week ahead. It needs a due date, which is the first time.
            {freq === "monthly" ? " Months without that day use their last day." : ""}
            {freq === "weekly" ? " No day picked means the due date's weekday." : ""}
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}
