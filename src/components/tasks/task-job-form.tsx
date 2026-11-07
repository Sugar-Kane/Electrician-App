"use client";

import { useActionState } from "react";

import { setTaskJob, type TaskFormState } from "@/app/tasks/actions";
import { inputClass } from "@/components/ui/field";

const initial: TaskFormState = { error: "" };

/**
 * Link, move or unlink a task's job. A private task is not made visible to
 * the business silently: the first attempt comes back with the question, and
 * only "Link and share" sends the confirmation.
 */
export function TaskJobForm({
  taskId,
  version,
  currentJob,
  currentJobNumber,
  isPrivate,
}: {
  taskId: string;
  version: number;
  currentJob: string | null;
  currentJobNumber: number | null;
  isPrivate: boolean;
}) {
  const [state, action, pending] = useActionState(setTaskJob, initial);
  const needsConfirm = state.code === "VISIBILITY_CHANGE_NEEDS_CONFIRMATION";

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="task_id" value={taskId} />
      <input type="hidden" name="version" value={version} />
      {currentJobNumber ? <input type="hidden" name="previous_job_number" value={currentJobNumber} /> : null}
      <label className="grid gap-1 text-xs font-semibold text-ink-muted">
        {currentJob ? "Move to another job" : "Link to a job"}
        <input name="job" placeholder="Job number, like 1042, or customer name" className={inputClass} autoComplete="off" />
      </label>
      {isPrivate && !currentJob ? (
        <p className="text-xs leading-5 text-ink-faint">This task is private. Linking it to a job makes it, and its notes, visible to everyone in your business.</p>
      ) : null}
      {needsConfirm ? (
        <div role="alert" className="rounded-control border border-caution/40 bg-caution-bg p-3 text-sm text-caution">
          {state.error}
          <button
            type="submit"
            name="confirm"
            value="yes"
            disabled={pending}
            className="tap-target mt-2 block min-h-11 rounded-control bg-brand px-4 text-sm font-bold text-on-brand"
          >
            Link and share with the business
          </button>
        </div>
      ) : state.error ? (
        <p role="alert" className="text-sm text-critical">
          {state.error}
        </p>
      ) : state.saved ? (
        <p className="text-sm text-positive">Saved.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="tap-target min-h-11 rounded-control border border-line bg-raised px-4 text-sm font-semibold text-ink"
        >
          {currentJob ? "Move" : "Link"}
        </button>
        {currentJob ? (
          <button
            type="submit"
            disabled={pending}
            onClick={(event) => {
              const input = event.currentTarget.form?.elements.namedItem("job");
              if (input instanceof HTMLInputElement) input.value = "";
            }}
            className="tap-target min-h-11 rounded-control px-4 text-sm font-semibold text-ink-muted hover:text-ink"
          >
            Unlink from job
          </button>
        ) : null}
      </div>
    </form>
  );
}
