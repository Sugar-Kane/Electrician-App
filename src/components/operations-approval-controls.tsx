"use client";

import { CheckCircle2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Approve or reject one proposal, or settle one by hand. The fingerprint sent
 * is the one this card shows, so an approval can only be of what the person
 * read; the server checks who they are and what their role allows.
 *
 * Confirmations open in Volteira's own sheet (not the browser's confirm box),
 * showing exactly what will happen before anything is saved.
 */
export type ProposalSummary = { action: string; recipient: string; amount: string; customer: string; content: string };

type Props = {
  id: string;
  contentHash: string;
  enabled: boolean;
  mode: "decide" | "reconcile";
  /** Wording for the reconcile buttons: an uncertain action, or an approved one done by hand. */
  reconcileKind?: "uncertain" | "manual";
  canDecide: boolean;
  summary: ProposalSummary;
};

type Pending = {
  path: "decision" | "reconcile";
  body: Record<string, unknown>;
  title: string;
  detail: string;
  confirmLabel: string;
  showPreview: boolean;
};

export function OperationsApprovalControls({ id, contentHash, enabled, mode, reconcileKind = "uncertain", canDecide, summary }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pending) return;
    confirmButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setPending(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, busy]);

  async function send(path: "decision" | "reconcile", body: Record<string, unknown>) {
    if (!enabled || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/operations/proposals/${encodeURIComponent(id)}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, note: note.trim() || undefined }),
      });
      const data = (await response.json().catch(() => ({}))) as { status?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "That could not be saved. Try again.");
      setResult({ ok: true, text: "Saved." });
      setPending(null);
      router.refresh();
    } catch (error) {
      setPending(null);
      setResult({ ok: false, text: error instanceof Error ? error.message : "That could not be saved." });
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return <p className="mt-3 text-xs text-caution">Decisions are switched off until Phase 2 is turned on for this business.</p>;
  }
  if (!canDecide) {
    return <p className="mt-3 text-xs text-ink-muted">Only the business owner can decide this one.</p>;
  }

  const button = "min-h-11 rounded-control border px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      <label className="block text-xs text-ink-muted">
        Note (optional)
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          className="mt-1 block min-h-11 w-full rounded-control border border-line bg-transparent px-3 text-sm text-ink"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {mode === "decide" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setPending({
                  path: "decision",
                  body: { decision: "approve", contentHash },
                  title: "Approve exactly this?",
                  detail: "It goes ahead as shown. Nothing about it can change after you approve.",
                  confirmLabel: "Approve",
                  showPreview: true,
                })
              }
              className={`${button} border-positive/40 bg-positive-bg text-positive`}
            >
              Approve
            </button>
            <button type="button" disabled={busy} onClick={() => void send("decision", { decision: "reject", contentHash })} className={`${button} border-line`}>
              Reject
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setPending({
                  path: "reconcile",
                  body: { outcome: "executed" },
                  title: reconcileKind === "manual" ? "Mark this as done?" : "Mark this as having happened?",
                  detail:
                    reconcileKind === "manual"
                      ? "Only once you have carried it out yourself."
                      : "Check Twilio or the email log first. It will not be sent again either way.",
                  confirmLabel: reconcileKind === "manual" ? "I did this" : "It happened",
                  showPreview: false,
                })
              }
              className={`${button} border-positive/40 bg-positive-bg text-positive`}
            >
              {reconcileKind === "manual" ? "I did this" : "It happened"}
            </button>
            <button type="button" disabled={busy} onClick={() => void send("reconcile", { outcome: "failed" })} className={`${button} border-line`}>
              {reconcileKind === "manual" ? "Not doing it" : "It did not happen"}
            </button>
          </>
        )}
      </div>
      {result ? (
        <p role="status" className={`text-xs ${result.ok ? "text-positive" : "text-caution"}`}>
          {result.text}
        </p>
      ) : null}

      {pending ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center"
          onClick={() => (busy ? null : setPending(null))}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`confirm-${id}-title`}
            aria-describedby={`confirm-${id}-detail`}
            className="w-full max-w-md rounded-panel border border-line bg-surface p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 id={`confirm-${id}-title`} className="flex items-center gap-2 text-lg font-semibold">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-positive" aria-hidden />
                {pending.title}
              </h3>
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={busy}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-chip border border-line text-ink-muted"
                aria-label="Cancel"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {pending.showPreview ? (
              <div className="mt-4 space-y-3">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                  <dt className="text-ink-faint">Action</dt>
                  <dd className="capitalize">{summary.action}</dd>
                  {summary.customer ? (
                    <>
                      <dt className="text-ink-faint">Customer</dt>
                      <dd>{summary.customer}</dd>
                    </>
                  ) : null}
                  {summary.recipient ? (
                    <>
                      <dt className="text-ink-faint">Sends to</dt>
                      <dd className="break-all">{summary.recipient}</dd>
                    </>
                  ) : null}
                  {summary.amount ? (
                    <>
                      <dt className="text-ink-faint">Amount</dt>
                      <dd>{summary.amount}</dd>
                    </>
                  ) : null}
                </dl>
                <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-control border border-line bg-white/[0.03] p-3 text-sm leading-6">
                  {summary.content}
                </p>
              </div>
            ) : null}

            <p id={`confirm-${id}-detail`} className="mt-3 text-xs leading-5 text-ink-muted">
              {pending.detail}
            </p>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" disabled={busy} onClick={() => setPending(null)} className={`${button} border-line`}>
                Cancel
              </button>
              <button
                ref={confirmButton}
                type="button"
                disabled={busy}
                onClick={() => void send(pending.path, pending.body)}
                className={`${button} border-positive/40 bg-positive-bg text-positive`}
              >
                {busy ? "Saving…" : pending.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
