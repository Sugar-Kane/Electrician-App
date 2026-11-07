"use client";

import { useActionState } from "react";

import { saveTask, type TaskFormState } from "@/app/tasks/actions";
import { RepeatFields } from "@/components/tasks/repeat-fields";
import { inputClass } from "@/components/ui/field";
import { TASK_STATUSES, TASK_STATUS_LABELS } from "@/lib/task-rules";
import type { TaskSummary } from "@/lib/tasks-service";

const initial: TaskFormState = { error: "" };

/**
 * Edit a task. The version it was opened at goes with the form: if the task
 * changed since (in ChatGPT, or on another screen), Save is refused with a
 * message instead of quietly overwriting the newer change.
 */
export function TaskEditForm({
  task,
  members,
  reminderLocal,
}: {
  task: TaskSummary;
  members: { user_id: string; name: string }[];
  /** The reminder as the datetime-local box wants it, in the task's zone. */
  reminderLocal: string;
}) {
  const [state, action, pending] = useActionState(saveTask, initial);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="task_id" value={task.id} />
      <input type="hidden" name="version" value={task.version} />
      <label className="grid gap-1 text-xs font-semibold text-ink-muted">
        Title
        <input name="title" required maxLength={300} defaultValue={task.title} className={inputClass} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-ink-muted">
        Notes
        <textarea name="notes" rows={4} maxLength={10000} defaultValue={task.notes ?? ""} className={`${inputClass} py-3`} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-ink-muted">
          Due date
          <input type="date" name="due_date" defaultValue={task.due_date ?? ""} className={inputClass} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink-muted">
          Due time ({task.time_zone})
          <input type="time" name="due_time" defaultValue={task.due_time ?? ""} className={inputClass} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink-muted">
          Status
          <select name="status" defaultValue={task.status} className={inputClass}>
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {TASK_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink-muted">
          Assigned to
          <select name="assignee_user_id" defaultValue={task.assignee.type === "user" ? (task.assignee.user_id ?? "") : ""} className={inputClass}>
            <option value="">Nobody</option>
            {members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-xs font-semibold text-ink-muted">
        Remind at ({task.time_zone}){task.reminder_sent ? " · sent" : ""}
        <input type="datetime-local" name="reminder_at" defaultValue={reminderLocal} className={inputClass} />
      </label>
      <p className="text-xs leading-5 text-ink-faint">
        The due date says when it is needed and never starts anything. The reminder is when you are told, in Volteira.
      </p>

      <div className="grid gap-3 rounded-control border border-line p-3">
        <p className="text-sm font-semibold text-ink">{task.repeat ? `Repeats: ${task.repeat.description}${task.repeat.active ? "" : " (stopped)"}` : "Does not repeat"}</p>
        <RepeatFields label={task.repeat ? "Change how it repeats" : "Repeats"} />
        {task.repeat?.active ? (
          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="stop_repeating" value="yes" />
            Stop repeating after this one
          </label>
        ) : null}
        {task.repeat ? (
          <fieldset className="grid gap-2">
            <legend className="text-xs font-semibold text-ink-muted">Apply changes to</legend>
            <label className="inline-flex items-center gap-2 text-sm text-ink">
              <input type="radio" name="apply_to" value="this" defaultChecked />
              Only this one{task.repeat.occurrence_date ? ` (${task.repeat.occurrence_date})` : ""}
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-ink">
              <input type="radio" name="apply_to" value="future" />
              This one and the ones after it
            </label>
            <p className="text-xs text-ink-faint">Earlier ones are never changed. Changing how it repeats always applies to this one and the ones after it.</p>
          </fieldset>
        ) : null}
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-critical">
          {state.error}
          {state.code === "VERSION_CONFLICT" ? " Reload the page to see the latest." : ""}
        </p>
      ) : state.saved ? (
        <p className="text-sm text-positive">Saved.</p>
      ) : null}
      <div>
        <button type="submit" disabled={pending} className="tap-target min-h-11 rounded-control bg-brand px-5 text-sm font-bold text-on-brand disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
