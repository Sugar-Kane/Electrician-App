import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Anonymous, session-free Supabase client for genuinely public content.
 *
 * The cookie-bound server client in `./server` ties every query to the
 * visitor's session. The public legal pages must render for signed-out
 * visitors — carrier reviewers vetting an A2P campaign — so they read
 * through this client instead. It can only see rows RLS exposes to `anon`,
 * which today is `tenant_legal_pages` where `published` is true.
 */
export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase public environment variables are not configured.");
  }

  return createSupabaseClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type TenantLegalInfo = {
  slug: string;
  legal_business_name: string;
  dba_name: string | null;
  support_phone: string;
  support_email: string;
  mailing_address: string;
  program_name: string;
  message_frequency: string;
  updated_at: string;
};

/**
 * Look up a tenant's published legal details by URL slug.
 *
 * Resolves against tenant_legal_pages alone — public.organizations is
 * org-member-scoped by RLS and invisible to anon, so the slug is denormalized
 * onto the public table.
 *
 * Returns null when the tenant does not exist or has not published. Callers
 * must 404 rather than render partial or placeholder text: a carrier reviewer
 * who lands on a page reading "REPLACE_WITH_SUPPORT_PHONE" fails the campaign.
 */
export async function getTenantLegalInfo(slug: string): Promise<TenantLegalInfo | null> {
  const supabase = createPublicClient();

  const { data } = await supabase
    .from("tenant_legal_pages")
    .select("slug, legal_business_name, dba_name, support_phone, support_email, mailing_address, program_name, message_frequency, updated_at")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();

  return (data as TenantLegalInfo | null) ?? null;
}

/** Trading name where set, otherwise the registered legal entity. */
export function displayNameFor(info: TenantLegalInfo): string {
  return info.dba_name ?? info.legal_business_name;
}

/**
 * The business name used in the text-message consent disclosure.
 *
 * Deliberately the legal pages' display name rather than organizations.name:
 * a sole proprietor onboards under their own name ("Nicholas Kane") while
 * trading as something else ("Pacific Plains Electric"), and the two differ
 * today. The wording beside the checkbox, the consent record kept as proof,
 * and the disclosure quoted in the published SMS terms have to name the same
 * business, or carrier review reads them as describing different programs.
 *
 * Falls back to the caller's name when a tenant has not published legal pages.
 */
export async function getMessagingBusinessName(
  slug: string,
  fallback: string,
): Promise<string> {
  const info = await getTenantLegalInfo(slug);
  return info ? displayNameFor(info) : fallback;
}

/**
 * Attribution line shown on the legal pages.
 *
 * Deliberately says "operated by" rather than "a d/b/a of": a d/b/a asserts a
 * registered fictitious business name, which many sole proprietors have not
 * filed. "Operated by" is accurate whether or not an FBN exists, and still
 * names the legal entity carriers verify against.
 */
export function legalAttributionFor(info: TenantLegalInfo): string {
  return info.dba_name && info.dba_name !== info.legal_business_name
    ? `${info.dba_name}, operated by ${info.legal_business_name}`
    : info.legal_business_name;
}

export function formatLastUpdated(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
}
