import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, CheckCircle2, Clock3, LockKeyhole, ShieldCheck, TriangleAlert } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { canViewAiOperations } from "@/lib/ai-operations-policy";
import { loadNeedsAction } from "@/lib/needs-action";
import { currentContext } from "@/lib/request-context";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";

export const metadata: Metadata = { title: "AI operations | Volteira" };
export const dynamic = "force-dynamic";

type ApprovalRow = {
  id: string;
  action_type: string;
  status: string;
  reason: string | null;
  content: string | null;
  created_at: string;
  expires_at: string | null;
  pre_authorized: boolean;
};

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

export default async function AiOperationsPage() {
  const context = await currentContext();
  if (!context) redirect("/login");
  if (!canViewAiOperations(context.role)) redirect("/");

  const database = getSupabaseAdmin();
  // Both reads are restricted to the verified organization in the session,
  // never an organization identifier supplied in the URL or by a model.
  const [attention, activity, approvals] = await Promise.all([
    loadNeedsAction(asFlexibleClient(database), context.organizationId, context.timeZone),
    database
      .from("mcp_call_log")
      .select("id,tool_name,is_error,created_at")
      .eq("organization_id", context.organizationId)
      .eq("method", "tools/call")
      .order("created_at", { ascending: false })
      .limit(25),
    database
      .from("task_proposals")
      .select("id,action_type,status,reason,content,created_at,expires_at,pre_authorized")
      .eq("organization_id", context.organizationId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const rows = (activity.data ?? []) as ToolActivity[];
  const failed = rows.filter((row) => row.is_error).length;
  const proposals = (approvals.data ?? []) as ApprovalRow[];
  const pending = proposals.filter((proposal) => proposal.status === "pending" && !proposal.pre_authorized);

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
            This first view is read-only. It does not send customer messages, sign contracts, buy materials,
            change prices, or start background AI work. Those actions continue to require the existing approval flows.
          </p>
        </div>
      </section>

      <section className="mt-4 rounded-panel border border-line bg-surface p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">AI approval inbox</h2>
          <span className="rounded-full bg-white/[0.05] px-3 py-1 text-xs text-ink-muted">{pending.length} pending</span>
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          Actual assistant proposals for this business. Approval and execution controls remain disabled until atomic authorization and audit are verified.
        </p>
        {approvals.error ? (
          <p className="mt-4 rounded-control bg-caution-bg p-3 text-sm text-caution">
            The approval inbox could not be loaded. No approval actions are available.
          </p>
        ) : pending.length === 0 ? (
          <p className="mt-4 rounded-control border border-line p-4 text-sm text-ink-muted">
            No pending AI approval requests.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {pending.map((proposal) => (
              <li key={proposal.id} className="rounded-control border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{proposal.action_type.replaceAll("_", " ")}</p>
                  <span className="text-xs text-ink-faint">{activityTime(proposal.created_at, context.timeZone)}</span>
                </div>
                {proposal.reason ? <p className="mt-2 text-sm text-ink-muted">{proposal.reason}</p> : null}
                {proposal.content ? <p className="mt-2 whitespace-pre-wrap break-words text-sm">{proposal.content}</p> : null}
                {proposal.expires_at ? <p className="mt-2 text-xs text-ink-faint">Expires {activityTime(proposal.expires_at, context.timeZone)}</p> : null}
                <p className="mt-3 text-xs text-caution">Awaiting secure approval controls. No action has been sent.</p>
              </li>
            ))}
          </ul>
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
