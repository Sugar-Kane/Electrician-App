import "server-only";

import { createPublicClient } from "@/lib/supabase/public";

/**
 * Which businesses have anything published, and where it is canonical.
 *
 * One query for the whole sitemap rather than a lookup per business. Read
 * anonymously, because a sitemap is served to crawlers and there is no session.
 */

export type JournalOrganization = {
  slug: string;
  /** Their own verified hostname, or "" when posts are canonical on ours. */
  hostname: string;
  postCount: number;
  newest: string;
};

export async function listJournalOrganizations(): Promise<JournalOrganization[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("list_journal_organizations", {});

  if (error) {
    console.error("journal organizations read failed", error);
    return [];
  }

  return ((data as Record<string, unknown>[] | null) ?? []).map((row) => ({
    slug: typeof row.slug === "string" ? row.slug : "",
    hostname: typeof row.hostname === "string" ? row.hostname : "",
    postCount: Number(row.post_count) || 0,
    newest: typeof row.newest === "string" ? row.newest : "",
  })).filter((entry) => entry.slug !== "");
}
