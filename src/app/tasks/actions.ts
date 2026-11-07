"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { appTaskActor } from "@/lib/task-actor";
import {
  archiveTask,
  completeTask,
  createTask,
  createTasks,
  linkTaskToJob,
  reopenTask,
  unlinkTaskFromJob,
  updateTask,
} from "@/lib/tasks-service";
import { splitTitles } from "@/lib/task-rules";

export type TaskFormState = { error: string; code?: string; saved?: boolean };

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

function versionOf(formData: FormData): number | undefined {
  const value = Number(formData.get("version"));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function refresh(jobNumber?: string) {
  revalidatePath("/tasks");
  if (jobNumber) revalidatePath(`/jobs/${jobNumber}`);
}

/**
 * Quick add: a title, Enter. Several lines make several tasks. On a job page
 * the job travels with the form, so the task is made on that job.
 */
export async function quickAddTask(_previous: TaskFormState, formData: FormData): Promise<TaskFormState> {
  const session = await appTaskActor();
  if (!session) return { error: "Sign in to add tasks." };
  const titles = splitTitles(field(formData, "title"));
  if (titles.length === 0) return { error: "Type what needs doing." };
  const job = field(formData, "job");
  const requestKey = field(formData, "request_key");
  const extra = {
    due_date: field(formData, "due_date") || undefined,
    due_time: field(formData, "due_time") || undefined,
    notes: field(formData, "notes") || undefined,
    assignee_user_id: field(formData, "assignee_user_id") || undefined,
  };

  if (titles.length === 1) {
    const made = await createTask(session.db, session.actor, {
      title: titles[0],
      ...extra,
      ...(job ? { job } : {}),
      idempotency_key: requestKey || undefined,
    });
    if (!made.ok) return { error: made.error.message, code: made.error.code };
  } else {
    const made = await createTasks(session.db, session.actor, titles.map((title) => ({ title, ...extra })), {
      job: job || undefined,
      request_key: requestKey || undefined,
    });
    if (!made.ok) return { error: made.error.message, code: made.error.code };
    const refused = made.value.results.filter((result) => !result.ok);
    if (refused.length) return { error: `${refused.length} of ${titles.length} could not be saved.` };
  }
  refresh(field(formData, "job_number"));
  return { error: "", saved: true };
}

export async function toggleTaskComplete(formData: FormData): Promise<void> {
  const session = await appTaskActor();
  if (!session) return;
  const id = field(formData, "task_id");
  const done = field(formData, "done") === "yes";
  if (done) await reopenTask(session.db, session.actor, id, versionOf(formData));
  else await completeTask(session.db, session.actor, id, versionOf(formData));
  refresh(field(formData, "job_number"));
}

/** The detail page's Save. A stale version is refused and said so, never overwritten. */
export async function saveTask(_previous: TaskFormState, formData: FormData): Promise<TaskFormState> {
  const session = await appTaskActor();
  if (!session) return { error: "Sign in to change tasks." };
  const id = field(formData, "task_id");
  const changed = await updateTask(
    session.db,
    session.actor,
    id,
    {
      title: field(formData, "title"),
      notes: field(formData, "notes"),
      due_date: field(formData, "due_date"),
      due_time: field(formData, "due_time"),
      status: field(formData, "status"),
      assignee_user_id: field(formData, "assignee_user_id"),
    },
    versionOf(formData),
  );
  if (!changed.ok) return { error: changed.error.message, code: changed.error.code };
  refresh(changed.value.job ? String(changed.value.job.number) : undefined);
  revalidatePath(`/tasks/${id}`);
  return { error: "", saved: true };
}

/**
 * Link, move or unlink. A private task asks before it becomes visible to the
 * whole business; the form shows that question and sends `confirm` back.
 */
export async function setTaskJob(_previous: TaskFormState, formData: FormData): Promise<TaskFormState> {
  const session = await appTaskActor();
  if (!session) return { error: "Sign in to change tasks." };
  const id = field(formData, "task_id");
  const job = field(formData, "job").trim();
  const result = job
    ? await linkTaskToJob(session.db, session.actor, id, job, { confirmVisibility: field(formData, "confirm") === "yes", version: versionOf(formData) })
    : await unlinkTaskFromJob(session.db, session.actor, id, versionOf(formData));
  if (!result.ok) return { error: result.error.message, code: result.error.code };
  refresh(field(formData, "previous_job_number") || undefined);
  if (result.value.job) revalidatePath(`/jobs/${result.value.job.number}`);
  revalidatePath(`/tasks/${id}`);
  return { error: "", saved: true };
}

export async function archiveTaskAction(formData: FormData): Promise<void> {
  const session = await appTaskActor();
  if (!session) return;
  const id = field(formData, "task_id");
  const restore = field(formData, "restore") === "yes";
  const result = await archiveTask(session.db, session.actor, id, versionOf(formData), restore);
  refresh(field(formData, "job_number"));
  if (result.ok && !restore) redirect("/tasks");
  revalidatePath(`/tasks/${id}`);
}
