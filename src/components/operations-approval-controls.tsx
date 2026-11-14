"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Approve or reject one proposal, or settle one by hand. The fingerprint sent
 * is the one this card shows, so an approval can only be of what the person
 * read; the server checks who they are and what their role allows.
 */
type Props = {
  id: string;
  contentHash: string;
  enabled: boolean;
  mode: "decide" | "reconcile";
  /** Wording for the reconcile buttons: an uncertain action, or an approved one done by hand. */
  reconcileKind?: "uncertain" | "manual";
  canDecide: boolean;
  summary: string;
};

export function OperationsApprovalControls({ id, contentHash, enabled, mode, reconcileKind = "uncertain", canDecide, summary }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(path: "decision" | "reconcile", body: Record<string, unknown>, confirmText: string | null) {
    if (!enabled || busy) return;
    if (confirmText && !window.confirm(confirmText)) return;
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
      router.refresh();
    } catch (error) {
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
              onClick={() => void send("decision", { decision: "approve", contentHash }, `Approve exactly this?\n\n${summary}`)}
              className={`${button} border-positive/40 bg-positive-bg text-positive`}
            >
              Approve
            </button>
            <button type="button" disabled={busy} onClick={() => void send("decision", { decision: "reject", contentHash }, null)} className={`${button} border-line`}>
              Reject
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void send(
                  "reconcile",
                  { outcome: "executed" },
                  reconcileKind === "manual" ? "Mark this as done? Do this only once you have carried it out yourself." : "Mark this as having happened? Check the provider first.",
                )
              }
              className={`${button} border-positive/40 bg-positive-bg text-positive`}
            >
              {reconcileKind === "manual" ? "I did this" : "It happened"}
            </button>
            <button type="button" disabled={busy} onClick={() => void send("reconcile", { outcome: "failed" }, null)} className={`${button} border-line`}>
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
    </div>
  );
}
