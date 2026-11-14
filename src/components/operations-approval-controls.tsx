"use client";

import { useState } from "react";

type Props = { id: string; contentHash: string; enabled: boolean };

export function OperationsApprovalControls({ id, contentHash, enabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  async function decide(decision: "approve" | "reject") {
    if (!enabled || busy) return;
    if (decision === "approve" && !window.confirm("Approve this exact proposed action? This may authorize a customer-facing or financial operation.")) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/operations/proposals/${encodeURIComponent(id)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, contentHash }),
      });
      const data = await response.json() as { status?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to save decision");
      setResult(`Decision saved: ${data.status}. Refresh to see current status.`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!enabled || busy} onClick={() => void decide("approve")}
          className="rounded-control border border-line px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">
          Approve
        </button>
        <button type="button" disabled={!enabled || busy} onClick={() => void decide("reject")}
          className="rounded-control border border-line px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">
          Reject
        </button>
      </div>
      {result ? <p role="status" className="text-xs text-ink-muted">{result}</p> : null}
      {!enabled ? <p className="text-xs text-caution">Decision controls are disabled until Phase 2 verification is complete.</p> : null}
    </div>
  );
}
