import "server-only";

import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * The journal as the business sees it: everything, including what was refused.
 *
 * Deliberately wider than the public read. A job that produced nothing is the
 * most useful row on this screen — it is the one that says "write down what you
 * did and there will be a post" — and a list that silently omitted it would
 * leave somebody wondering whether the feature works at all.
 *
 * Through the caller's session, so RLS decides which organization's posts these
 * are.
 */

export type OwnerPost = {
  id: string;
  slug: string;
  title: string;
  dek: string;
  body: string;
  lesson: string;
  status: string;
  kind: string;
  declineReason: string;
  town: string;
  publishedAt: string;
  createdAt: string;
  jobNumber: string;
  revisionCount: number;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function listOwnerJournal(): Promise<OwnerPost[]> {
  const context = await currentContext();
  if (!context) return [];

  const supabase = asFlexibleClient(await createClient());

  const { data, error } = await supabase
    .from("journal_posts")
    .select(
      "id, slug, title, dek, body, lesson, status, kind, decline_reason, town, published_at, created_at, jobs(job_number)",
    )
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("owner journal read failed", error);
    return [];
  }

  const rows = (data ?? []) as Record<string, unknown>[];

  // One query for every post's revision count rather than one per post.
  const ids = rows.map((row) => text(row.id)).filter(Boolean);
  const counts = new Map<string, number>();

  if (ids.length > 0) {
    const { data: revisions } = await supabase
      .from("journal_post_revisions")
      .select("post_id")
      .in("post_id", ids);

    for (const revision of (revisions ?? []) as Record<string, unknown>[]) {
      const key = text(revision.post_id);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return rows.map((row) => {
    const job = row.jobs as Record<string, unknown> | null;
    return {
      id: text(row.id),
      slug: text(row.slug),
      title: text(row.title),
      dek: text(row.dek),
      body: text(row.body),
      lesson: text(row.lesson),
      status: text(row.status),
      kind: text(row.kind),
      declineReason: text(row.decline_reason),
      town: text(row.town),
      publishedAt: text(row.published_at),
      createdAt: text(row.created_at),
      jobNumber: job?.job_number ? String(job.job_number) : "",
      revisionCount: counts.get(text(row.id)) ?? 0,
    };
  });
}

/**
 * Completed jobs that have no post and could still have one.
 *
 * The other half of the screen. Every job finished before this shipped is in
 * here, and so is any job whose write-up failed for a reason that has since
 * been fixed. Offering them rather than backfilling silently is the point: the
 * owner decides which of their old jobs become public pages.
 */
/** How many completed jobs to look through, and how many to offer. */
const WRITABLE_SCAN = 200;
const WRITABLE_SHOWN = 50;

export type WritableJob = {
  id: string;
  jobNumber: string;
  description: string;
  completedAt: string;
};

export async function listWritableJobs(): Promise<WritableJob[]> {
  const context = await currentContext();
  if (!context) return [];

  const supabase = asFlexibleClient(await createClient());

  const [{ data: jobs, error: jobsError }, { data: written, error: writtenError }] =
    await Promise.all([
    supabase
      .from("jobs")
      .select("id, job_number, customer_description, ai_summary, completed_at")
      .eq("organization_id", context.organizationId)
      .eq("status", "completed")
      .is("archived_at", null)
      .order("completed_at", { ascending: false, nullsFirst: false })
      /*
       * Fetched wide and cut narrow, because the cut has to happen after the
       * filter. Limiting to 50 here and then removing the ones that already
       * have posts shows an empty list the moment the 50 most recent jobs are
       * all written up, while older jobs that need one sit invisible behind
       * them.
       */
      .limit(WRITABLE_SCAN),
    supabase
      .from("journal_posts")
      .select("job_id")
      .eq("organization_id", context.organizationId)
      // A declined row is a note about why nothing was written, not a post. The
      // job stays offered, because the whole point of showing the refusal is
      // that the owner can act on it and try again.
      .neq("status", "declined"),
  ]);

  // Said out loud rather than shown as "no jobs". A failed read and a business
  // with nothing to write up look identical on screen and are not the same.
  if (jobsError) console.error("writable jobs read failed", jobsError);
  if (writtenError) console.error("written jobs read failed", writtenError);

  const taken = new Set(
    ((written ?? []) as Record<string, unknown>[]).map((row) => text(row.job_id)),
  );

  return ((jobs ?? []) as Record<string, unknown>[])
    .filter((row) => !taken.has(text(row.id)))
    .slice(0, WRITABLE_SHOWN)
    .map((row) => ({
      id: text(row.id),
      jobNumber: row.job_number ? String(row.job_number) : "",
      description: text(row.customer_description) || text(row.ai_summary),
      completedAt: text(row.completed_at),
    }));
}
