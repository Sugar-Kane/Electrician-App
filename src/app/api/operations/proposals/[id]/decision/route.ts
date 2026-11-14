import { NextResponse } from "next/server";
import { currentContext } from "@/lib/request-context";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mayApprove, type SupervisedAction } from "@/lib/supervised-actions";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deliberately feature-flagged off until the approval/execution integration
 * tests pass. Never use this route to send a message or make a purchase.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.VOLTEIRA_PHASE2_APPROVALS_ENABLED !== "true") {
    return NextResponse.json({ error: "Approvals are not enabled" }, { status: 503 });
  }
  const context = await currentContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (context.role !== "owner" && context.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid proposal" }, { status: 400 });
  let input: unknown;
  try { input = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!input || typeof input !== "object") return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  const body = input as Record<string, unknown>;
  if ((body.decision !== "approve" && body.decision !== "reject") ||
      typeof body.contentHash !== "string" || body.contentHash.length < 16 || body.contentHash.length > 256) {
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  }
  const db = getSupabaseAdmin();
  const { data: proposal, error } = await db.from("task_proposals")
    .select("id,organization_id,action_type,status,content_hash,expires_at,pre_authorized,execution_id,task_id")
    .eq("id", id).eq("organization_id", context.organizationId).maybeSingle();
  if (error) return NextResponse.json({ error: "Unable to load proposal" }, { status: 500 });
  if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const action = proposal.action_type as SupervisedAction;
  // Unknown action types fail closed. A role may never authorize an
  // action whose semantics have not been reviewed.
  const knownActions = new Set<string>([
    "send_contract", "send_estimate", "purchase_materials", "issue_refund",
    "change_price", "cancel_job", "send_customer_message", "create_internal_task",
  ]);
  if (!knownActions.has(action) || !mayApprove(context.role, action)) {
    return NextResponse.json({ error: "Not permitted for this action" }, { status: 403 });
  }
  if (proposal.pre_authorized || proposal.status !== "pending" ||
      proposal.content_hash !== body.contentHash ||
      !proposal.expires_at || Date.parse(proposal.expires_at) <= Date.now()) {
    return NextResponse.json({ error: "Proposal changed, expired, or already decided" }, { status: 409 });
  }
  const { data: execution, error: executionError } = await db.from("task_executions")
    .select("requested_by")
    .eq("id", proposal.execution_id)
    .eq("organization_id", context.organizationId)
    .maybeSingle();
  if (executionError || !execution) return NextResponse.json({ error: "Cannot verify proposal origin" }, { status: 409 });
  if (execution.requested_by === context.userId) return NextResponse.json({ error: "Self-approval is not allowed" }, { status: 403 });
  // Compare-and-swap prevents a second decision from overwriting the first.
  // The content hash also binds the decision to the displayed proposal.
  const { data: updated, error: updateError } = await db.from("task_proposals")
    .update({
      status: body.decision === "approve" ? "approved" : "rejected",
      decided_by: context.userId,
      decided_via: "operations_inbox",
      decided_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", context.organizationId)
    .eq("status", "pending")
    .eq("content_hash", body.contentHash)
    .eq("pre_authorized", false)
    .gt("expires_at", new Date().toISOString())
    .select("id,status").maybeSingle();
  if (updateError) return NextResponse.json({ error: "Unable to save decision" }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "Proposal was updated by another user" }, { status: 409 });
  return NextResponse.json({ id: updated.id, status: updated.status });
}
