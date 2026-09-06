import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { recordActivity } from "@/lib/activity";
import { documensoEventContractStatus } from "@/lib/documenso-status";
import { fileSignedContract } from "@/lib/signed-contract";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { webhookSecretMatches } from "@/lib/webhook-secret";

export const runtime = "nodejs";

type DocumensoWebhook = {
  event?: unknown;
  createdAt?: unknown;
  payload?: {
    envelopeId?: unknown;
    externalId?: unknown;
    completedAt?: unknown;
  } | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function eventTime(value: unknown): string {
  const raw = text(value);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function externalContractId(value: unknown): string {
  const match = /^volteira-contract:([0-9a-f-]{36})$/i.exec(text(value));
  return match?.[1] ?? "";
}

export async function POST(request: Request) {
  const expected = (process.env.DOCUMENSO_WEBHOOK_SECRET ?? "").trim();
  if (!expected) return Response.json({ error: "Webhook is not configured." }, { status: 503 });
  if (!webhookSecretMatches(request.headers.get("x-documenso-secret"), expected)) {
    return Response.json({ error: "Invalid webhook secret." }, { status: 401 });
  }

  let body: DocumensoWebhook;
  try {
    body = (await request.json()) as DocumensoWebhook;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const event = text(body.event);
  const status = documensoEventContractStatus(event);
  const envelopeId = text(body.payload?.envelopeId);
  if (!event || !status || !envelopeId) {
    // Documenso sends more event families than this route subscribes to.  A
    // valid but irrelevant event is acknowledged so it is not retried forever.
    return Response.json({ received: true, ignored: true });
  }

  const admin = asFlexibleClient(getSupabaseAdmin());
  const at = eventTime(body.createdAt ?? body.payload?.completedAt);
  const completedAt = status === "signed"
    ? eventTime(body.payload?.completedAt ?? at)
    : null;
  const { data, error } = await admin.rpc("apply_documenso_event", {
    p_envelope_id: envelopeId,
    p_external_contract_id: externalContractId(body.payload?.externalId) || null,
    p_event: event,
    p_event_at: at,
    p_status: status,
    p_signed_at: completedAt,
  });
  if (error) {
    console.error("documenso: webhook transition failed", error);
    return Response.json({ error: "Could not save signature status." }, { status: 500 });
  }

  const transition = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  const contractId = text(transition?.matched_contract_id);
  const organizationId = text(transition?.matched_organization_id);
  const jobId = text(transition?.matched_job_id);
  const jobNumber = text(transition?.matched_job_number);
  const applied = transition?.was_applied === true;
  const duplicate = transition?.was_duplicate === true;
  const outcome = text(transition?.outcome) || "not-found";

  if (!contractId) {
    return Response.json({ received: true, ignored: true, reason: outcome });
  }

  if (applied && status === "void") {
    await recordActivity(admin, {
      organizationId,
      jobId: jobId || null,
      eventType: "contract.declined",
      label: "Contract signature request declined or canceled",
    });
  }

  // A duplicate completion may be Documenso retrying after the status commit
  // succeeded but sealed-PDF filing did not. Let it retry that idempotent work.
  if (status === "signed" && (applied || duplicate) && completedAt) {
    after(async () => {
      try {
        const filed = await fileSignedContract({ envelopeId, completedAt });
        if (!filed.ok) console.error("documenso: signed contract was not filed", filed.error);
        if (jobNumber) revalidatePath(`/jobs/${jobNumber}`);
      } catch (fileError) {
        // The job screen offers "Check and save signed copy" as a recovery
        // path, so a transient provider/storage failure is never permanent.
        console.error("documenso: signed contract filing failed", fileError);
      }
    });
  }

  if (applied && jobNumber) revalidatePath(`/jobs/${jobNumber}`);
  if (!applied && !duplicate) {
    return Response.json({ received: true, ignored: true, reason: outcome });
  }
  return Response.json({ received: true, duplicate: duplicate || undefined });
}
