import { after, NextResponse } from "next/server";

import { isMcpConfigured } from "@/lib/mcp-session";
import { toE164 } from "@/lib/phone-format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isTwilioConfigured } from "@/lib/twilio";
import {
  bearerWebsiteKey,
  hashWebsiteKey,
  parseWebsiteRequest,
  websiteCallDecision,
  websiteTextDecision,
  type IntakeConsent,
} from "@/lib/website-intake";
import { followUpWebsiteRequest } from "@/lib/website-intake-runner";

/**
 * Requests from a business's own website.
 *
 * The site posts each request with the key its owner made in Settings →
 * Integrations. The key alone decides which business it belongs to, so nothing
 * in the body is trusted for that. The site's request id makes this safe to
 * retry: the same request sent twice finds the first one and does nothing else.
 *
 * Answers as soon as the request is saved. Telling the owner and texting the
 * customer happen after, so a slow model or carrier never holds up the form.
 */

export const maxDuration = 60;

const MAX_BODY_BYTES = 16_000;

function refuse(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  const key = bearerWebsiteKey(request.headers.get("authorization"));
  if (!key) return refuse(401, "A website key is required.");

  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return refuse(413, "Request too large.");
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return refuse(413, "Request too large.");

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse(400, "Send the request as JSON.");
  }

  const database = getSupabaseAdmin();
  const { data: keyRow } = await database
    .from("website_intake_keys")
    .select("id, organization_id")
    .eq("key_hash", hashWebsiteKey(key))
    .is("revoked_at", null)
    .maybeSingle();
  if (!keyRow) return refuse(401, "That website key isn't recognized, or it was revoked.");
  const organizationId = String(keyRow.organization_id);

  await database
    .from("website_intake_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", String(keyRow.id));

  const parsed = parseWebsiteRequest(body);
  if (!parsed.ok) return refuse(400, parsed.error);
  const input = parsed.request;

  const { data, error } = await database.rpc("website_intake", {
    p_organization_id: organizationId,
    p_payload: input,
  });
  if (error) {
    if (error.code === "22023") return refuse(400, error.message);
    console.error("website intake failed", { organizationId, code: error.code });
    // Retryable: the same reference finds this request if it did get saved.
    return refuse(503, "The request could not be saved. Send it again with the same reference.");
  }

  const result = (data ?? {}) as { request_id?: string; customer_id?: string; duplicate?: boolean; consent?: string };
  const requestId = String(result.request_id ?? "");
  const customerId = String(result.customer_id ?? "");
  const duplicate = result.duplicate === true;
  const consent = (result.consent ?? "none") as IntakeConsent;

  const [{ data: messaging }, { data: organization }] = await Promise.all([
    database.from("messaging_settings").select("messaging_service_sid").eq("organization_id", organizationId).maybeSingle(),
    database.from("organizations").select("phone").eq("id", organizationId).maybeSingle(),
  ]);
  // What the website can tell the customer now: Maya calls the ones who asked
  // for a call, and the call takes the place of the first text.
  const call = websiteCallDecision({
    duplicate,
    contactMethod: input.contactMethod,
    callingConfigured: Boolean(
      isTwilioConfigured() &&
        isMcpConfigured() &&
        process.env.XAI_WEBHOOK_SECRET &&
        process.env.NEXT_PUBLIC_APP_URL &&
        toE164(String(organization?.phone ?? "")) &&
        toE164(input.phone),
    ),
  });
  // What the website can tell the customer now. The texting itself happens a
  // moment later and checks consent again first.
  const expected = websiteTextDecision({
    duplicate,
    consent,
    consentActiveNow: consent === "recorded" || consent === "existing",
    textingConfigured: Boolean(messaging?.messaging_service_sid),
  });

  if (!duplicate && requestId && customerId) {
    after(() =>
      followUpWebsiteRequest({
        organizationId,
        requestId,
        customerId,
        consent,
        facts: {
          contactName: [input.firstName, input.lastName].filter(Boolean).join(" "),
          phone: input.phone,
          contactMethod: input.contactMethod,
          serviceName: input.serviceName || input.service,
          description: input.description,
          town: input.city || input.postalCode,
          preferredTimes: input.preferredTimes,
        },
      }),
    );
  }

  return NextResponse.json(
    {
      requestId,
      duplicate,
      text: call.call ? "skipped:calling" : expected.send ? "queued" : `skipped:${expected.reason}`,
      call: call.call ? "queued" : `skipped:${call.reason}`,
    },
    { status: duplicate ? 200 : 201 },
  );
}
