"use client";

import { useActionState } from "react";
import { Bot, Check, Copy, Link2Off, ShieldCheck } from "lucide-react";

import { createChatGptConnection, type ChatGptConnectionState } from "./chatgpt-actions";

const initial: ChatGptConnectionState = { error: "" };

export function ChatGptConnectionCard({
  connections,
  canManage,
  revokeAction,
}: {
  connections: { id: string; createdAt: string; expiresAt: string; lastUsedAt: string }[];
  canManage: boolean;
  revokeAction: (formData: FormData) => void;
}) {
  const [state, action, pending] = useActionState(async () => createChatGptConnection(), initial);

  return (
    <section className="rounded-panel border border-brand/25 bg-surface p-5 sm:p-6 lg:col-span-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-control bg-brand/10 text-brand"><Bot className="h-6 w-6" aria-hidden /></span>
          <div>
            <p className="text-xs text-ink-faint">Business MCP</p>
            <h2 className="text-lg font-semibold">ChatGPT</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">Connect ChatGPT to Volteira so it can search jobs and customers, book visits, prepare estimates, manage invoices, draft contracts, update hours, send approved customer messages, and prepare supplier orders.</p>
          </div>
        </div>
        <span className="rounded-full bg-positive-bg px-3 py-1.5 text-[10px] font-semibold text-positive"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />Owner only</span>
      </div>

      {state.url ? (
        <div className="mt-5 rounded-control border border-positive/25 bg-positive-bg p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-positive"><Check className="h-4 w-4" aria-hidden />Connection created</p>
          <p className="mt-2 text-xs leading-5 text-ink-muted">Copy this MCP URL into ChatGPT’s custom connector setup. It is shown only now. Volteira stores the revocable credential record, not the URL.</p>
          <div className="mt-3 flex gap-2">
            <input readOnly value={state.url} className="min-w-0 flex-1 rounded-control border border-line bg-surface px-3 py-2 text-xs" aria-label="ChatGPT MCP URL" />
            <button type="button" onClick={() => navigator.clipboard.writeText(state.url ?? "")} className="tap-target rounded-control border border-line px-3" aria-label="Copy MCP URL"><Copy className="h-4 w-4" /></button>
          </div>
        </div>
      ) : null}

      {state.error ? <p className="mt-4 text-sm text-danger">{state.error}</p> : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <form action={action}>
          <button disabled={!canManage || pending} className="tap-target min-h-11 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-50">
            {pending ? "Creating…" : "Connect ChatGPT"}
          </button>
        </form>
        <p className="text-xs text-ink-faint">Each connection expires after 180 days and can be revoked immediately.</p>
      </div>

      {connections.length > 0 ? (
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Active connections</p>
          <div className="mt-3 space-y-2">
            {connections.map((connection) => (
              <div key={connection.id} className="flex items-center justify-between gap-3 rounded-control bg-white/[0.025] px-3 py-3 text-xs">
                <div><p className="font-semibold text-ink">ChatGPT</p><p className="mt-1 text-ink-muted">Created {connection.createdAt} · Expires {connection.expiresAt}{connection.lastUsedAt ? ` · Last used ${connection.lastUsedAt}` : " · Not used yet"}</p></div>
                <form action={revokeAction}><input type="hidden" name="credentialId" value={connection.id} /><button className="tap-target flex min-h-9 items-center gap-2 rounded-control border border-line px-3 font-semibold"><Link2Off className="h-3.5 w-3.5" />Disconnect</button></form>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
