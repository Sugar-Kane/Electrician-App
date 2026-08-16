"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarOff,
  ChevronDown,
  ChevronRight,
  Clock,
  LoaderCircle,
  Phone,
  UserRound,
} from "lucide-react";

import {
  saveElectricianHours,
  setElectricianWorking,
  type ElectricianState,
} from "@/app/technicians/actions";
import { BlackoutManager } from "@/components/blackout-manager";
import {
  DEFAULT_END,
  DEFAULT_START,
  describeWeek,
  WEEKDAYS,
} from "@/lib/electrician-hours";
import type { TechnicianWorkload } from "@/lib/job-data";

/**
 * One electrician: whether they are working, when, and what they are doing today.
 *
 * The toggle is the important control and it sits at the top with the name,
 * because turning somebody off is what an owner comes here to do when a person
 * calls in sick at seven in the morning. It is not a preference — it takes them
 * out of the availability the booking page offers customers immediately, which
 * is why the label says "Working" rather than "Active".
 *
 * Hours and time off are folded away. Most days nobody touches them, and a card
 * that opens with a seven-row form for every person on the crew is a screen you
 * have to scroll past rather than read.
 */

const initialState: ElectricianState = { error: "" };

const STATUS_STYLES: Record<string, string> = {
  "In progress": "bg-info-bg text-info",
  Scheduled: "bg-caution-bg text-caution",
  Completed: "bg-positive-bg text-positive",
  Canceled: "bg-critical-bg text-critical",
  Pending: "bg-white/5 text-ink-muted",
};

function WorkingToggle({ electrician }: { electrician: TechnicianWorkload }) {
  const [state, submit, pending] = useActionState(setElectricianWorking, initialState);
  const form = useRef<HTMLFormElement>(null);

  return (
    <form action={submit} ref={form} className="shrink-0">
      <input type="hidden" name="technicianId" value={electrician.id} />
      {/*
        The value is carried by a hidden input rather than the checkbox itself,
        so the form posts the state being moved to. A bare checkbox posts
        nothing when it is being switched off, which is indistinguishable from a
        field that was never rendered.
      */}
      <input type="hidden" name="working" value={electrician.isActive ? "no" : "yes"} />
      <button
        type="submit"
        disabled={pending}
        role="switch"
        aria-checked={electrician.isActive}
        aria-label={`${electrician.name} is working`}
        className={`tap-target relative inline-flex h-11 w-[4.25rem] shrink-0 items-center rounded-full border px-1 transition-colors disabled:opacity-60 ${
          electrician.isActive
            ? "border-positive/40 bg-positive/20"
            : "border-line bg-white/5"
        }`}
      >
        <span
          className={`grid h-8 w-8 place-items-center rounded-full bg-white text-ink shadow transition-transform ${
            electrician.isActive ? "translate-x-[2.1rem]" : "translate-x-0"
          }`}
        >
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
        </span>
      </button>
      {state.error ? <p className="mt-1 text-xs text-critical">{state.error}</p> : null}
    </form>
  );
}

