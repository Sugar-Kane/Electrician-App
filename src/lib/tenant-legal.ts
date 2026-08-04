import "server-only";

import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export type OwnTenantLegalPage = {
  organizationId: string;
  slug: string;
  legalBusinessName: string;
  dbaName: string;
  supportPhone: string;
  supportEmail: string;
  mailingAddress: string;
  programName: string;
  messageFrequency: string;
  published: boolean;
  ownerLoginEmail: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

/**
 * The signed-in user's own legal page, read through their session so RLS
 * decides what they may see.
 *
 * Returns null when there is no session, no organization, or no legal-page row
 * yet — the caller renders the appropriate empty state rather than inventing
 * placeholder text, which is the same rule the public pages follow.
 */
export async function getOwnTenantLegalPage(): Promise<OwnTenantLegalPage | null> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return null;

  const database = asFlexibleClient(supabase);
  const { data: membership } = await database
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", authData.user.id)
    .limit(1)
    .maybeSingle();

  const organizationId = text(membership?.organization_id);
  if (!organizationId) return null;

  const { data } = await database
    .from("tenant_legal_pages")
    .select(
      "organization_id, slug, legal_business_name, dba_name, support_phone, support_email, mailing_address, program_name, message_frequency, published",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!data) return null;

  return {
    organizationId,
    slug: text(data.slug),
    legalBusinessName: text(data.legal_business_name),
    dbaName: text(data.dba_name),
    supportPhone: text(data.support_phone),
    supportEmail: text(data.support_email),
    mailingAddress: text(data.mailing_address),
    programName: text(data.program_name),
    messageFrequency: text(data.message_frequency),
    published: data.published === true,
    ownerLoginEmail: text(authData.user.email),
  };
}
