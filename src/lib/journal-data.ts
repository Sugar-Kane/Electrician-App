import "server-only";

import { createPublicClient } from "@/lib/supabase/public";

/**
 * Reading journal posts for people who are not signed in.
 *
 * Through the RPCs rather than the table, following `public-booking`. An
 * anonymous reader gets exactly the columns a post is made of: no job id, no
 * organization id, no status, nothing that would let somebody enumerate what a
 * business has taken down.
 *
 * Every function returns empty or null on failure rather than throwing. This is
 * a public page reached from a search result by a stranger, and the worst thing
 * it can do is show them a stack trace with a Postgres error in it.
 */

export type JournalListing = {
  slug: string;
  title: string;
  dek: string;
  town: string;
  state: string;
  publishedAt: string;
};

export type JournalPost = {
  slug: string;
  title: string;
  dek: string;
  body: string;
  lesson: string;
  diagram: string;
  diagramLabels: string[];
  diagramCaption: string;
  town: string;
  state: string;
  kind: string;
  publishedAt: string;
  updatedAt: string;
  businessName: string;
  businessSlug: string;
  baseCity: string;
  baseState: string;
  /** For the LocalBusiness structured data, and empty when unset. */
  businessPhone: string;
  basePostalCode: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readListing(row: Record<string, unknown>): JournalListing {
  return {
    slug: text(row.slug),
    title: text(row.title),
    dek: text(row.dek),
    town: text(row.town),
    state: text(row.state),
    publishedAt: text(row.published_at),
  };
}

export async function listPublicJournal(
  organizationSlug: string,
  limit = 50,
): Promise<JournalListing[]> {
  if (!organizationSlug) return [];

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("list_public_journal_posts", {
    p_slug: organizationSlug,
    p_limit: limit,
  });

  if (error) {
    console.error("journal list failed", error);
    return [];
  }

  return ((data as Record<string, unknown>[] | null) ?? []).map(readListing);
}

export async function getPublicJournalPost(
  organizationSlug: string,
  postSlug: string,
): Promise<JournalPost | null> {
  if (!organizationSlug || !postSlug) return null;

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_public_journal_post", {
    p_slug: organizationSlug,
    p_post_slug: postSlug,
  });

  if (error) {
    console.error("journal post read failed", error);
    return null;
  }

  const row = ((data as Record<string, unknown>[] | null) ?? [])[0];
  if (!row) return null;

  return {
    slug: text(row.slug),
    title: text(row.title),
    dek: text(row.dek),
    body: text(row.body),
    lesson: text(row.lesson),
    diagram: text(row.diagram),
    diagramLabels: Array.isArray(row.diagram_labels) ? (row.diagram_labels as string[]) : [],
    diagramCaption: text(row.diagram_caption),
    town: text(row.town),
    state: text(row.state),
    kind: text(row.kind),
    publishedAt: text(row.published_at),
    updatedAt: text(row.updated_at),
    businessName: text(row.business_name),
    businessSlug: text(row.business_slug),
    baseCity: text(row.base_city),
    baseState: text(row.base_state),
    businessPhone: text(row.business_phone),
    basePostalCode: text(row.base_postal_code),
  };
}

/**
 * The hostname a business has verified, or "".
 *
 * Read anonymously, because it decides the canonical on a page nobody is signed
 * in for. Only a verified row counts: an unverified one is a name somebody
 * typed into a settings box, and pointing the canonical at a hostname that does
 * not resolve would take the post out of the index entirely.
 */
export async function verifiedHostFor(organizationSlug: string): Promise<string> {
  if (!organizationSlug) return "";

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_verified_host_for_slug", {
    p_slug: organizationSlug,
  });

  if (error) return "";
  return text(data);
}
