"use client";

import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";

import { matchBusinessHours, type ElectricianState } from "@/app/technicians/actions";
import { FormMessage } from "@/components/ui/field";

/**
 * "Same as the business."
 *
 * A one-person business sets its opening hours, then has to set them again as
 * its own hours, and from then on keeps two copies of one truth in step by
 * hand. This is the switch for that.
 *
 * It is honest rather than a copy. An electrician with no hours of their own is
 * already defined as available whenever the business is open — that is what the
 * booking slot function has always done — so switching this on *clears* their
 * week rather than duplicating the business's into it. Nothing can then drift,
 * because there is only one week to change.
 *
 * Switching it off writes today's business week as a starting point, because
 * "let me differ a bit" does not mean "give me an empty week".
 */

const initialState: ElectricianState = { error: "" };

export function SharedHoursToggle({
  technicianId,
  shared,
}: {
  technicianId: string;
  /** True when they have no hours of their own — the business's week is theirs. */
  shared: boolean;
}) {
  const [state, action, pending] = useActionState(matchBusinessHours, initialState);

  return (
    <form action={action} className="mt-3 rounded-control border border-line bg-raised p-3">
      <input type="hidden" name="technicianId" value={technicianId} />
      {/*
        The value posts the state being asked for, not the one showing. A
        checkbox posts nothing when it is off, which would make "turn this off"
        indistinguishable from "the browser dropped the field".
      */}
      <input type="hidden" name="share" value={shared ? "off" : "on"} />

      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">Same as the business</span>
          <span className="mt-0.5 block text-xs leading-5 text-ink-muted">
            {shared
              ? "Working whenever the business is open. Change the opening hours and these follow."
              : "Working their own week, set below."}
          </span>
        </span>

        <button
          type="submit"
          role="switch"
          aria-checked={shared}
          disabled={pending}
          aria-label="Work the same hours as the business"
          className={`tap-target relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition disabled:opacity-60 ${
            shared ? "border-brand bg-brand" : "border-line bg-white/10"
          }`}
        >
          <span
            className={`grid h-5 w-5 place-items-center rounded-full bg-white transition ${
              shared ? "translate-x-6" : "translate-x-1"
            }`}
          >
            {pending ? (
              <LoaderCircle className="h-3 w-3 animate-spin text-ink-muted" aria-hidden />
            ) : null}
          </span>
        </button>
      </div>

      <div className="mt-2">
        <FormMessage error={state.error} notice={state.notice} />
      </div>
    </form>
  );
}
