import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { recordActivity } from "@/lib/activity";
import {
  documensoEventContractStatus,
  isStaleDocumensoEvent,
  sameDocumensoEvent,
} from "@/lib/documenso-status";
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
  const query = admin
    .from("contracts")
    .select(
      `id, organization_id, job_id, status, signature_sent_at,
       signature_last_event, signature_last_event_at, jobs ( job_number )`,
    )
    .eq("signature_provider", "documenso")
    .eq("signature_envelope_id", envelopeId);
  let { data } = await query.maybeSingle();

  // Covers the very small window between creating the external envelope and
  // writing its id to the local row.  The external id is the immutable contract
  // uuid rather than a customer-controlled value.
  if (!data) {
    const contractId = externalContractId(body.payload?.externalId);
    if (contractId) {
      ({ data } = await admin
        .from("contracts")
        .select(
          `id, organization_id, job_id, status, signature_sent_at,
           signature_last_event, signature_last_event_at, jobs ( job_number )`,
        )
        .eq("id", contractId)
        .maybeSingle());
    }
  }

  if (!data) return Response.json({ received: true, ignored: true });
  const contract = data as Record<string, unknown>;
  const contractId = text(contract.id);
  const organizationId = text(contract.organization_id);
  const jobId = text(contract.job_id);
  const job = (contract.jobs ?? null) as Record<string, unknown> | null;
  const jobNumber = String(job?.job_number ?? "");
  const at = eventTime(body.createdAt ?? body.payload?.completedAt);
  if (isStaleDocumensoEvent(text(contract.signature_last_event_at), at)) {
    return Response.json({ received: true, ignored: true, reason: "stale" });
  }
  const currentStatus = text(contract.status);
  if (
    (currentStatus === "signed" && status !== "signed") ||
    (currentStatus === "void" && status === "sent")
  ) {
    return Response.json({ received: true, ignored: true, reason: "terminal-status" });
  }
  const duplicate = sameDocumensoEvent(
    text(contract.signature_last_event),
    text(contract.signature_last_event_at),
    event,
    at,
  );

  const patch: Record<string, unknown> = {
    signature_provider: "documenso",
    signature_envelope_id: envelopeId,
    signature_last_event: event,
    signature_last_event_at: at,
  };

  if (status === "signed") {
    patch.status = "signed";
    patch.signed_at = eventTime(body.payload?.completedAt ?? at);
  } else if (status === "void") {
    patch.status = "void";
    patch.signature_rejected_at = at;
  } else {
    patch.status = "sent";
    patch.signature_sent_at = text(contract.signature_sent_at) || at;
  }

  const { error } = await admin
    .from("contracts")
    .update(patch)
    .eq("id", contractId)
    .eq("organization_id", organizationId);
  if (error) return Response.json({ error: "Could not save signature status." }, { status: 500 });

  if (!duplicate && status === "void") {
    await recordActivity(admin, {
      organizationId,
      jobId: jobId || null,
      eventType: "contract.declined",
      label: "Contract signature request declined or canceled",
    });
  }

  if (status === "signed") {
    const completedAt = eventTime(body.payload?.completedAt ?? at);
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

  if (jobNumber) revalidatePath(`/jobs/${jobNumber}`);
  return Response.json({ received: true });
}
