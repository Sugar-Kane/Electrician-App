"use server";

import { revalidatePath } from "next/cache";

import { effectiveDiagnosticPolicy, normalizeJurisdiction, settingsFromRow } from "@/lib/diagnostic-payment-policy";
import { currentContext } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import { asFlexibleClient } from "@/lib/supabase/flexible";

export type DiagnosticSettingsState = { error: string; notice?: string };

/**
 * Diagnostic Payment Settings. Owners and admins only (RLS: service_settings
 * is admin-write). The database refuses upfront collection where the law
 * defers it (guard_diagnostic_payment_settings), whatever this form sends.
 */
export async function saveDiagnosticPaymentSettings(
  _previous: DiagnosticSettingsState,
  formData: FormData,
): Promise<DiagnosticSettingsState> {
  const context = await currentContext();
  if (!context) return { error: "You are not signed in." };
  if (context.role !== "owner" && context.role !== "admin") {
    return { error: "Only an owner or admin can change diagnostic payment settings." };
  }

  const dollars = Number(String(formData.get("fee") ?? "").replace(/[^0-9.]/g, ""));
  const feeCents = Math.round(dollars * 100);
  if (!Number.isFinite(feeCents) || feeCents < 0 || feeCents > 500_000) {
    return { error: "Enter a diagnostic fee between $0 and $5,000." };
  }
  const jurisdiction = normalizeJurisdiction(formData.get("jurisdiction"));
  const flag = (name: string) => formData.get(name) === "on";
  const description = String(formData.get("description") ?? "").trim().slice(0, 300);
  const collectAt = formData.get("collectAt") === "at_booking" ? "at_booking" : "after_completion";

  // Said before the database refuses it, in words the owner can act on.
  const policy = effectiveDiagnosticPolicy(
    settingsFromRow({ diagnostic_fee_cents: feeCents, diagnostic_jurisdiction: jurisdiction, diagnostic_collect_at: collectAt }),
  );
  if (collectAt === "at_booking" && policy.collectAt !== "at_booking") {
    return { error: policy.overrides[0] ?? "Upfront diagnostic collection is not allowed in this jurisdiction." };
  }

  const supabase = asFlexibleClient(await createClient());
  const { data, error } = await supabase
    .from("service_settings")
    .update({
      diagnostic_fee_cents: feeCents,
      diagnostic_jurisdiction: jurisdiction || null,
      diagnostic_collect_at: collectAt,
      require_payment_method_at_booking: flag("requirePaymentMethod"),
      auto_collect_diagnostic: flag("autoCollect"),
      allow_manual_diagnostic_payment: flag("allowManual"),
      credit_diagnostic_to_repair: flag("credit"),
      send_payment_method_reminders: flag("reminders"),
      send_failed_payment_notices: flag("failedNotices"),
      diagnostic_service_description: description || null,
    })
    .eq("organization_id", context.organizationId)
    .select("organization_id")
    .maybeSingle();

  if (error || !data) {
    return { error: error?.code === "23514" ? error.message : "The settings could not be saved. Try again." };
  }
  revalidatePath("/settings/payments");
  return { error: "", notice: "Diagnostic payment settings saved. They apply to new bookings; existing authorizations keep the amount the customer agreed to." };
}
