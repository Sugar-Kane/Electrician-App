"use client";

import { useState } from "react";
import { Clock } from "lucide-react";

import { SelectField } from "@/components/ui/select-field";
import { timeOptions } from "@/lib/time-options";

/**
 * A time of day, from a list the app drew.
 *
 * A list rather than a wheel, because it is a select over the times of a day
 * and building a second interaction for that would be inventing work: the
 * listbox already has arrow keys, Home and End, type-ahead — "5" jumps to five
 * o'clock — and screen-reader announcement.
 *
 * The step is the caller's business. Business opening hours land on the half
 * hour and a 96-entry list to find nine o'clock in is a worse control; arrival
 * windows are genuinely quarter-hourly.
 *
 * `timeOptions` guarantees the value already saved is on the list even when the
 * step would not produce it, which is the whole reason that lives in a tested
 * library rather than a loop written here.
 */

export function TimeField({
  name,
  defaultValue = "",
  value,
  onChange,
  label,
  step = 30,
  disabled,
  required,
}: {
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  /** Names the list for a screen reader, e.g. "Start time". */
  label: string;
  /** Minutes between offered times. 30 for opening hours, 15 for a job. */
  step?: number;
  disabled?: boolean;
  required?: boolean;
}) {
  // Only ever used to keep the saved time on the list. The chosen value itself
  // lives in SelectField, or in the caller when it is controlled.
  const [seed] = useState(value ?? defaultValue);

  return (
    <SelectField
      name={name}
      choices={timeOptions(step, seed).map((option) => ({
        value: option.value,
        label: option.label,
        odd: option.offStep,
      }))}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      label={label}
      placeholder="Pick a time"
      icon={<Clock className="h-4 w-4" aria-hidden />}
      disabled={disabled}
      required={required}
    />
  );
}
