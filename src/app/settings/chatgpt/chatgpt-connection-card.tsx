"use client";

import { useActionState, useState } from "react";
import { Bot, Check, Copy, Link2Off, TriangleAlert } from "lucide-react";

import { onTabListKeyDown } from "@/components/ui/keyboard";
import { createChatGptConnection, type ChatGptConnectionState } from "./chatgpt-actions";

const initial: ChatGptConnectionState = { error: "" };

/** What an electrician can say once it is connected, in their own words. */
const THINGS_TO_SAY = [
  "What's on today?",
  "What does my week look like?",
  "New job for Jane Smith, 123 Oak St, Bakersfield CA 93301, replace the panel, Friday at 9.",
  "Write the materials list for job 12.",
  "Put those on job 12: breakers $18 each, 3 hours labor at $125.",
  "Bill job 12 and text it to the customer.",
  "I'm on my way to job 12.",
  "Job 12 is done.",
  "Move the Smith job to Monday at 10 and let them know.",
];

type App = "chatgpt" | "claude";

const APPS: { value: App; label: string }[] = [
  { value: "chatgpt", label: "ChatGPT" },
  { value: "claude", label: "Claude" },
];

/**
 * Running Volteira from ChatGPT or Claude, set up in plain steps.
 *
 * The same link works in both. The steps are on the card before anything is
 * pressed, so somebody can see what they are signing up for, and whether
 * their plan allows it: ChatGPT needs Developer mode, which not every plan
 * has, while Claude's free plan allows one custom connector. The link is shown
 * once (Volteira keeps only a revocable record of it), so the copy button is
 * big and the card says so.
 *
 * Menu names are as the apps' own help pages give them. ChatGPT's have been
 * renamed before, so its steps name the other labels too, and say what not
 * finding Developer mode means.
 */
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
  const [copied, setCopied] = useState(false);
  const [app, setApp] = useState<App>("chatgpt");
  const connected = connections.length > 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(state.url ?? "");
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="rounded-panel border border-brand/25 bg-surface p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-control bg-brand/10 text-brand"><Bot className="h-6 w-6" aria-hidden /></span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Use Volteira in ChatGPT or Claude</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-muted">
            Ask what&apos;s on today, make jobs, write materials lists, and send invoices, just by typing or talking. It always
            asks you before it changes anything or messages a customer. It runs on your own ChatGPT or Claude account.
          </p>
          {connected ? (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-positive-bg px-3 py-1 text-xs font-semibold text-positive">
              <Check className="h-3.5 w-3.5" aria-hidden />Connected
            </p>
          ) : null}
        </div>
      </div>

      {!canManage ? (
        <p className="mt-5 rounded-control border border-line p-4 text-sm text-ink-muted">Only the business owner can connect ChatGPT or Claude.</p>
      ) : (
        <>
          <ol className="mt-5 space-y-4">
            <li className="flex gap-3">
              <Step n={1} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Get your link</p>
                <p className="mt-1 text-sm leading-6 text-ink-muted">Do this on a computer, with ChatGPT or Claude open in another tab. The same link works in either.</p>
                {state.url ? (
                  <div className="mt-3 rounded-control border border-positive/25 bg-positive-bg p-3">
                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={state.url}
                        onFocus={(event) => event.currentTarget.select()}
                        className="min-w-0 flex-1 rounded-control border border-line bg-surface px-3 py-2 text-xs"
                        aria-label="Your Volteira link"
                      />
                      <button
                        type="button"
                        onClick={copy}
                        className="tap-target flex min-h-11 shrink-0 items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand"
                      >
                        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                        {copied ? "Copied" : "Copy link"}
                      </button>
                    </div>
                    <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-caution">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      This link is shown only once. Keep this page open until it&apos;s pasted in. Treat it like a password.
                    </p>
                  </div>
                ) : (
                  <form action={action} className="mt-3">
                    <button disabled={pending} className="tap-target min-h-11 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-50">
                      {pending ? "Making your link…" : connected ? "Get a new link" : "Get my link"}
                    </button>
                  </form>
                )}
                {state.error ? <p className="mt-2 text-sm text-danger">{state.error}</p> : null}
              </div>
            </li>

            <li className="flex gap-3">
              <Step n={2} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Which do you use?</p>
                <div role="tablist" aria-label="Which app do you use?" onKeyDown={onTabListKeyDown} className="mt-2 inline-flex rounded-control border border-line p-1">
                  {APPS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="tab"
                      id={`app-tab-${option.value}`}
                      aria-selected={app === option.value}
                      aria-controls="app-steps"
                      tabIndex={app === option.value ? 0 : -1}
                      onClick={() => setApp(option.value)}
                      className={`tap-target inline-flex min-w-24 items-center justify-center rounded-chip px-3 text-sm font-semibold ${
                        app === option.value ? "bg-brand text-on-brand" : "text-ink-muted hover:text-ink"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {app === "chatgpt" ? (
                  <p className="mt-3 rounded-control border border-caution/25 bg-caution-bg p-3 text-xs leading-5 text-caution">
                    Adding your own server isn&apos;t on every ChatGPT plan, and in a Business or Enterprise workspace your admin may
                    need to allow it. If you don&apos;t see a way to add one in the steps below, use Claude instead, which works on
                    its free plan.
                  </p>
                ) : (
                  <p className="mt-3 rounded-control border border-positive/25 bg-positive-bg p-3 text-xs leading-5 text-positive">
                    Works on Claude&apos;s free plan, which allows one custom connector. Paid plans allow more.
                  </p>
                )}
              </div>
            </li>
          </ol>

          <ol id="app-steps" role="tabpanel" aria-labelledby={`app-tab-${app}`} className="mt-4 space-y-4">
            {app === "chatgpt" ? (
              <>
                <li className="flex gap-3">
                  <Step n={3} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">Open Plugins</p>
                    <p className="mt-1 text-sm leading-6 text-ink-muted">
                      At <span className="font-semibold text-ink">chatgpt.com</span>, click your profile picture, then{" "}
                      <span className="font-semibold text-ink">Settings → Plugins</span>, and open the{" "}
                      <span className="font-semibold text-ink">MCPs</span> tab.
                    </p>
                    <p className="mt-1 text-xs leading-5 text-ink-faint">
                      No Plugins? Your ChatGPT has the older layout: go to Settings → Apps (or Connectors) → Advanced settings, switch
                      on Developer mode, and use Create in the next step.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <Step n={4} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">Add Volteira</p>
                    <p className="mt-1 text-sm leading-6 text-ink-muted">
                      Click <span className="font-semibold text-ink">Add</span> and choose to add an MCP server. Name it{" "}
                      <span className="font-semibold text-ink">Volteira</span>. If it asks for a type, choose{" "}
                      <span className="font-semibold text-ink">Streamable HTTP</span>, not STDIO. Paste your link as the server
                      URL, leave authentication off (it may say None or No authentication), accept the warning about custom
                      servers, and save.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <Step n={5} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">Start a chat</p>
                    <p className="mt-1 text-sm leading-6 text-ink-muted">
                      In a new chat, click <span className="font-semibold text-ink">+</span>, turn on Volteira, and ask
                      &ldquo;What&apos;s on today?&rdquo;
                    </p>
                  </div>
                </li>
              </>
            ) : (
              <>
                <li className="flex gap-3">
                  <Step n={3} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">Open Connectors</p>
                    <p className="mt-1 text-sm leading-6 text-ink-muted">
                      At <span className="font-semibold text-ink">claude.ai</span>, sign in (or make a free account), then go to{" "}
                      <span className="font-semibold text-ink">Customize → Connectors</span> and click{" "}
                      <span className="font-semibold text-ink">Add custom connector</span>.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <Step n={4} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">Add Volteira</p>
                    <p className="mt-1 text-sm leading-6 text-ink-muted">
                      Paste your link as the <span className="font-semibold text-ink">MCP server URL</span> (name it Volteira if
                      it asks). For Authentication choose <span className="font-semibold text-ink">No sign-in</span>, then click{" "}
                      <span className="font-semibold text-ink">Add</span>.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <Step n={5} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">Start a chat</p>
                    <p className="mt-1 text-sm leading-6 text-ink-muted">
                      In a new chat, click <span className="font-semibold text-ink">+</span>, choose{" "}
                      <span className="font-semibold text-ink">Connectors</span>, turn on Volteira, and ask &ldquo;What&apos;s on
                      today?&rdquo;
                    </p>
                  </div>
                </li>
              </>
            )}
          </ol>

          <div className="mt-6 rounded-control bg-white/[0.025] p-4">
            <p className="text-sm font-semibold">Things you can say</p>
            <ul className="mt-2 space-y-1.5 text-sm leading-6 text-ink-muted">
              {THINGS_TO_SAY.map((line) => (
                <li key={line}>&ldquo;{line}&rdquo;</li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-5 text-ink-faint">
              Customers only ever see an invoice&apos;s total, never your parts list. If ChatGPT says it can only read, not save,
              your plan allows read-only apps: ask it for the answer and paste it into Volteira yourself, or use Claude.
            </p>
          </div>
        </>
      )}

      {connected && canManage ? (
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Connected</p>
          <div className="mt-3 space-y-2">
            {connections.map((connection) => (
              <div key={connection.id} className="flex items-center justify-between gap-3 rounded-control bg-white/[0.025] px-3 py-3 text-xs">
                <div>
                  <p className="font-semibold text-ink">ChatGPT</p>
                  <p className="mt-1 text-ink-muted">
                    Since {connection.createdAt} · Stops working {connection.expiresAt}
                    {connection.lastUsedAt ? ` · Last used ${connection.lastUsedAt}` : " · Not used yet"}
                  </p>
                </div>
                <form action={revokeAction}>
                  <input type="hidden" name="credentialId" value={connection.id} />
                  <button className="tap-target flex min-h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-control border border-line px-3 font-semibold">
                    <Link2Off className="h-3.5 w-3.5" />Disconnect
                  </button>
                </form>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-faint">Lost your phone or laptop? Disconnect here and ChatGPT stops working with Volteira right away.</p>
        </div>
      ) : null}
    </section>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/15 text-sm font-semibold text-brand" aria-hidden>
      {n}
    </span>
  );
}
