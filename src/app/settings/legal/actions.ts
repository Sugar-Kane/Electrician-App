"use server";

import { revalidatePath } from "next/cache";

import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export type LegalPageActionState = { error: string; saved?: boolean };

function value(formData: FormData, key: string, maxLength: number) {
  return String(formData.get(key) ?? "").trim().slice(0, maxLength);
}

/**
 * Save the tenant's legal-page details and its published state.
 *
 * The write goes through the caller's session, so RLS decides whether they may
 * touch this organization's row. `slug` is deliberately absent: a database
 * trigger derives it from the organization, and accepting one here would hand
 * a member the ability to publish at another tenant's URL.
 */
export async function saveTenantLegalPage(
  _previousState: LegalPageActionState,
  formData: FormData,
): Promise<LegalPageActionState> {
  const organizationId = value(formData, "organizationId", 40);
  const legalBusinessName = value(formData, "legalBusinessName", 200);
  const dbaName = value(formData, "dbaName", 200);
  const supportPhone = value(formData, "supportPhone", 30);
  const supportEmail = value(formData, "supportEmail", 254).toLowerCase();
  const mailingAddress = value(formData, "mailingAddress", 300);
  const programName = value(formData, "programName", 120);
  const messageFrequency = value(formData, "messageFrequency", 200);
  const published = formData.get("published") === "on";

  if (!organizationId) return { error: "No business workspace was found." };
  if (legalBusinessName.length < 2) {
    return { error: "Enter the registered legal business name." };
  }
  if (supportPhone.replace(/\D/g, "").length < 7) {
    return { error: "Enter a support phone number customers can reach." };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(supportEmail)) {
    return { error: "Enter a valid support email address." };
  }
  if (mailingAddress.length < 8) {
    return { error: "Enter the business mailing address." };
  }
  if (programName.length < 2) return { error: "Enter a messaging program name." };
  if (messageFrequency.length < 2) {
    return { error: "Describe how often customers receive messages." };
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return { error: "Sign in to update these pages." };

  const { error } = await asFlexibleClient(supabase)
    .from("tenant_legal_pages")
    .update({
      legal_business_name: legalBusinessName,
      dba_name: dbaName || null,
      support_phone: supportPhone,
      support_email: supportEmail,
      mailing_address: mailingAddress,
      program_name: programName,
      message_frequency: messageFrequency,
      published,
    })
    .eq("organization_id", organizationId);

  if (error) return { error: "The pages could not be saved. Try again." };

  revalidatePath("/settings/legal");
  revalidatePath(`/legal/${organizationId}`, "layout");

  return { error: "", saved: true };
}
