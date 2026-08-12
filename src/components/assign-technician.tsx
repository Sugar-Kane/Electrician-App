"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, UserPlus, UserRound } from "lucide-react";

import {
  assignTechnician,
  listCrew,
  type AssignState,
  type CrewMember,
} from "@/app/jobs/[jobId]/assign-actions";

/**
 * Who is on this job, as something you can press.
 *
 * "Unassigned" was printed as plain text in four places and did nothing in any
 * of them, while the dashboard warned about exactly that state and linked to a
 * screen with no way to resolve it. The only real route to assigning somebody
 * was a dropdown on the job's settings page, two navigations away.
 *
 * So it is a control now, and it looks like one whether or not anybody is on
 * the job: an empty one says "Assign tech" in the brand colour, a filled one
 * says the name with a chevron. Both open the same list, because reassigning is
 * as ordinary as assigning and hiding it behind a different affordance would
 * mean somebody going back to the settings page to do it.
 */

const initialState: AssignState = { error: "" };

export function AssignTechnician({
  jobNumber,
  technician,
  /** `sm` for a row in a list, `md` for the job page. */
  size = "md",
}: {
  jobNumber: string;
  /** The name currently on the job, or "" / "Unassigned" for nobody. */
  technician: string;
  size?: "sm" | "md";
}) {
  const [state, submit, pending] = useActionState(assignTechnician, initialState);
  const [open, setOpen] = useState(false);
  const [crew, setCrew] = useState<CrewMember[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const assigned = technician.trim() !== "" && technician.trim() !== "Unassigned";

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Fetched when the list is first opened rather than with the page. A job list
  // of twenty rows would otherwise ask for the same crew twenty times to render
  // controls most of which are never touched.
  useEffect(() => {
    if (!open || crew !== null) return;
    let live = true;

    listCrew()
      .then((members) => {
        if (live) setCrew(members);
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      });

    return () => {
      live = false;
    };
  }, [open, crew]);

  function choose(technicianId: string) {
    const data = new FormData();
    data.set("jobNumber", jobNumber);
    data.set("technicianId", technicianId);
    setOpen(false);
    startTransition(() => submit(data));
  }

  const compact = size === "sm";

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={assigned ? `Change who is on job ${jobNumber}` : `Assign a technician to job ${jobNumber}`}
        className={`tap-target inline-flex items-center gap-1.5 rounded-control border font-semibold disabled:opacity-60 ${
          compact ? "min-h-11 px-2.5 text-xs" : "min-h-12 px-3 text-sm"
        } ${
          assigned
            ? "border-line bg-raised text-ink"
            : "border-brand/40 bg-brand/[0.08] text-brand"
        }`}
      >
        {pending ? (
          <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
        ) : assigned ? (
          <UserRound className="h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <span className="max-w-32 truncate">{assigned ? technician : "Assign tech"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Assign technician"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-[min(260px,calc(100vw-32px))] overflow-hidden rounded-control border border-line bg-sunken p-2 shadow-2xl shadow-black/40"
        >
          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Assign technician
          </p>

          {loadFailed ? (
            <p className="px-2 py-3 text-sm text-critical">
              The crew list could not be loaded. Try again.
            </p>
          ) : crew === null ? (
            <p className="px-2 py-3 text-sm text-ink-muted">Loading crew…</p>
          ) : crew.length === 0 ? (
            <p className="px-2 py-3 text-sm leading-5 text-ink-muted">
              Nobody on the crew yet. Add somebody in Settings → Team.
            </p>
          ) : (
            <ul>
              {crew.map((member) => (
                <li key={member.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => choose(member.id)}
                    className="tap-row flex min-h-12 w-full items-center gap-2 rounded-chip px-2 text-left text-sm font-semibold hover:bg-white/[0.06]"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-chip bg-brand/10 text-[11px] font-bold text-brand">
                      {member.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{member.name}</span>
                    {!member.isActive ? (
                      <span className="shrink-0 text-[11px] font-normal text-ink-faint">Away</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* A job whose technician has gone off sick is better unassigned than
              assigned to somebody who is not coming. */}
          {assigned ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => choose("")}
              className="tap-row mt-1 flex min-h-12 w-full items-center rounded-chip border-t border-line px-2 text-left text-sm font-semibold text-ink-muted hover:bg-white/[0.06]"
            >
              Take {technician} off this job
            </button>
          ) : null}
        </div>
      ) : null}

      {state.error ? <p className="mt-1 text-xs text-critical">{state.error}</p> : null}
    </div>
  );
}
