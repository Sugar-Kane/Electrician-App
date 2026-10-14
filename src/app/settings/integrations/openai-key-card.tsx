"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, KeyRound, LoaderCircle, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";

import type { AiKeyStatus } from "@/lib/ai-key";
import { connectOpenAiKey, disconnectOpenAiKey, type OpenAiKeyState } from "./openai-actions";

/**
 * The business's own ChatGPT (OpenAI) API key, which runs the materials chat
 * on each job.
 *
 * Checked with OpenAI before it is kept, and never shown again: the card says
 * which key it is by its last four characters, which model it runs, and
 * whether the last use worked.
 */

const initial: OpenAiKeyState = { error: "" };

function dateLabel(value: string | null | undefined) {
  if (!value) return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SaveButton({ replacing, locked }: { replacing: boolean; locked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || locked}
      className="tap-target inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
      {pending ? "Checking with OpenAI…" : replacing ? "Replace key" : "Connect key"}
    </button>
  );
}

export function OpenAiKeyCard({
  status: saved,
  canManage,
}: {
  status: AiKeyStatus | null;
  canManage: boolean;
}) {
  const [state, action, connecting] = useActionState(connectOpenAiKey, initial);
  const [removal, remove, removing] = useActionState(disconnectOpenAiKey, initial);
  // One change to the key at a time: a replace still being checked with
  // OpenAI must not land after a removal asked for while it ran, or the
  // other way round.
  // What the server has now: both actions refresh the page, so a key removed
  // after being connected here reads as removed, not as the key just connected.
  const status = saved;
  const justConnected = Boolean(state.status && saved && saved.hint === state.status.hint);

  return (
    <section className="rounded-panel border border-line bg-surface p-5 sm:p-6 lg:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-control bg-brand/10 text-brand">
            <Sparkles className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-ink-faint">Materials chat</p>
            <h2 className="text-lg font-semibold">ChatGPT API key</h2>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-positive-bg px-3 py-1.5 text-[10px] font-semibold text-positive">
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          Owner only
        </span>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-muted">
        The materials chat on each job runs on your own OpenAI account, the same models as ChatGPT. Create a key at{" "}
        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="whitespace-nowrap font-semibold text-brand">
          platform.openai.com/api-keys
        </a>{" "}
        and paste it here. OpenAI bills your account for what the chat uses.
      </p>

      {status ? (
        <div className="mt-5 rounded-control border border-positive/25 bg-positive-bg p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-positive">
            <Check className="h-4 w-4" aria-hidden />
            Connected: key {status.hint}, running {status.model}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Saved {dateLabel(status.savedAt)}
            {status.lastUsedAt ? ` · last used ${dateLabel(status.lastUsedAt)}` : " · not used yet"}
          </p>
          {status.lastError ? (
            <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-caution">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Last try: {status.lastError}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-5 rounded-control border border-line bg-white/[0.025] p-4 text-sm text-ink-muted">
          Not connected. Until it is, the materials chat runs on Volteira&apos;s built-in AI.
        </p>
      )}

      {canManage ? (
        <>
          <form action={action} className="mt-4 flex flex-col gap-2 sm:flex-row">
            {/* The key this page shows, so the server changes only that one. */}
            <input type="hidden" name="version" value={status?.savedAt ?? ""} />
            <label className="min-w-0 flex-1">
              <span className="sr-only">OpenAI API key</span>
              <input
                name="apiKey"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={status ? "Paste a new key to replace it" : "sk-…"}
                disabled={removing}
                className="min-h-12 w-full rounded-control border border-line bg-raised px-3 font-mono text-sm disabled:opacity-60"
              />
            </label>
            <SaveButton replacing={Boolean(status)} locked={removing} />
          </form>
          {state.error ? <p className="mt-2 text-sm text-critical">{state.error}</p> : null}
          {justConnected ? <p className="mt-2 text-sm text-positive" role="status">OpenAI accepted the key. The materials chat now runs on it.</p> : null}
          {status ? (
            <form action={remove} className="mt-3">
              <input type="hidden" name="version" value={status.savedAt} />
              <button
                type="submit"
                disabled={removing || connecting}
                className="tap-target inline-flex min-h-11 items-center text-sm font-semibold text-ink-muted disabled:opacity-60"
              >
                {removing ? "Removing…" : "Remove key"}
              </button>
            </form>
          ) : null}
          {removal.error ? <p className="mt-2 text-sm text-critical">{removal.error}</p> : null}
        </>
      ) : (
        <p className="mt-3 text-xs text-ink-muted">Only the business owner can connect or change the key.</p>
      )}
    </section>
  );
}
