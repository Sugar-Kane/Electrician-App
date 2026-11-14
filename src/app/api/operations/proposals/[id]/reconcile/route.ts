import { NextResponse } from "next/server";

import { currentContext } from "@/lib/request-context";
import { isSameOrigin } from "@/lib/same-origin";
import { createClient } from "@/lib/supabase/server";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { decisionMessage } from "@/lib/supervised-actions";
import { reconcileAsSignedInUser, UUID } from "@/lib/supervised-actions-server";

export const dynamic = "force-dynamic";

/**
 * The owner settles an action by hand: one whose outcome is unknown, after
 * checking the provider, or an approved one they carried out themselves (or
 * decided against). The database checks they are an owner of its business.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.VOLTEIRA_PHASE2_APPROVALS_ENABLED !== "true") {
    return NextResponse.json({ error: "Approvals are not turned on yet." }, { status: 503 });
  }
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const context = await currentContext();
  if (!context) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "That proposal could not be found." }, { status: 404 });

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Send it as JSON." }, { status: 400 });
  }
  const outcome = body?.outcome;
  if (outcome !== "executed" && outcome !== "failed") return NextResponse.json({ error: "Say whether it happened." }, { status: 400 });
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : undefined;

  const result = await reconcileAsSignedInUser(asFlexibleClient(await createClient()), { proposalId: id, outcome, note });
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : result.code === "forbidden" ? 403 : result.code === "error" ? 500 : 409;
    return NextResponse.json({ error: decisionMessage(result.code), code: result.code }, { status });
  }
  return NextResponse.json({ id, status: result.status });
}
