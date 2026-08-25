"use client";

import { useState } from "react";
import { LoaderCircle, Plus, Sparkles, Trash2 } from "lucide-react";

import { estimateWorkOrder } from "@/app/jobs/new/estimate-actions";
import { Field, TextInput, inputClass } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { centsToInput, keepMoneyCharacters, keepQuantityCharacters } from "@/lib/money-input";
import { parseCostToCents, MAX_WORK_ORDER_LINES } from "@/lib/new-job-input";

/**
 * What the work order is made of.
 *
 * Only on screen for a work order — a diagnostic is two hours to find out what
 * is wrong, and itemising it in advance would be pretending to know the answer.
 *
 * The lines post as JSON in one hidden field. Thirty numbered inputs would be
 * the other way to do it, and every one of them would have to be named,
 * validated and put back after a rejected save.
 *
 * The AI writes a first draft and nothing more. Every figure it returns lands
 * in an ordinary editable box, nothing is written until the owner saves, and
 * the panel says so. A model quietly setting the price of somebody's work would
 * be the worst feature in this app.
 */

type Line = {
  /** Local only. Rows need a stable key while they are being edited. */
  key: string;
  kind: "labor" | "material";
  description: string;
  /** Kept as typed, so a half-typed "1." is not rewritten under the cursor. */
  quantity: string;
  unit: string;
  price: string;
};

const KINDS = [
  { value: "labor", label: "Labour" },
  { value: "material", label: "Material" },
] as const;

let counter = 0;
function nextKey(): string {
  counter += 1;
  return `line-${counter}`;
}

function blankLine(kind: Line["kind"] = "labor"): Line {
  return {
    key: nextKey(),
    kind,
    description: "",
    quantity: "1",
    unit: kind === "labor" ? "hour" : "each",
    price: "",
  };
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function WorkOrderLines({
  /** How to read the job, so the draft is about this job and not about jobs. */
  describedBy,
  defaultValue = "",
}: {
  describedBy: () => string;
  /** The JSON posted last time, when a rejected save is being restored. */
  defaultValue?: string;
}) {
  const [lines, setLines] = useState<Line[]>(() => restore(defaultValue));
  const [drafting, setDrafting] = useState(false);
  const [problem, setProblem] = useState("");

  const total = lines.reduce((sum, line) => {
    const quantity = Number(line.quantity);
    const cents = parseCostToCents(line.price) ?? 0;
    return sum + (Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity * cents) : 0);
  }, 0);

  function edit(key: string, change: Partial<Line>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );
  }

  function remove(key: string) {
    setLines((current) => current.filter((line) => line.key !== key));
  }

  async function draft() {
    setProblem("");
    setDrafting(true);
    const result = await estimateWorkOrder({ description: describedBy() });
    setDrafting(false);

    if (result.problem) {
      setProblem(result.problem);
      return;
    }

    /*
     * Added to what is already there rather than replacing it. Somebody who
     * typed two lines and then asked for help has not asked to lose them.
     */
    setLines((current) => {
      const kept = current.filter((line) => line.description.trim());
      const drafted = result.lines.map<Line>((line) => ({
        key: nextKey(),
        kind: line.kind,
        description: line.description,
        quantity: String(line.quantity),
        unit: line.unit,
        price: centsToInput(line.unitPriceCents),
      }));
      return [...kept, ...drafted].slice(0, MAX_WORK_ORDER_LINES);
    });
  }

  const posted = JSON.stringify(
    lines
      .filter((line) => line.description.trim())
      .map((line) => ({
        kind: line.kind,
        description: line.description,
        quantity: Number(line.quantity) || 0,
        unit: line.unit,
        unitPriceCents: parseCostToCents(line.price) ?? 0,
      })),
  );

  return (
    <div className="sm:col-span-2">
      <input type="hidden" name="workOrderLines" value={posted} />

      <div className="rounded-panel border border-line bg-raised p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">What the work order covers</h3>
          <button
            type="button"
            onClick={() => void draft()}
            disabled={drafting}
            className="tap-target inline-flex items-center gap-2 rounded-control border border-brand/40 px-3 text-sm font-semibold text-brand disabled:opacity-60"
          >
            {drafting ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden />
            )}
            {drafting ? "Drafting" : "Draft it for me"}
          </button>
        </div>

        <p className="mt-2 text-xs leading-5 text-ink-faint">
          A draft is a starting point — check every figure before it goes out. Nothing is saved
          until you press Save.
        </p>

        {problem ? <p className="mt-2 text-xs leading-5 text-critical">{problem}</p> : null}

        <ul className="mt-3 space-y-3">
          {lines.map((line) => (
            <li key={line.key} className="rounded-control border border-line bg-surface p-3">
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <Field label="What it is">
                  <TextInput
                    value={line.description}
                    onChange={(event) => edit(line.key, { description: event.target.value })}
                    placeholder="Pull a new 20A circuit to the garage"
                    maxLength={300}
                  />
                </Field>

                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => remove(line.key)}
                    aria-label={`Remove ${line.description || "this line"}`}
                    className="tap-target inline-flex items-center justify-center rounded-control border border-line px-3 text-ink-muted"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Kind">
                  <SelectField
                    label="Kind of line"
                    choices={KINDS}
                    value={line.kind}
                    onChange={(next) =>
                      edit(line.key, {
                        kind: next === "material" ? "material" : "labor",
                        // The unit follows the kind unless it has been changed.
                        unit:
                          line.unit === "hour" || line.unit === "each"
                            ? next === "material"
                              ? "each"
                              : "hour"
                            : line.unit,
                      })
                    }
                  />
                </Field>

                <Field label="How many">
                  <TextInput
                    value={line.quantity}
                    onChange={(event) =>
                      edit(line.key, { quantity: keepQuantityCharacters(event.target.value) })
                    }
                    inputMode="decimal"
                    placeholder="1"
                  />
                </Field>

                <Field label="Unit">
                  <TextInput
                    value={line.unit}
                    onChange={(event) => edit(line.key, { unit: event.target.value })}
                    maxLength={24}
                    placeholder="hour"
                  />
                </Field>

                <Field label="Each">
                  <TextInput
                    value={line.price}
                    onChange={(event) =>
                      edit(line.key, { price: keepMoneyCharacters(event.target.value) })
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </Field>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setLines((current) => [...current, blankLine()])}
            disabled={lines.length >= MAX_WORK_ORDER_LINES}
            className={`${inputClass} tap-target inline-flex w-auto items-center gap-2 text-sm font-semibold text-ink disabled:opacity-60`}
          >
            <Plus className="h-4 w-4" aria-hidden /> Add a line
          </button>

          <p className="text-sm text-ink-muted">
            Lines add up to <span className="font-semibold text-ink">{money(total)}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The lines a rejected save is handing back.
 *
 * Read defensively — this is the same JSON the server parses, so anything
 * malformed reads as an empty list and the owner starts from a blank row rather
 * than from a crash.
 */
function restore(value: string): Line[] {
  if (!value.trim()) return [blankLine()];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0) return [blankLine()];

    return parsed.slice(0, MAX_WORK_ORDER_LINES).map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const kind = row.kind === "material" ? "material" : "labor";
      const price = Number(row.unitPriceCents);

      return {
        key: nextKey(),
        kind,
        description: typeof row.description === "string" ? row.description : "",
        quantity: String(Number(row.quantity) || 1),
        unit: typeof row.unit === "string" && row.unit ? row.unit : kind === "labor" ? "hour" : "each",
        price: centsToInput(Number.isFinite(price) ? price : 0),
      };
    });
  } catch {
    return [blankLine()];
  }
}
