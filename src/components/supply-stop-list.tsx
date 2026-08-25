"use client";

import { useActionState, useState } from "react";
import { LoaderCircle, MapPin, Plus, Star, Trash2, X } from "lucide-react";

import {
  makeDefaultSupplyStop,
  removeSupplyStop,
  saveSupplyStop,
  type SupplyStopState,
} from "@/app/supply-stops/actions";
import { AddressFields } from "@/components/ui/address-fields";
import { Field, FormMessage, TextInput, inputClass } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import type { SupplyStopRow } from "@/lib/job-data";
import { SUPPLY_STOP_KINDS, supplyStopLabel } from "@/lib/supply-stops";

/**
 * The list of places, and the form that adds one.
 *
 * The address uses the same self-filling boxes as the new job form, which is
 * the point of having built them once: a storage unit up a farm track and a
 * Lowe's are both just addresses, and neither is worth typing four fields for.
 */

const initialState: SupplyStopState = { error: "" };

function StopForm({ stop, onDone }: { stop?: SupplyStopRow; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveSupplyStop, initialState);
  const [kind, setKind] = useState(stop?.kind ?? "supplier");

  return (
    <form action={action} className="rounded-panel border border-line bg-raised p-4">
      {stop ? <input type="hidden" name="id" value={stop.id} /> : null}
      <input type="hidden" name="kind" value={kind} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What you call it">
          <TextInput
            name="name"
            required
            defaultValue={stop?.name ?? ""}
            placeholder="The storage unit"
          />
        </Field>

        <Field label="What kind of place">
          <SelectField
            label="What kind of place"
            choices={SUPPLY_STOP_KINDS.map((entry) => ({ value: entry.value, label: entry.label }))}
            value={kind}
            onChange={setKind}
          />
        </Field>

        <AddressFields
          defaults={{
            line1: stop?.address ?? "",
            city: stop?.city ?? "",
            state: stop?.state ?? "",
            postalCode: stop?.postalCode ?? "",
          }}
        />

        <div className="sm:col-span-2">
          <Field label="Anything worth remembering">
            <input
              name="notes"
              defaultValue={stop?.notes ?? ""}
              placeholder="Gate code, which aisle, who to ask for"
              className={inputClass}
            />
          </Field>
        </div>
      </div>

      <div className="mt-3">
        <FormMessage error={state.error} notice={state.notice} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="tap-target inline-flex items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60"
        >
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {stop ? "Save changes" : "Add the stop"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="tap-target inline-flex items-center gap-1 rounded-control border border-line px-4 text-sm font-semibold text-ink-muted"
        >
          <X className="h-4 w-4" aria-hidden />
          Cancel
        </button>
      </div>
    </form>
  );
}

function RowActions({ stop }: { stop: SupplyStopRow }) {
  const [defaultState, makeDefault, settingDefault] = useActionState(
    makeDefaultSupplyStop,
    initialState,
  );
  const [removeState, remove] = useActionState(removeSupplyStop, initialState);

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {stop.isDefault ? (
        <span className="grid h-9 w-9 place-items-center rounded-control bg-brand/15 text-brand">
          <Star className="h-4 w-4 fill-current" aria-hidden />
          <span className="sr-only">Routed through first</span>
        </span>
      ) : (
        <form action={makeDefault}>
          <input type="hidden" name="id" value={stop.id} />
          <button
            type="submit"
            disabled={settingDefault}
            aria-label={`Route through ${stop.name} first`}
            className="grid h-9 w-9 place-items-center rounded-control border border-line text-ink-faint disabled:opacity-60"
          >
            {settingDefault ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Star className="h-4 w-4" aria-hidden />
            )}
          </button>
        </form>
      )}

      <form action={remove}>
        <input type="hidden" name="id" value={stop.id} />
        <button
          type="submit"
          aria-label={`Remove ${stop.name}`}
          className="grid h-9 w-9 place-items-center rounded-control border border-line text-ink-faint"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </form>

      {defaultState.error || removeState.error ? (
        <span className="sr-only">{defaultState.error || removeState.error}</span>
      ) : null}
    </div>
  );
}

export function SupplyStopList({ stops }: { stops: SupplyStopRow[] }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState("");

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => {
          setAdding((current) => !current);
          setEditing("");
        }}
        className="tap-target inline-flex items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add a stop
      </button>

      {adding ? <StopForm onDone={() => setAdding(false)} /> : null}

      {stops.length === 0 && !adding ? (
        <p className="rounded-panel border border-dashed border-line p-8 text-center text-sm leading-6 text-ink-muted">
          No stops yet. Add the supply house you actually use, or your own storage — the route puts
          the one you pick before the first job that needs materials.
        </p>
      ) : null}

      <ul className="space-y-2">
        {stops.map((stop) => (
          <li key={stop.id} className="rounded-control border border-line">
            {editing === stop.id ? (
              <StopForm stop={stop} onDone={() => setEditing("")} />
            ) : (
              <div className="flex items-center gap-3 p-3">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(stop.id);
                    setAdding(false);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-white/5 text-brand">
                    <MapPin className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {stop.name}
                      {stop.isDefault ? (
                        <span className="ml-2 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand">
                          first stop
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-ink-muted">
                      {[stop.address, stop.city].filter(Boolean).join(", ")}
                    </span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {[supplyStopLabel(stop.kind), stop.notes]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>

                <RowActions stop={stop} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
