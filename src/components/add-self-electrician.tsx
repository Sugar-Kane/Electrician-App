"use client";

import { useActionState } from "react";
import { HardHat, LoaderCircle } from "lucide-react";

import { addSelfAsElectrician, type ElectricianState } from "@/app/technicians/actions";

/**
 * The owner putting themselves on the crew.
 *
 * Offered only when they are not already on it, because in a one-person
 * business this is the first thing that has to happen and there was previously
 * no way to do it at all: the owner could invite other people and never appear
 * on the schedule themselves.
 */

const initialState: ElectricianState = { error: "" };

export function AddSelfElectrician() {
  const [state, add, adding] = useActionState(addSelfAsElectrician, initialState);

  return (
    <form action={add} className="rounded-panel border border-dashed border-line p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <HardHat className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">You are not on the crew</h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            Add yourself to be assigned jobs, set your own hours, and be offered to customers
            booking online.
          </p>

          {state.error ? <p className="mt-2 text-sm text-critical">{state.error}</p> : null}
          {state.notice ? <p className="mt-2 text-sm text-positive">{state.notice}</p> : null}

          <button
            type="submit"
            disabled={adding}
            className="tap-target mt-3 inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60"
          >
            {adding ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {adding ? "Adding…" : "Add myself as an electrician"}
          </button>
        </div>
      </div>
    </form>
  );
}
