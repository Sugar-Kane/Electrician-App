"use client";

import { useActionState, useRef } from "react";
import { Bot, CircleAlert, MessageSquareText, ShieldCheck } from "lucide-react";

import {
  answerTaskQuestionAction,
  assignTaskToAssistantAction,
  cancelTaskExecutionAction,
  decideTaskActionAction,
  startTaskExecutionAction,
  type AssistantFormState,
} from "@/app/tasks/assistant-actions";
import { inputClass } from "@/components/ui/field";
import { PERMISSION_LABELS, PERMISSION_MODES } from "@/lib/task-execution-rules";
import type { AssistantConnection, ExecutionView, ProposalView } from "@/lib/task-executions";

const initial: AssistantFormState = { error: "" };
const ACTIVE = new Set(["queued", "running", "waiting_input", "waiting_approval", "cancel_requested"]);

function Feedback({ state }: { state: AssistantFormState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm font-semibold text-critical">
        {state.error}
      </p>
    );
  }
  return state.message ? (
    <p role="status" className="text-sm text-positive">
      {state.message}
    </p>
  ) : null;
}

function when(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function Proposal({ taskId, proposal, canDecide, timeZone }: { taskId: string; proposal: ProposalView; canDecide: boolean; timeZone: string }) {
  const [state, action, pending] = useActionState(decideTaskActionAction, initial);
  return (
    <div className="grid gap-3 rounded-control border border-brand/40 bg-brand/5 p-3">
      <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <ShieldCheck className="h-4 w-4 text-brand" aria-hidden />
        Needs your approval: {proposal.action_label}
      </p>
      <p className="text-sm text-ink-muted">To: {proposal.target_label}</p>
      <blockquote className="whitespace-pre-wrap rounded-control border border-line bg-surface p-3 text-sm text-ink">{proposal.content}</blockquote>
      {proposal.reason ? <p className="text-xs text-ink-muted">Why: {proposal.reason}</p> : null}
      <p className="text-xs text-ink-faint">
        Version {proposal.version}. Can be approved until {when(proposal.expires_at, timeZone)}. Nothing is done until you approve this exact text.
      </p>
      {canDecide ? (
        <form action={action} className="grid gap-2">
          <input type="hidden" name="task_id" value={taskId} />
          <input type="hidden" name="proposal_id" value={proposal.id} />
          <input type="hidden" name="proposal_version" value={proposal.version} />
          <input type="hidden" name="content_hash" value={proposal.content_hash} />
          <label className="grid gap-1 text-xs font-semibold text-ink-muted">
            Note (needed to ask for changes)
            <textarea name="note" rows={2} maxLength={2000} className={`${inputClass} py-2`} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              name="decision"
              value="approve"
              disabled={pending}
              className="tap-target min-h-11 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60"
            >
              {proposal.action === "send_text" ? "Approve and send" : "Approve"}
            </button>
            <button type="submit" name="decision" value="revise" disabled={pending} className="tap-target min-h-11 rounded-control border border-line bg-raised px-4 text-sm font-semibold text-ink">
              Ask for changes
            </button>
            <button type="submit" name="decision" value="reject" disabled={pending} className="tap-target min-h-11 rounded-control px-4 text-sm font-semibold text-ink-muted hover:text-ink">
              Turn down
            </button>
          </div>
          <Feedback state={state} />
        </form>
      ) : (
        <p className="text-sm text-ink-muted">The person who started this work, the task&apos;s owner, or an owner or admin can decide it.</p>
      )}
    </div>
  );
}

function Question({ taskId, execution }: { taskId: string; execution: ExecutionView }) {
  const [state, action, pending] = useActionState(answerTaskQuestionAction, initial);
  return (
    <form action={action} className="grid gap-2 rounded-control border border-brand/40 bg-brand/5 p-3">
      <input type="hidden" name="task_id" value={taskId} />
      <input type="hidden" name="execution_id" value={execution.id} />
      <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <MessageSquareText className="h-4 w-4 text-brand" aria-hidden />
        The assistant asks
      </p>
      <p className="whitespace-pre-wrap text-sm text-ink">{execution.question}</p>
      {execution.can_decide ? (
        <>
          <label className="grid gap-1 text-xs font-semibold text-ink-muted">
            Your answer
            <textarea name="answer" required rows={3} maxLength={4000} className={`${inputClass} py-2`} />
          </label>
          <button type="submit" disabled={pending} className="tap-target min-h-11 justify-self-start rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60">
            Send answer
          </button>
          <Feedback state={state} />
        </>
      ) : null}
    </form>
  );
}

function AssignForm({
  taskId,
  version,
  assistants,
  instructions,
  criteria,
  mode,
  assigned,
}: {
  taskId: string;
  version: number;
  assistants: AssistantConnection[];
  instructions: string;
  criteria: string;
  mode: string;
  assigned: boolean;
}) {
  const [state, action, pending] = useActionState(assignTaskToAssistantAction, initial);
  const offset = useRef<HTMLInputElement>(null);
  const usable = assistants.filter((item) => item.usable);
  return (
    <form
      action={action}
      onSubmit={() => {
        if (!offset.current) return;
        const minutes = -new Date().getTimezoneOffset();
        const sign = minutes >= 0 ? "+" : "-";
        const abs = Math.abs(minutes);
        offset.current.value = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
      }}
      className="grid gap-3"
    >
      <input type="hidden" name="task_id" value={taskId} />
      <input type="hidden" name="version" value={version} />
      <input ref={offset} type="hidden" name="tz_offset" defaultValue="" />
      {usable.length > 1 ? (
        <label className="grid gap-1 text-xs font-semibold text-ink-muted">
          Assistant
          <select name="connection_id" className={inputClass}>
            {usable.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="connection_id" value={usable[0]?.id ?? ""} />
      )}
      <label className="grid gap-1 text-xs font-semibold text-ink-muted">
        What should it do?
        <textarea
          name="instructions"
          required
          rows={3}
          maxLength={10000}
          defaultValue={instructions}
          placeholder="Text the customer to confirm Thursday's 9am arrival window."
          className={`${inputClass} py-2`}
        />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-ink-muted">
        What does done look like? (optional)
        <input name="completion_criteria" maxLength={2000} defaultValue={criteria} placeholder="The customer has been texted." className={inputClass} />
      </label>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-xs font-semibold text-ink-muted">What it may do by itself</legend>
        {PERMISSION_MODES.map((option) => (
          <label key={option} className="flex items-start gap-2 text-sm text-ink">
            <input type="radio" name="permission_mode" value={option} defaultChecked={(mode || "prepare") === option} className="mt-1" />
            {PERMISSION_LABELS[option]}
          </label>
        ))}
        <p className="text-xs text-ink-faint">Texting a customer always waits for your approval. It cannot take payments, buy anything, delete anything or change settings.</p>
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-xs font-semibold text-ink-muted">When</legend>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="radio" name="start" value="now" defaultChecked /> Start now
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm text-ink">
          <input type="radio" name="start" value="scheduled" /> Start at
          <input type="datetime-local" name="scheduled_at" aria-label="Start time" className={`${inputClass} w-auto`} />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="radio" name="start" value="later" /> Don&apos;t start yet
        </label>
      </fieldset>
      <button type="submit" disabled={pending} className="tap-target min-h-11 justify-self-start rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60">
        {assigned ? "Save and hand over" : "Assign to assistant"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/**
 * The assistant's part of a task: hand it over, follow it, answer it, and
 * approve or turn down what it proposes. Every state is in words.
 */
export function TaskAssistantPanel({
  taskId,
  version,
  closed,
  assignedToAssistant,
  assistants,
  executions,
  instructions,
  criteria,
  mode,
  timeZone,
}: {
  taskId: string;
  version: number;
  closed: boolean;
  assignedToAssistant: boolean;
  assistants: AssistantConnection[];
  executions: ExecutionView[];
  instructions: string;
  criteria: string;
  mode: string;
  timeZone: string;
}) {
  const current = executions[0] ?? null;
  const active = current && ACTIVE.has(current.status) ? current : null;
  const usable = assistants.some((item) => item.usable);
  const pendingProposal = active?.proposals.find((proposal) => proposal.status === "pending") ?? null;

  return (
    <div className="grid gap-4">
      {!usable ? (
        <p className="flex items-start gap-2 rounded-control border border-line bg-raised p-3 text-sm text-ink-muted">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {assistants[0]?.note ?? "No assistant is connected to this business."}
        </p>
      ) : null}

      {current ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Bot className="h-4 w-4 text-ink-muted" aria-hidden />
            <span className="rounded-full border border-line px-3 py-1 font-semibold text-ink">{current.status_label}</span>
            {current.stage ? <span className="text-ink-muted">{current.stage}</span> : null}
            {current.connection ? <span className="text-xs text-ink-faint">· {current.connection}</span> : null}
          </div>
          {current.instructions ? <p className="text-sm text-ink-muted">Asked to: {current.instructions}</p> : null}
          {active?.status === "waiting_input" ? <Question taskId={taskId} execution={active} /> : null}
          {pendingProposal ? <Proposal taskId={taskId} proposal={pendingProposal} canDecide={active!.can_decide} timeZone={timeZone} /> : null}
          {current.result_summary ? (
            <div className="rounded-control border border-line bg-raised p-3 text-sm text-ink">
              <p className="font-semibold">Result</p>
              <p className="whitespace-pre-wrap">{current.result_summary}</p>
            </div>
          ) : null}
          {current.error ? (
            <p role="alert" className="rounded-control border border-critical/30 bg-critical-bg p-3 text-sm text-critical">
              {current.error}
            </p>
          ) : null}
          {current.proposals
            .filter((proposal) => ["executed", "failed", "uncertain", "rejected", "revision_requested"].includes(proposal.status))
            .slice(0, 4)
            .map((proposal) => (
              <p key={proposal.id} className="text-xs text-ink-muted">
                {proposal.action_label} (v{proposal.version}): {proposal.status.replace("_", " ")}
                {proposal.pre_authorized ? " · pre-authorized" : ""}
                {proposal.error ? ` · ${proposal.error}` : ""}
              </p>
            ))}
          <div className="flex flex-wrap gap-2">
            {active && active.can_decide && active.status !== "cancel_requested" ? (
              <form action={cancelTaskExecutionAction}>
                <input type="hidden" name="task_id" value={taskId} />
                <input type="hidden" name="execution_id" value={active.id} />
                <button type="submit" className="tap-target min-h-11 rounded-control border border-line bg-raised px-4 text-sm font-semibold text-ink">
                  Stop the assistant
                </button>
              </form>
            ) : null}
            {!active && assignedToAssistant && usable && !closed ? (
              <form action={startTaskExecutionAction}>
                <input type="hidden" name="task_id" value={taskId} />
                <button type="submit" className="tap-target min-h-11 rounded-control border border-line bg-raised px-4 text-sm font-semibold text-ink">
                  Run again
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ) : assignedToAssistant && usable && !closed ? (
        <form action={startTaskExecutionAction}>
          <input type="hidden" name="task_id" value={taskId} />
          <p className="mb-2 text-sm text-ink-muted">Assigned to the assistant, not started yet.</p>
          <button type="submit" className="tap-target min-h-11 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand">
            Start now
          </button>
        </form>
      ) : null}

      {usable && !active && !closed ? (
        <details open={!assignedToAssistant && !current} className="rounded-control border border-line p-3">
          <summary className="tap-target cursor-pointer text-sm font-semibold text-ink">{assignedToAssistant ? "Change the assistant's instructions" : "Hand this task to the assistant"}</summary>
          <div className="mt-3">
            <AssignForm taskId={taskId} version={version} assistants={assistants} instructions={instructions} criteria={criteria} mode={mode} assigned={assignedToAssistant} />
          </div>
        </details>
      ) : null}

      {executions.length > 1 ? (
        <details className="text-sm">
          <summary className="tap-target cursor-pointer text-xs font-semibold text-ink-muted">Earlier runs ({executions.length - 1})</summary>
          <ul className="mt-2 grid gap-1 text-xs text-ink-muted">
            {executions.slice(1).map((item) => (
              <li key={item.id}>
                {when(item.created_at, timeZone)} · {item.status_label}
                {item.result_summary ? ` · ${item.result_summary.slice(0, 120)}` : ""}
                {item.error ? ` · ${item.error.slice(0, 120)}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
