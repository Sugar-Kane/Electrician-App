import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, CheckCircle2, Clock3, LockKeyhole, ShieldCheck, TriangleAlert } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { SupervisedProposalCard } from "@/components/supervised-proposal-card";
import { canViewAiOperations } from "@/lib/ai-operations-policy";
import { PROPOSAL_VIEWS, proposalView, type ProposalView } from "@/lib/supervised-actions";
import { auditFor, listSupervisedProposals } from "@/lib/supervised-actions-server";
import { runnableActionTypes } from "@/lib/supervised-executor";
import { loadNeedsAction } from "@/lib/needs-action";
import { currentContext } from "@/lib/request-context";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";

export const metadata: Metadata = { title: "AI operations | Volteira" };
export const dynamic = "force-dynamic";

type ToolActivity = {
  id: string;
  tool_name: string | null;
  is_error: boolean;
  created_at: string;
};

function activityTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

const VIEW_LABELS: Record<ProposalView, string> = {
  pending: "Waiting for you",
  approved: "Approved",
  running: "Running",
  attention: "Needs a check",
  done: "Done",
  closed: "Rejected or expired",
};

export default async function AiOperationsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const context = await currentContext();
  if (!context) redirect("/login");
  if (!canViewAiOperations(context.role)) redirect("/");
  const view = proposalView((await searchParams).view);
  const approvalsEnabled = process.env.VOLTEIRA_PHASE2_APPROVALS_ENABLED === "true";
  const runnable = new Set<string>(runnableActionTypes(process.env.VOLTEIRA_PHASE2_EXECUTE));

  const database = getSupabaseAdmin();
  // Both reads are restricted to the verified organization in the session,
  // never an organization identifier supplied in the URL or by a model.
  const [attention, activity, approvals, events] = await Promise.all([
    loadNeedsAction(asFlexibleClient(database), context.organizationId, context.timeZone),
    database
      .from("mcp_call_log")
      .select("id,tool_name,is_error,created_at")
      .eq("organization_id", context.organizationId)
      .eq("method", "tools/call")
      .order("created_at", { ascending: false })
      .limit(25),
    listSupervisedProposals(asFlexibleClient(database), context.organizationId, view, 50),
    database
      .from("automation_events")
      .select("id,event_type,status,created_at")
      .eq("organization_id", context.organizationId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const rows = (activity.data ?? []) as ToolActivity[];
  const failed = rows.filter((row) => row.is_error).length;
  const proposals = approvals.ok ? approvals.proposals : [];
  const trails = await auditFor(asFlexibleClient(database), context.organizationId, proposals.map((proposal) => proposal.id));
  const recentEvents = (events.data ?? []) as { id: string; event_type: string; status: string; created_at: string }[];

  return (
    <FieldPageShell
      title="AI operations"
      eyebrow="Business oversight"
      description="A place to review outstanding work and see what connected assistants have tried. Customer-facing decisions stay with your team."
    >
      <section className="flex items-start gap-3 rounded-panel border border-positive/25 bg-positive-bg p-4 sm:p-5">
        <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-positive" aria-hidden />
        <div>
          <h2 className="font-semibold">Supervised mode</h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            AI can suggest. Nothing reaches a customer or touches money until a person approves the exact wording shown here.
            Contracts, estimates, purchases, refunds, price changes and cancellations need the owner, and Volteira never carries them out by itself.
          </p>
        </div>
      </section>

      <section className="mt-4 rounded-panel border border-line bg-surface p-4 sm:p-6" aria-labelledby="inbox-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="inbox-heading" className="text-lg font-semibold">AI approval inbox</h2>
          {approvals.ok ? (
            <span className="rounded-full bg-white/[0.05] px-3 py-1 text-xs text-ink-muted">{approvals.counts.pending} waiting</span>
          ) : null}
        </div>
        <nav aria-label="Proposal views" className="-mx-1 mt-3 flex gap-1 overflow-x-auto pb-1">
          {(Object.keys(PROPOSAL_VIEWS) as ProposalView[]).map((key) => (
            <Link
              key={key}
              href={key === "pending" ? "/operations" : `/operations?view=${key}`}
              aria-current={key === view ? "page" : undefined}
              className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${
                key === view ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-muted"
              }`}
            >
              {VIEW_LABELS[key]}
              {approvals.ok ? <span className="text-ink-faint">{approvals.counts[key]}</span> : null}
            </Link>
          ))}
        </nav>
        {!approvalsEnabled ? (
          <p className="mt-3 text-xs text-caution">Approving is switched off for now. Proposals can be reviewed but not decided.</p>
        ) : null}
        {!approvals.ok ? (
          <p className="mt-4 rounded-control bg-caution-bg p-3 text-sm text-caution">
            The approval inbox could not be loaded. Nothing can be decided until it loads.
          </p>
        ) : proposals.length === 0 ? (
          <p className="mt-4 rounded-control border border-line p-4 text-sm text-ink-muted">
            {view === "pending" ? "Nothing is waiting for approval." : `Nothing in "${VIEW_LABELS[view]}".`}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {proposals.map((proposal) => (
              <SupervisedProposalCard
                key={proposal.id}
                proposal={proposal}
                audit={trails.get(proposal.id) ?? []}
                role={context.role}
                timeZone={context.timeZone}
                enabled={approvalsEnabled}
                runnable={[...runnable]}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 rounded-panel border border-line bg-surface p-4 sm:p-6">
        <h2 className="text-lg font-semibold">Recent automation activity</h2>
        <p className="mt-1 text-sm text-ink-muted">Business events the automation saw, each counted once.</p>
        {recentEvents.length === 0 ? (
          <p className="mt-3 rounded-control bg-white/[0.03] p-4 text-sm text-ink-muted">No automation events yet.</p>
        ) : (
          <ol className="mt-3 divide-y divide-line">
            {recentEvents.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0 truncate">{event.event_type.replace(".", " ").replaceAll("_", " ")}</span>
                <span className="shrink-0 text-xs text-ink-faint">
                  {event.status === "processed" ? "Proposed" : event.status === "ignored" ? "Nothing needed" : event.status} · {activityTime(event.created_at, context.timeZone)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-panel border border-line bg-surface p-5">
          <p className="text-xs text-ink-muted">Business action categories</p>
          <p className="mt-2 text-3xl font-semibold">{attention.items.length}</p>
          <p className="mt-1 text-xs text-ink-faint">Currently need review</p>
        </div>
        <div className="rounded-panel border border-line bg-surface p-5">
          <p className="text-xs text-ink-muted">Recent assistant tool calls</p>
          <p className="mt-2 text-3xl font-semibold">{rows.length}</p>
          <p className="mt-1 text-xs text-ink-faint">Showing at most 25</p>
        </div>
        <div className="rounded-panel border border-line bg-surface p-5">
          <p className="text-xs text-ink-muted">Calls reporting errors</p>
          <p className="mt-2 text-3xl font-semibold">{failed}</p>
          <p className="mt-1 text-xs text-ink-faint">Within those recent calls</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="rounded-panel border border-line bg-surface p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-brand" aria-hidden />
            <h2 className="text-lg font-semibold">Needs your decision</h2>
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            Existing business follow-ups. These are not AI approval requests or automatic assignments.
          </p>
          {attention.items.length === 0 ? (
            <p className="mt-5 flex items-center gap-2 rounded-control bg-white/[0.03] p-4 text-sm text-ink-muted">
              <CheckCircle2 className="h-4 w-4 text-positive" aria-hidden /> No outstanding categories in the current business data.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {attention.items.map((item) => (
                <li key={item.key} className="rounded-control border border-line p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        {item.urgent ? <TriangleAlert className="h-4 w-4 shrink-0 text-caution" aria-label="Urgent" /> : null}
                        {item.label}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-ink-muted">{item.reason}</p>
                    </div>
                    <Link
                      href={item.href?.startsWith("#") ? "/" : (item.href ?? item.details[0]?.href ?? "/")}
                      className="flex min-h-10 shrink-0 items-center gap-1 rounded-control border border-line px-3 text-xs font-semibold text-brand"
                    >
                      Review <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-panel border border-line bg-surface p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-5 w-5 text-brand" aria-hidden />
            <h2 className="text-lg font-semibold">Connected assistant activity</h2>
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            Recent MCP tool calls for this business. Customer details, messages, and tool arguments are hidden here.
          </p>
          {activity.error ? (
            <p className="mt-4 rounded-control bg-caution-bg p-3 text-sm text-caution">Activity history could not be loaded. Try again later.</p>
          ) : rows.length === 0 ? (
            <p className="mt-4 rounded-control bg-white/[0.03] p-4 text-sm text-ink-muted">No connected assistant tool calls are recorded yet.</p>
          ) : (
            <ol className="mt-4 divide-y divide-line">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.tool_name?.replaceAll("_", " ") || "Unnamed tool"}</p>
                    <p className="mt-0.5 text-xs text-ink-faint">{activityTime(row.created_at, context.timeZone)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${row.is_error ? "bg-caution-bg text-caution" : "bg-positive-bg text-positive"}`}>
                    {row.is_error ? "Reported error" : "No error reported"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </FieldPageShell>
  );
}
