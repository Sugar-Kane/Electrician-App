import "server-only";

import { manualConsentStep, type ConsentFacts } from "@/lib/messaging-rules";
import { SMS_CONSENT_VERSION } from "@/lib/sms-consent";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Consent recorded automatically when the owner enters a customer's mobile
 * number for a job, and the read the one send gate (`sendSms` in twilio.ts)
 * makes.
 *
 * A customer who hands over their number for an appointment expects texts
 * about it. It is kept as `admin` (recorded by the business), with who entered
 * it and when, so the record says plainly how it came to be.
 */

export type ConsentRead = ConsentFacts | null | "unknown";

/** The customer's transactional SMS row: null for none, "unknown" when it could not be read. */
export async function readSmsConsent(
  database: FlexibleSupabaseClient,
  organizationId: string,
  customerId: string,
): Promise<ConsentRead> {
  if (!customerId) return null;
  const { data, error } = await database
    .from("messaging_consent")
    .select("opted_in_at, opted_out_at")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .eq("channel", "sms")
    .eq("scope", "transactional")
    .maybeSingle();
  if (error) return "unknown";
  if (!data) return null;
  return {
    optedInAt: data.opted_in_at ? String(data.opted_in_at) : null,
    optedOutAt: data.opted_out_at ? String(data.opted_out_at) : null,
  };
}

export type ManualConsentResult =
  | { ok: true; already: boolean }
  | { ok: false; reason: string };

/**
 * Record that the customer gave the business their number for service.
 *
 * Written through the caller's own session, so RLS decides whether they may
 * touch this business's records. Never undoes a STOP, and leaves any consent
 * already on file as it is.
 */
export async function recordManualSmsConsent(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; customerId: string; userId: string; where: "new job" },
): Promise<ManualConsentResult> {
  const existing = await readSmsConsent(database, input.organizationId, input.customerId);
  if (existing === "unknown") return { ok: false, reason: "Their text consent could not be checked. Try again." };

  const step = manualConsentStep(existing);
  if ("refused" in step) return { ok: false, reason: step.refused };
  if (step.already) return { ok: true, already: true };

  const now = new Date().toISOString();
  const record = {
    opted_in_at: now,
    source: "admin",
    captured_by: input.userId || null,
    proof_text: `[v${SMS_CONSENT_VERSION}] The customer gave the business this mobile number for their service, and it was entered on the ${input.where}. Texts are about their service only; they can reply STOP anytime.`,
  };

  const { error } =
    step.write === "insert"
      ? await database.from("messaging_consent").upsert(
          {
            organization_id: input.organizationId,
            customer_id: input.customerId,
            channel: "sms",
            scope: "transactional",
            opted_out_at: null,
            ...record,
          },
          // A row written in between (a STOP, say) is left alone.
          { onConflict: "customer_id,channel,scope", ignoreDuplicates: true },
        )
      : await database
          .from("messaging_consent")
          .update(record)
          .eq("organization_id", input.organizationId)
          .eq("customer_id", input.customerId)
          .eq("channel", "sms")
          .eq("scope", "transactional")
          .is("opted_in_at", null)
          .is("opted_out_at", null);

  if (error) {
    console.error("manual sms consent could not be saved", error);
    return { ok: false, reason: "Their text consent could not be saved. Try again." };
  }
  return { ok: true, already: false };
}
