"use client";

import { useActionState, useState } from "react";
import { LoaderCircle, Minus, Plus } from "lucide-react";

import { adjustStock, type InventoryState } from "@/app/inventory/actions";
import { FormMessage, inputClass } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { MOVEMENT_REASONS } from "@/lib/inventory-movement";
import { keepQuantityCharacters } from "@/lib/money-input";

/**
 * Stock in and out, with a reason.
 *
 * Two buttons rather than a signed number, because "three came back" and "three
 * went missing" are different sentences and typing `-3` is neither of them. The
 * reason is what makes the history readable later — a column of adjustments
 * with no reasons is a column of numbers nobody can audit.
 *
 * `used_on_job` is not on this list on purpose. Parts leave for a job by being
 * added to that job, which is the whole point: nobody deducts by hand.
 */

const initialState: InventoryState = { error: "" };

const IN_REASONS = MOVEMENT_REASONS.filter(
  (reason) => reason.direction === "in" && reason.value !== "opening",
).map((reason) => ({ value: reason.value, label: reason.label }));

const OUT_REASONS = MOVEMENT_REASONS.filter(
  (reason) => reason.direction === "out" && reason.value !== "used_on_job",
).map((reason) => ({ value: reason.value, label: reason.label }));

export function StockAdjust({ itemId, unit }: { itemId: string; unit: string }) {
  const [state, action, pending] = useActionState(adjustStock, initialState);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [quantity, setQuantity] = useState("");

  const choices = direction === "in" ? IN_REASONS : OUT_REASONS;
  const [reason, setReason] = useState<string>(choices[0]?.value ?? "received");

  function swap(next: "in" | "out") {
    setDirection(next);
    const list = next === "in" ? IN_REASONS : OUT_REASONS;
    setReason(list[0]?.value ?? "received");
  }

  return (
    <form action={action} className="rounded-panel border border-line bg-surface p-4 sm:p-5">
      <input type="hidden" name="id" value={itemId} />
      <input type="hidden" name="reason" value={reason} />

      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-muted">
        Move stock
      </h2>

      <div className="mt-3 inline-flex rounded-control border border-line p-1" role="group">
        {(["in", "out"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => swap(option)}
            aria-pressed={direction === option}
            className={`tap-target inline-flex min-w-20 items-center justify-center gap-1 rounded-chip px-3 text-xs font-semibold ${
              direction === option ? "bg-brand text-on-brand" : "text-ink-muted hover:text-ink"
            }`}
          >
            {option === "in" ? (
              <Plus className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Minus className="h-3.5 w-3.5" aria-hidden />
            )}
            {option === "in" ? "In" : "Out"}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-ink-muted">How many</span>
          <input
            name="quantity"
            value={quantity}
            onChange={(event) => setQuantity(keepQuantityCharacters(event.target.value))}
            inputMode="decimal"
            placeholder={`3 ${unit}`}
            className={`${inputClass} mt-1`}
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink-muted">What happened</span>
          <span className="mt-1 block">
            <SelectField
              label="What happened to it"
              choices={choices}
              value={reason}
              onChange={setReason}
            />
          </span>
        </label>

        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-ink-muted">Note</span>
          <input
            name="note"
            placeholder="Optional — where they went, who took them"
            className={`${inputClass} mt-1`}
          />
        </label>
      </div>

      <div className="mt-3">
        <FormMessage error={state.error} notice={state.notice} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="tap-target mt-3 inline-flex w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60 sm:w-auto"
      >
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {pending ? "Recording" : "Record it"}
      </button>
    </form>
  );
}
