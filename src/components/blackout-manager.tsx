"use client";

import { useActionState, useState } from "react";
import { CalendarOff, LoaderCircle, Plus, Trash2 } from "lucide-react";

import { addBlackout, removeBlackout, type ElectricianState } from "@/app/technicians/actions";
import type { TechnicianBlackout } from "@/lib/job-data";

/**
 * Time nobody is available, whether that is one electrician or the whole shop.
 *
 * One component for both, because they are the same thing at different scopes
 * and a second copy would be the one that drifts — the day somebody fixes the
 * timezone handling in the business version and not the personal one.
 *
 * The difference is a single hidden field: no electrician named means the
 * business is closed.
 */

const initialState: ElectricianState = { error: "" };

export function BlackoutManager({
  technicianId,
  blackouts,
  emptyText,
  addLabel,
}: {
  /** Omitted for a business-wide closure. */
  technicianId?: string;
  blackouts: TechnicianBlackout[];
  emptyText: string;
  addLabel: string;
}) {
  const [addState, add, adding] = useActionState(addBlackout, initialState);
  const [removeState, remove] = useActionState(removeBlackout, initialState);
  const [allDay, setAllDay] = useState(true);

  return (
    <div className="rounded-control border border-line p-3">
      {blackouts.length > 0 ? (
        <ul className="mb-3 space-y-2">
          {blackouts.map((blackout) => (
            <li
              key={blackout.id}
              className="flex items-center gap-2 rounded-control border border-line px-3 py-2"
            >
              <CalendarOff className="h-4 w-4 shrink-0 text-caution" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{blackout.label}</span>
                {blackout.reason ? (
                  <span className="block truncate text-xs text-ink-muted">{blackout.reason}</span>
                ) : null}
              </span>
              <form action={remove}>
                <input type="hidden" name="blackoutId" value={blackout.id} />
                <button
                  type="submit"
                  aria-label={`Remove time off on ${blackout.label}`}
                  className="tap-target grid h-11 w-11 shrink-0 place-items-center rounded-control border border-line text-critical"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-xs text-ink-muted">{emptyText}</p>
      )}

      {removeState.error ? (
        <p className="mb-2 text-sm text-critical">{removeState.error}</p>
      ) : null}

      <form action={add} className="space-y-2">
        {technicianId ? (
          <input type="hidden" name="technicianId" value={technicianId} />
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">From</span>
            <input
              type="date"
              name="startDate"
              required
              className="min-h-12 w-full rounded-control border border-line bg-transparent px-3 text-sm"
            />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">To</span>
            <input
              type="date"
              name="endDate"
              className="min-h-12 w-full rounded-control border border-line bg-transparent px-3 text-sm"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            name="allDay"
            value="yes"
            checked={allDay}
            onChange={(event) => setAllDay(event.target.checked)}
            className="h-5 w-5 rounded border-line"
          />
          All day
        </label>

        {/*
          Hidden rather than removed when the whole day is blocked. The server
          fills in midnight to one-to-midnight in that case, and leaving the
          inputs mounted keeps whatever was typed if somebody unticks it again.
        */}
        <div className={`flex items-center gap-2 ${allDay ? "hidden" : ""}`}>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">Start</span>
            <input
              type="time"
              name="startTime"
              defaultValue="08:00"
              className="min-h-12 w-full rounded-control border border-line bg-transparent px-3 text-sm"
            />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">Finish</span>
            <input
              type="time"
              name="endTime"
              defaultValue="17:00"
              className="min-h-12 w-full rounded-control border border-line bg-transparent px-3 text-sm"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink-muted">Reason (optional)</span>
          <input
            type="text"
            name="reason"
            maxLength={120}
            placeholder={technicianId ? "Holiday, training, wholesaler run" : "Public holiday, shutdown"}
            className="min-h-12 w-full rounded-control border border-line bg-transparent px-3 text-sm"
          />
        </label>

        {addState.error ? <p className="text-sm text-critical">{addState.error}</p> : null}
        {addState.notice ? <p className="text-sm text-positive">{addState.notice}</p> : null}

        <button
          type="submit"
          disabled={adding}
          className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-semibold disabled:opacity-60"
        >
          {adding ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Plus className="h-4 w-4" aria-hidden />
          )}
          {adding ? "Saving…" : addLabel}
        </button>
      </form>
    </div>
  );
}
