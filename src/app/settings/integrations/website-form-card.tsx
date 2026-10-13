"use client";

import { useActionState } from "react";
import { Check, Copy, Globe, KeyRound, Link2Off, ShieldCheck } from "lucide-react";

import { createWebsiteKey, type WebsiteKeyState } from "./website-actions";

const initial: WebsiteKeyState = { error: "" };

/**
 * Connecting the business's own website, so its request form lands here.
 *
 * The key is shown once, in full, with exactly where it goes. After that only
 * when it was made and last used are shown: Volteira keeps a hash, not the key.
 */
export function WebsiteFormCard({
  keys,
  canManage,
  appUrl,
  revokeAction,
}: {
  keys: { id: string; createdAt: string; lastUsedAt: string }[];
  canManage: boolean;
  appUrl: string;
  revokeAction: (formData: FormData) => void;
}) {
  const [state, action, pending] = useActionState(async () => createWebsiteKey(), initial);

  return (
    <section className="rounded-panel border border-line bg-surface p-5 sm:p-6 lg:col-span-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-control bg-brand/10 text-brand"><Globe className="h-6 w-6" aria-hidden /></span>
          <div>
            <p className="text-xs text-ink-faint">Your website</p>
            <h2 className="text-lg font-semibold">Website request form</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
              Requests from the form on your own website land in Booking requests, marked “From your website”. When the customer agreed to texts, the assistant texts them right away to get the details and book the visit.
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-positive-bg px-3 py-1.5 text-[10px] font-semibold text-positive"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />Owner only</span>
      </div>

      {state.key ? (
        <div className="mt-5 rounded-control border border-positive/25 bg-positive-bg p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-positive"><Check className="h-4 w-4" aria-hidden />Key created. It is shown only now.</p>
          <div className="mt-3 flex gap-2">
            <input readOnly value={state.key} className="min-w-0 flex-1 rounded-control border border-line bg-surface px-3 py-2 font-mono text-xs" aria-label="Website key" />
            <button type="button" onClick={() => navigator.clipboard.writeText(state.key ?? "")} className="tap-target rounded-control border border-line px-3" aria-label="Copy website key"><Copy className="h-4 w-4" /></button>
          </div>
          <p className="mt-3 text-xs font-semibold text-ink">Where it goes</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs leading-5 text-ink-muted">
            <li>Open your website’s project in Vercel, then Settings → Environment Variables (Production).</li>
            <li><span className="font-mono">VOLTEIRA_API_URL</span> = <span className="font-mono">{appUrl}</span></li>
            <li><span className="font-mono">VOLTEIRA_API_KEY</span> = this key</li>
            <li><span className="font-mono">VOLTEIRA_MODE</span> = <span className="font-mono">live</span>, then redeploy the website.</li>
          </ol>
        </div>
      ) : null}

      {state.error ? <p className="mt-4 text-sm text-danger">{state.error}</p> : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <form action={action}>
          <button disabled={pending} className="tap-target flex min-h-11 items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-50">
            <KeyRound className="h-4 w-4" aria-hidden />{pending ? "Creating…" : keys.length ? "Create a new key" : "Create a website key"}
          </button>
        </form>
        <p className="text-xs text-ink-faint">{canManage ? "Revoke a key the moment you replace it or think it was seen." : "Only the business owner can create a key."}</p>
      </div>

      {keys.length > 0 ? (
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Active keys</p>
          <div className="mt-3 space-y-2">
            {keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between gap-3 rounded-control bg-white/[0.025] px-3 py-3 text-xs">
                <div><p className="font-semibold text-ink">Website form</p><p className="mt-1 text-ink-muted">Created {key.createdAt}{key.lastUsedAt ? ` · Last request ${key.lastUsedAt}` : " · No requests yet"}</p></div>
                <form action={revokeAction}><input type="hidden" name="keyId" value={key.id} /><button className="tap-target flex min-h-9 items-center gap-2 rounded-control border border-line px-3 font-semibold"><Link2Off className="h-3.5 w-3.5" />Revoke</button></form>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
