import Link from "next/link";
import type { ReactNode } from "react";

import { OperationsApprovalControls } from "@/components/operations-approval-controls";
import { approverFor, mayApprove, statusLabel } from "@/lib/supervised-actions";
import type { AuditEntry, SupervisedProposal } from "@/lib/supervised-actions-server";
import { SUPERVISED_TEMPLATES, isTemplateKey } from "@/lib/supervised-templates";

/** One proposal in the AI approval inbox: exactly what it does, its state and history, and the controls the viewer may use. */

function activityTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

const STATUS_TONE: Record<string, string> = {
  pending: "bg-brand/10 text-brand",
  approved: "bg-white/[0.06] text-ink",
  executing: "bg-white/[0.06] text-ink",
  executed: "bg-positive-bg text-positive",
  failed: "bg-caution-bg text-caution",
  uncertain: "bg-caution-bg text-caution",
};

function money(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const AUDIT_WORDS: Record<string, string> = {
  proposed: "Proposed",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  superseded: "Replaced",
  claimed: "Started",
  executed: "Done",
  failed: "Failed",
  uncertain: "Outcome unknown",
  retry_scheduled: "Will try again",
  reconciled: "Settled by hand",
};

export function SupervisedProposalCard({
  proposal,
  audit,
  role,
  timeZone,
  enabled,
  runnable,
}: {
  proposal: SupervisedProposal;
  audit: AuditEntry[];
  role: string;
  timeZone: string;
  enabled: boolean;
  runnable: string[];
}) {
  const needed = approverFor(proposal.actionType, proposal.templateKey);
  const template = proposal.templateKey && isTemplateKey(proposal.templateKey) ? SUPERVISED_TEMPLATES[proposal.templateKey].label : "";
  const manual = proposal.status === "approved" && !runnable.includes(proposal.actionType);
  const facts: [string, ReactNode][] = [
    ["Customer", proposal.customerName || "—"],
    [
      "Job",
      proposal.jobNumber ? (
        <Link key="job" href={`/jobs/${proposal.jobNumber}`} className="font-semibold text-brand">
          #{proposal.jobNumber}
        </Link>
      ) : (
        "—"
      ),
    ],
    ["Sends to", proposal.recipient || "—"],
    ["Amount", money(proposal.amountCents) || "—"],
    ["Document", proposal.documentRef ? `${proposal.documentRef}${proposal.documentVersion ? ` · version ${proposal.documentVersion}` : ""}` : "—"],
    ["Wording", template ? `Approved template: ${template}` : "Written for the occasion"],
    ["Approval needed", needed === "owner" ? "The owner" : needed === "admin" ? "Owner or admin" : "Nobody (unknown action)"],
    ["Proposed by", proposal.source === "event" ? "Automation" : proposal.source === "chatgpt" ? "ChatGPT" : proposal.proposedByKind],
    ["Created", activityTime(proposal.createdAt, timeZone)],
    ["Expires", proposal.expiresAt ? activityTime(proposal.expiresAt, timeZone) : "—"],
  ];
  const summary = [
    proposal.actionType.replaceAll("_", " "),
    proposal.recipient ? `to ${proposal.recipient}` : "",
    proposal.amountCents !== null ? money(proposal.amountCents) : "",
    "",
    proposal.content,
  ].join("\n");

  return (
    <li className="rounded-control border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold capitalize">{proposal.actionType.replaceAll("_", " ")}</p>
          {proposal.reason ? <p className="mt-1 text-sm text-ink-muted">{proposal.reason}</p> : null}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[proposal.status] ?? "bg-white/[0.05] text-ink-muted"}`}>
          {statusLabel(proposal.status)}
        </span>
      </div>

      <p className="mt-3 whitespace-pre-wrap break-words rounded-control border border-line bg-white/[0.02] p-3 text-sm leading-6">{proposal.content}</p>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-ink-faint">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 break-all font-mono text-[11px] text-ink-faint" title="The fingerprint of exactly what you approve">
        Fingerprint {proposal.contentHash}
      </p>

      {proposal.status !== "pending" ? (
        <div className="mt-3 rounded-control bg-white/[0.03] p-3 text-sm">
          {proposal.attempts > 0 ? <p>Attempts: {proposal.attempts} of {proposal.maxAttempts}</p> : null}
          {proposal.status === "approved" && proposal.nextAttemptAt && !manual ? <p>Next try {activityTime(proposal.nextAttemptAt, timeZone)}</p> : null}
          {manual ? <p>Volteira does not carry this out by itself. Do it from the job, then mark it done here.</p> : null}
          {proposal.externalRef ? <p className="break-all">Provider receipt: {proposal.externalRef}</p> : null}
          {proposal.error ? <p className="text-caution">{proposal.error}</p> : null}
          {proposal.status === "uncertain" ? (
            <p className="text-caution">Check the provider (Twilio or email logs) before doing this again, then say what happened.</p>
          ) : null}
          {proposal.decisionNote ? <p className="text-ink-muted">Note: {proposal.decisionNote}</p> : null}
        </div>
      ) : null}

      {audit.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-ink-muted">History ({audit.length})</summary>
          <ol className="mt-2 space-y-1 text-xs text-ink-muted">
            {audit.map((entry) => (
              <li key={entry.id}>
                {activityTime(entry.createdAt, timeZone)} · {AUDIT_WORDS[entry.event] ?? entry.event}
                {entry.actorKind === "person" ? " by a person" : entry.actorKind === "ai" ? " by AI" : ""}
                {entry.via ? ` (${entry.via})` : ""}
                {entry.attempt ? ` · attempt ${entry.attempt}` : ""}
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {proposal.status === "pending" ? (
        <OperationsApprovalControls
          id={proposal.id}
          contentHash={proposal.contentHash}
          enabled={enabled}
          mode="decide"
          canDecide={mayApprove(role, proposal.actionType, proposal.templateKey)}
          summary={summary}
        />
      ) : proposal.status === "uncertain" || manual ? (
        <OperationsApprovalControls
          id={proposal.id}
          contentHash={proposal.contentHash}
          enabled={enabled}
          mode="reconcile"
          reconcileKind={manual ? "manual" : "uncertain"}
          canDecide={role === "owner"}
          summary={summary}
        />
      ) : null}
    </li>
  );
}

