import "server-only";

import { licenseBillingRefusal, licenseWarning, type LicenseWarning } from "@/lib/license-status";
import { localDate } from "@/lib/ca-home-improvement";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";

/** The business's license warning, read fresh (license-status.ts). */
export async function businessLicenseWarning(organizationId: string): Promise<LicenseWarning> {
  const { data } = await asFlexibleClient(getSupabaseAdmin())
    .from("organizations")
    .select("license_number, license_status, license_expires_on, license_verified_on, license_acknowledged_at, timezone")
    .eq("id", organizationId)
    .maybeSingle();
  const row = (data ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const now = new Date();
  return licenseWarning(
    {
      number: text(row.license_number),
      status: text(row.license_status) || null,
      expiresOn: text(row.license_expires_on) || null,
      verifiedOn: text(row.license_verified_on) || null,
      acknowledgedAt: text(row.license_acknowledged_at) || null,
    },
    localDate(now, text(row.timezone) || "America/Los_Angeles"),
    now,
  );
}

/** Why an invoice or pay link may not go out now because of the license, or "". */
export async function licenseRefusal(organizationId: string): Promise<string> {
  return licenseBillingRefusal(await businessLicenseWarning(organizationId));
}
