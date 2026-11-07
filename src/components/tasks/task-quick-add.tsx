"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";

import { quickAddTask, type TaskFormState } from "@/app/tasks/actions";
import { RepeatFields } from "@/components/tasks/repeat-fields";
import { inputClass } from "@/components/ui/field";

const initial: TaskFormState = { error: "" };

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
}

/**
 * A title and Enter. Everything else waits behind "More". Each submission
 * carries its own request key, so a retried request makes one task, not two.
 */
export function TaskQuickAdd({
  job,
  jobNumber,
  members = [],
  placeholder = "Add a task",
}: {
  job?: string;
  jobNumber?: string;
  members?: { user_id: string; name: string }[];
  placeholder?: string;
}) {
  const [state, action, pending] = useActionState(quickAddTask, initial);
  const [open, setOpen] = useState(false);
  const requestKey = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const title = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.saved) {
      form.current?.reset();
      title.current?.focus();
    }
  }, [state]);

  return (
    <form
      ref={form}
      action={action}
      // A fresh key per submission. A request that is retried (the same
      // submission sent again) carries the same key and finds the task it
      // already made; the button is disabled while one is in flight.
      onSubmit={() => {
        if (requestKey.current) requestKey.current.value = newKey();
      }}
      className="rounded-panel border border-line bg-surface p-3"
    >
      <input ref={requestKey} type="hidden" name="request_key" defaultValue="" />
      {job ? <input type="hidden" name="job" value={job} /> : null}
      {jobNumber ? <input type="hidden" name="job_number" value={jobNumber} /> : null}
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={`task-title-${jobNumber ?? "all"}`}>
          New task
        </label>
        <input
          ref={title}
          id={`task-title-${jobNumber ?? "all"}`}
          name="title"
          required
          maxLength={300}
          autoComplete="off"
          placeholder={placeholder}
          className={inputClass}
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending}
          className="tap-target inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {pending ? "Adding…" : "Add"}
        </button>
      </div>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="tap-target mt-2 inline-flex min-h-9 items-center gap-1 rounded-control px-2 text-xs font-semibold text-ink-muted hover:text-ink"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} aria-hidden />
        More options
      </button>

      {open ? (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-ink-muted">
            Due date
            <input type="date" name="due_date" className={inputClass} />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-ink-muted">
            Due time (optional)
            <input type="time" name="due_time" className={inputClass} />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-ink-muted">
            Remind me at (optional)
            <input type="datetime-local" name="reminder_at" className={inputClass} />
          </label>
          <RepeatFields />
          {members.length > 1 ? (
            <label className="grid gap-1 text-xs font-semibold text-ink-muted">
              Assign to
              <select name="assignee_user_id" className={inputClass} defaultValue="">
                <option value="">Me</option>
                {members
                  .filter((member) => member.name !== "You")
                  .map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          <label className="grid gap-1 text-xs font-semibold text-ink-muted sm:col-span-2">
            Notes
            <textarea name="notes" rows={2} maxLength={10000} className={`${inputClass} py-3`} />
          </label>
          <p className="text-xs leading-5 text-ink-faint sm:col-span-2">
            {job
              ? "Tasks on a job are visible to everyone in your business."
              : "Tasks you add here are private to you unless you link them to a job. Several lines make several tasks."}
          </p>
        </div>
      ) : null}

      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-critical">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
