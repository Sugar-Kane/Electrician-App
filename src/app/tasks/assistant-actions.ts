"use server";

import { revalidatePath } from "next/cache";

import { currentImpersonation } from "@/lib/request-context";
import { assistantDatabase, assistantDeps, startQueuedWorkSoon } from "@/lib/task-assistant-server";
import { readAssignInput } from "@/lib/task-execution-rules";
import { answerExecution, approveProposal, assignToAssistant, cancelExecution, rejectProposal, startExecution } from "@/lib/task-executions";
import { appTaskActor } from "@/lib/task-actor";

/**
 * The task page's assistant controls. The signed-in person is checked here
 * (appTaskActor re-reads their membership); the writes use the server client
 * because assistant rows are written only by the server, and the service
 * repeats every visibility and decision rule itself.
 *
 * A support session (a platform admin inside someone's business) can look,
 * but cannot start assistant work or approve anything on the business's behalf.
 */

export type AssistantFormState = { error: string; message?: string };

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

async function actingPerson(): Promise<{ ok: true; actor: NonNullable<Awaited<ReturnType<typeof appTaskActor>>>["actor"] } | { ok: false; error: string }> {
  const session = await appTaskActor();
  if (!session) return { ok: false, error: "Sign in first." };
  if (await currentImpersonation()) return { ok: false, error: "A support session cannot start assistant work or approve actions for the business." };
  return { ok: true, actor: session.actor };
}

function refresh(taskId: string) {
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/tasks");
}

export async function assignTaskToAssistantAction(_previous: AssistantFormState, formData: FormData): Promise<AssistantFormState> {
  const person = await actingPerson();
  if (!person.ok) return { error: person.error };
  const taskId = field(formData, "task_id");
  const scheduledLocal = field(formData, "scheduled_at");
  const offset = field(formData, "tz_offset");
  const read = readAssignInput({
    instructions: field(formData, "instructions"),
    completion_criteria: field(formData, "completion_criteria"),
    permission_mode: field(formData, "permission_mode"),
    start: field(formData, "start"),
    connection_id: field(formData, "connection_id"),
    // The browser sends its own offset with the local time it showed.
    scheduled_at: scheduledLocal ? `${scheduledLocal}:00${/^[+-]\d{2}:\d{2}$/.test(offset) ? offset : "Z"}` : "",
  });
  if (!read.ok) return { error: read.error.message };
  const version = Number(formData.get("version"));
  const result = await assignToAssistant(assistantDatabase(), person.actor, assistantDeps(), taskId, read.value, {
    version: Number.isInteger(version) && version > 0 ? version : undefined,
  });
  if (!result.ok) return { error: result.error.message };
  if (result.value.execution) startQueuedWorkSoon();
  refresh(taskId);
  return { error: "", message: result.value.execution ? "Handed to the assistant." : "Assigned. Start it when you're ready." };
}

export async function startTaskExecutionAction(formData: FormData): Promise<void> {
  const person = await actingPerson();
  if (!person.ok) return;
  const taskId = field(formData, "task_id");
  const result = await startExecution(assistantDatabase(), person.actor, assistantDeps(), taskId, { request_id: field(formData, "request_id") || undefined });
  if (result.ok) startQueuedWorkSoon();
  refresh(taskId);
}

export async function decideTaskActionAction(_previous: AssistantFormState, formData: FormData): Promise<AssistantFormState> {
  const person = await actingPerson();
  if (!person.ok) return { error: person.error };
  const taskId = field(formData, "task_id");
  const proposalId = field(formData, "proposal_id");
  const decision = field(formData, "decision");
  const db = assistantDatabase();
  const deps = assistantDeps();
  if (decision === "approve") {
    const version = Number(formData.get("proposal_version"));
    const approved = await approveProposal(db, person.actor, deps, proposalId, {
      content_hash: field(formData, "content_hash"),
      version: Number.isInteger(version) ? version : undefined,
    });
    if (!approved.ok) {
      refresh(taskId);
      return { error: approved.error.message };
    }
    if (approved.value.execution?.status === "queued") startQueuedWorkSoon();
    refresh(taskId);
    return approved.value.proposal.status === "executed" ? { error: "", message: approved.value.message } : { error: approved.value.message };
  }
  const rejected = await rejectProposal(db, person.actor, deps, proposalId, { note: field(formData, "note"), revise: decision === "revise" });
  if (!rejected.ok) return { error: rejected.error.message };
  if (rejected.value.execution?.status === "queued") startQueuedWorkSoon();
  refresh(taskId);
  return { error: "", message: rejected.value.message };
}

export async function answerTaskQuestionAction(_previous: AssistantFormState, formData: FormData): Promise<AssistantFormState> {
  const person = await actingPerson();
  if (!person.ok) return { error: person.error };
  const taskId = field(formData, "task_id");
  const result = await answerExecution(assistantDatabase(), person.actor, assistantDeps(), field(formData, "execution_id"), field(formData, "answer"));
  if (!result.ok) return { error: result.error.message };
  startQueuedWorkSoon();
  refresh(taskId);
  return { error: "", message: "Passed on. The assistant continues within a minute." };
}

export async function cancelTaskExecutionAction(formData: FormData): Promise<void> {
  const person = await actingPerson();
  if (!person.ok) return;
  const taskId = field(formData, "task_id");
  await cancelExecution(assistantDatabase(), person.actor, assistantDeps(), field(formData, "execution_id"));
  refresh(taskId);
}