function HoursEditor({ electrician }: { electrician: TechnicianWorkload }) {
  const [state, submit, saving] = useActionState(saveElectricianHours, initialState);

  const byDay = new Map(electrician.hours.map((entry) => [entry.weekday, entry]));

  return (
    <form action={submit} className="mt-3 rounded-control border border-line p-3">
      <input type="hidden" name="technicianId" value={electrician.id} />

      <p className="text-xs leading-5 text-ink-muted">
        Days left off are days they are not offered to customers. Set none and they are available
        whenever the business is open.
      </p>

      <ul className="mt-3 space-y-2">
        {WEEKDAYS.map((day) => {
          const entry = byDay.get(day.value);
          return (
            <li key={day.value} className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-[6.5rem] flex-1 items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  name={`enabled-${day.value}`}
                  value="yes"
                  defaultChecked={Boolean(entry)}
                  className="h-5 w-5 rounded border-line"
                />
                {day.label}
              </label>
              <span className="flex items-center gap-1">
                <input
                  type="time"
                  name={`start-${day.value}`}
                  defaultValue={entry?.start ?? DEFAULT_START}
                  aria-label={`${day.label} start`}
                  className="min-h-11 rounded-control border border-line bg-transparent px-2 text-sm"
                />
                <span className="text-xs text-ink-faint">to</span>
                <input
                  type="time"
                  name={`end-${day.value}`}
                  defaultValue={entry?.end ?? DEFAULT_END}
                  aria-label={`${day.label} finish`}
                  className="min-h-11 rounded-control border border-line bg-transparent px-2 text-sm"
                />
              </span>
            </li>
          );
        })}
      </ul>

      {state.error ? <p className="mt-2 text-sm text-critical">{state.error}</p> : null}
      {state.notice ? <p className="mt-2 text-sm text-positive">{state.notice}</p> : null}

      <button
        type="submit"
        disabled={saving}
        className="tap-target mt-3 inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60"
      >
        {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {saving ? "Saving…" : "Save hours"}
      </button>
    </form>
  );
}

export function ElectricianCard({
  electrician,
  canManage,
}: {
  electrician: TechnicianWorkload;
  canManage: boolean;
}) {
  const [sheet, setSheet] = useState<"closed" | "hours" | "time-off">("closed");
  const open = sheet !== "closed";

  return (
    <section className="rounded-panel border border-line bg-surface p-4 sm:p-5">
      {/*
        The whole person is the control. Tapping anywhere on the row opens their
        settings, which is the thing an owner came here to do — the previous
        layout put two buttons on every card and turned a five-person crew into
        a wall of them.

        The summary stays on the closed row rather than moving inside, because
        "Mon–Fri, 8am–5pm" is worth reading without opening anything.
      */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => canManage && setSheet(open ? "closed" : "hours")}
          aria-expanded={canManage ? open : undefined}
          disabled={!canManage}
          className="tap-row flex min-h-[52px] min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-brand/10 text-sm font-bold text-brand">
            {electrician.initials || <UserRound className="h-5 w-5" aria-hidden />}
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold">
              {electrician.name}
              {electrician.isMe ? <span className="text-ink-muted"> · you</span> : null}
            </span>
            <span className="block truncate text-xs text-ink-muted">
              {electrician.isActive ? "Working" : "Not working"} ·{" "}
              {canManage
                ? describeWeek(electrician.hours)
                : electrician.jobs.length === 0
                  ? "nothing scheduled today"
                  : `${electrician.jobs.length} job${electrician.jobs.length === 1 ? "" : "s"} today`}
            </span>
          </span>

          {canManage ? (
            <ChevronDown
              className={`h-5 w-5 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden
            />
          ) : null}
        </button>

        {electrician.phone ? (
          <a
            href={`tel:${electrician.phone.replace(/[^\d+]/g, "")}`}
            className="tap-target grid h-11 w-11 shrink-0 place-items-center rounded-chip border border-line text-brand"
            aria-label={`Call ${electrician.name}`}
          >
            <Phone className="h-5 w-5" aria-hidden />
          </a>
        ) : null}
      </div>

      {canManage && open ? (
        <div className="mt-3 rounded-control border border-line p-3">
          {/*
            The switch lives in here now. It is the one control that changes
            what customers are offered the moment it is touched, and a switch
            sitting on a collapsed row is too easy to catch with a thumb while
            scrolling past somebody.
          */}
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Working</span>
              <span className="block text-xs text-ink-muted">
                {electrician.isActive
                  ? "Offered to customers booking online"
                  : "Not offered to customers, and not counted as available"}
              </span>
            </span>
            <WorkingToggle electrician={electrician} />
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setSheet("hours")}
              aria-pressed={sheet === "hours"}
              className={`tap-target flex min-h-12 items-center gap-2 rounded-control border px-3 text-left text-sm ${
                sheet === "hours" ? "border-brand bg-brand/10" : "border-line"
              }`}
            >
              <Clock className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-semibold">Hours</span>
            </button>

            <button
              type="button"
              onClick={() => setSheet("time-off")}
              aria-pressed={sheet === "time-off"}
              className={`tap-target flex min-h-12 items-center gap-2 rounded-control border px-3 text-left text-sm ${
                sheet === "time-off" ? "border-brand bg-brand/10" : "border-line"
              }`}
            >
              <CalendarOff className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-semibold">
                {electrician.blackouts.length === 0
                  ? "Time off"
                  : `Time off · ${electrician.blackouts.length}`}
              </span>
            </button>
          </div>

          {sheet === "hours" ? <HoursEditor electrician={electrician} /> : null}
          {sheet === "time-off" ? (
            <div className="mt-3">
              <BlackoutManager
                technicianId={electrician.id}
                blackouts={electrician.blackouts}
                emptyText="No time off booked."
                addLabel="Block out time"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {electrician.jobs.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {electrician.jobs.map((job) => (
            <li key={job.id}>
              <Link
                href={`/jobs/${job.id}`}
                className="tap-row flex min-h-14 items-center gap-3 rounded-control border border-line px-4"
              >
                <time className="shrink-0 text-xs font-semibold text-info">{job.time}</time>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{job.customer}</span>
                  <span className="block truncate text-xs text-ink-muted">{job.city}</span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${STATUS_STYLES[job.status] ?? ""}`}
                >
                  {job.status}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
