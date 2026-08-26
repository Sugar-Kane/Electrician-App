import type { Metadata } from "next";

import { FieldPageShell } from "@/components/field-page-shell";
import { JournalManager } from "@/components/journal-manager";
import { listOwnerJournal, listWritableJobs } from "@/lib/journal-admin";
import { journalIndexPath } from "@/lib/journal-urls";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * The work journal, from the business's side.
 *
 * Beside the automatic messages rather than out on its own, because it is the
 * same kind of thing: content that goes out without anybody pressing send,
 * which the owner can read and change. Somebody who wants to know what this app
 * publishes on their behalf should find both in one place.
 */

export const metadata: Metadata = { title: "Work journal | Volteira" };

// The model call behind "ask for a change" and "write a post" runs inside this
// segment's request, so the segment needs longer than the platform default.
export const maxDuration = 120;

export const dynamic = "force-dynamic";

export default async function JournalSettingsPage() {
  const [posts, writable, slug] = await Promise.all([
    listOwnerJournal(),
    listWritableJobs(),
    organizationSlug(),
  ]);

  return (
    <FieldPageShell
      title="Work journal"
      eyebrow="Settings"
      description="Finished jobs, written up as pages that answer what people search for."
      backHref="/settings"
    >
      <section className="rounded-panel border border-line bg-surface p-4 sm:p-5">
        <p className="text-sm leading-6 text-ink-muted">
          When a job is completed, the assistant writes it up and publishes it. Posts explain the
          problem for somebody who is not an electrician, which is what makes them worth finding.
          Nothing about the customer goes in: no name, no address, no job number.
        </p>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          A job with nothing written down about what was done gets a post that explains the fault
          and stops there. It never says what was found or fixed, because nobody recorded it.
        </p>
      </section>

      <div className="mt-4">
        <JournalManager
          posts={posts}
          writable={writable}
          publicHref={journalIndexPath(slug, false)}
        />
      </div>
    </FieldPageShell>
  );
}

/** The slug the public journal lives under, for the View links. */
async function organizationSlug(): Promise<string> {
  const context = await currentContext();
  if (!context) return "";

  const supabase = asFlexibleClient(await createClient());
  const { data } = await supabase
    .from("organizations")
    .select("slug")
    .eq("id", context.organizationId)
    .maybeSingle();

  return typeof data?.slug === "string" ? data.slug : "";
}
