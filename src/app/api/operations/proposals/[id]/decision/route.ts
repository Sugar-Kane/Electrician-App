import { after, NextResponse } from "next/server";

import { currentContext } from "@/lib/request-context";
import { isSameOrigin } from "@/lib/same-origin";
import { createClient } from "@/lib/supabase/server";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { decisionMessage } from "@/lib/supervised-actions";
import { decideAsSignedInUser, UUID } from "@/lib/supervised-actions-server";
import { runSupervisedWorker } from "@/lib/supervised-executor";

export const dynamic = "force-dynamic";

/**
 * Approve or reject one proposal, as the signed-in person.
 *
 * The decision is made by the database with the person's own session
 * (decide_supervised_proposal): it checks their business and role, that the
 * fingerprint they were shown is still the proposal's, that it has not run
 * out and that nobody decided first. Nothing in the body says who is
 * deciding or for which business.
 *
 * Off unless VOLTEIRA_PHASE2_APPROVALS_ENABLED is "true".
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.VOLTEIRA_PHASE2_APPROVALS_ENABLED !== "true") {
    return NextResponse.json({ error: "Approvals are not turned on yet." }, { status: 503 });
  }
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const context = await currentContext();
  if (!context) return NextResponse.json({ error: "Sign in again to decide." }, { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "That proposal could not be found." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Send the decision as JSON." }, { status: 400 });
  }
  const decision = body.decision;
  const contentHash = typeof body.contentHash === "string" ? body.contentHash : "";
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : undefined;
  if ((decision !== "approve" && decision !== "reject") || !/^sha256:[0-9a-f]{64}$/.test(contentHash)) {
    return NextResponse.json({ error: "That decision could not be read." }, { status: 400 });
  }

  const result = await decideAsSignedInUser(asFlexibleClient(await createClient()), { proposalId: id, decision, contentHash, note });
  if (!result.ok) {
    const status =
      result.code === "not_found" ? 404 : result.code === "forbidden" || result.code === "self_approval" ? 403 : result.code === "error" ? 500 : 409;
    return NextResponse.json({ error: decisionMessage(result.code), code: result.code }, { status });
  }

  // Carry it out now if this deployment runs this kind of action; otherwise
  // it waits for the next worker pass (or for the owner, for binding ones).
  if (decision === "approve" && process.env.VOLTEIRA_PHASE2_WORKER_ENABLED === "true") {
    after(async () => {
      await runSupervisedWorker({ only: id, limit: 1 });
    });
  }
  return NextResponse.json({ id, status: result.status });
}
