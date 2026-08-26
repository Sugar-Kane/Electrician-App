import "server-only";

import { houseStyle, retryNote } from "@/lib/blog-voice";
import { writeJournalPost, type DraftedPost } from "@/lib/claude";
import { diagramLabels, isDiagramKey } from "@/lib/journal-diagrams";
import { journalSystemPrompt } from "@/lib/journal-prompt";
import { describeSource, postSlug, readJournalSource } from "@/lib/journal-source";
import { jobCategoryLabel } from "@/lib/new-job-input";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Turning one finished job into a published post.
 *
 * Runs after the response has gone back to whoever tapped "complete", so the
 * tap is never held open waiting for a model. Never throws: a journal post is
 * the least important thing that happens when a job finishes, and it must not
 * be able to take anything else down with it.
 *
 * Reads and writes with the service role because it runs outside a request, and
 * scopes every statement by the organization the job belongs to.
 */

type Database = ReturnType<typeof getSupabaseAdmin>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A post can be written once. A second attempt is a bug, not a refresh. */
async function alreadyWritten(database: Database, jobId: string): Promise<boolean> {
  const { data } = await database.from("journal_posts").select("id").eq("job_id", jobId).maybeSingle();
  return Boolean(data);
}

/**
 * A slug nobody else in this business is using.
 *
 * Two jobs about tripping breakers produce the same title and the same slug,
 * and the second insert would fail on the unique constraint. Numbering the
 * later one keeps both posts and keeps the first one's URL, which is the one
 * search engines already have.
 */
async function freeSlug(
  database: Database,
  organizationId: string,
  title: string,
): Promise<string> {
  const base = postSlug(title);

  const { data } = await database
    .from("journal_posts")
    .select("slug")
    .eq("organization_id", organizationId)
    .like("slug", `${base}%`);

  const taken = new Set((data ?? []).map((row) => text((row as Record<string, unknown>).slug)));
  if (!taken.has(base)) return base;

  for (let suffix = 2; suffix < 50; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }

  return `${base}-${Date.now()}`;
}

export type JournalOutcome =
  | { wrote: true; slug: string }
  | { wrote: false; reason: string };

/**
 * Write the post for a completed job, if there is one to write.
 *
 * The three refusals, in the order they happen:
 *
 * 1. `readJournalSource` returns null. The description is not a description of
 *    an electrical problem, or is too short to be one. Nothing is stored,
 *    because a `declined` row for a job that was never a candidate is noise in
 *    the owner's list.
 * 2. The model calls `decline`. Stored with its reason, so the owner can see
 *    the job was considered and why it produced nothing.
 * 3. The draft fails the house style twice. Also stored as declined.
 */
export async function writePostForJob(input: {
  database?: Database;
  jobId: string;
}): Promise<JournalOutcome> {
  const database = input.database ?? getSupabaseAdmin();

  try {
    if (await alreadyWritten(database, input.jobId)) {
      return { wrote: false, reason: "This job already has a post." };
    }

    const { data: job } = await database
      .from("jobs")
      .select(
        "id, organization_id, customer_id, property_id, category, customer_description, ai_summary, technician_notes, completed_at",
      )
      .eq("id", input.jobId)
      .maybeSingle();

    if (!job) return { wrote: false, reason: "That job could not be found." };

    const organizationId = text(job.organization_id);
    const row = job as Record<string, unknown>;

    const [{ data: organization }, { data: propertyRow }, { data: customer }, { data: lines }] =
      await Promise.all([
        database
          .from("organizations")
          .select("name, base_city, base_state")
          .eq("id", organizationId)
          .maybeSingle(),
        row.property_id
          ? database
              .from("properties")
              .select("city, state, address_line_1")
              .eq("id", text(row.property_id))
              .maybeSingle()
          : Promise.resolve({ data: null }),
        row.customer_id
          ? database
              .from("customers")
              .select("first_name, last_name, company_name")
              .eq("id", text(row.customer_id))
              .maybeSingle()
          : Promise.resolve({ data: null }),
        database
          .from("job_line_items")
          .select("description")
          .eq("job_id", input.jobId)
          .limit(20),
      ]);

    const property = asRecord(propertyRow);
    const customerRow = asRecord(customer);

    /*
     * The words that must never appear, built from the record rather than
     * guessed at. The street is split so "Tefft" is caught on its own — the
     * whole line "412 Tefft Street" would only ever match if the model
     * reproduced it verbatim, which is not how a leak looks.
     */
    const forbidden = [
      text(customerRow.first_name),
      text(customerRow.last_name),
      text(customerRow.company_name),
      ...text(property.address_line_1).split(/\s+/),
    ]
      .map((entry) => entry.trim())
      .filter((entry) => entry.length >= 3 && !/^\d+$/.test(entry));

    const source = readJournalSource({
      customerDescription: row.customer_description,
      aiSummary: row.ai_summary,
      technicianNotes: row.technician_notes,
      categoryLabel: jobCategoryLabel(text(row.category)),
      town: text(property.city) || text(organization?.base_city),
      state: text(property.state) || text(organization?.base_state),
      completedAt: text(row.completed_at) || new Date().toISOString(),
      parts: ((lines ?? []) as Record<string, unknown>[]).map((line) => text(line.description)),
      identifiers: forbidden,
    });

    if (!source) {
      return { wrote: false, reason: "There is nothing on this job that reads as an electrical problem." };
    }

    const drafted = await writeJournalPost({
      system: journalSystemPrompt({
        businessName: text(organization?.name) || "this business",
        city: text(organization?.base_city),
        state: text(organization?.base_state),
      }),
      brief: describeSource(source),
      kind: source.kind,
      forbidden: source.forbidden,
      // The house style, applied to the body and the lesson together: a tell in
      // the lesson is as visible as one in the body, and a customer's name in
      // either is the same problem.
      check: (draft: DraftedPost) => {
        const checked = houseStyle({
          text: `${draft.body}\n\n${draft.lesson}`,
          kind: source.kind,
          forbidden: source.forbidden,
        });

        return {
          post: {
            ...draft,
            // Repaired individually so the two fields stay separate, using the
            // same repair the combined check was run against.
            title: houseStyle({ text: draft.title, kind: source.kind }).text.trim(),
            dek: houseStyle({ text: draft.dek, kind: source.kind }).text.trim(),
            body: houseStyle({ text: draft.body, kind: source.kind }).text.trim(),
            lesson: houseStyle({ text: draft.lesson, kind: source.kind }).text.trim(),
          },
          problems: checked.problems.length > 0 ? retryNote(checked.problems) : "",
        };
      },
    });

    if (!drafted) return { wrote: false, reason: "The writer could not be reached." };

    if (!drafted.ok) {
      // Recorded rather than dropped, so the owner's list can say this job was
      // looked at and why it produced nothing.
      await database.from("journal_posts").insert({
        organization_id: organizationId,
        job_id: input.jobId,
        slug: `declined-${input.jobId.slice(0, 8)}`,
        title: "No post written",
        status: "declined",
        decline_reason: drafted.reason.slice(0, 300),
        kind: source.kind,
        town: source.town,
        state: source.state,
        category: text(row.category),
      });
      return { wrote: false, reason: drafted.reason };
    }

    const post = drafted.post;
    const diagram = isDiagramKey(post.diagram) ? post.diagram : "";

    const slug = await freeSlug(database, organizationId, post.title);

    const { error } = await database.from("journal_posts").insert({
      organization_id: organizationId,
      job_id: input.jobId,
      slug,
      title: post.title.slice(0, 200),
      dek: post.dek.slice(0, 300),
      body: post.body,
      lesson: post.lesson,
      diagram,
      // Padded and trimmed to the diagram's real slot count, so a picture is
      // never drawn with a blank where a label should be.
      diagram_labels: diagram ? diagramLabels(diagram, post.diagramLabels) : [],
      diagram_caption: diagram ? post.diagramCaption.slice(0, 200) : "",
      town: source.town,
      state: source.state,
      category: text(row.category),
      kind: source.kind,
      status: "published",
      published_at: new Date().toISOString(),
    });

    if (error) {
      console.error("journal post insert failed", error);
      return { wrote: false, reason: "The post could not be saved." };
    }

    return { wrote: true, slug };
  } catch (error) {
    // A journal post is the least important thing that happens when a job
    // finishes. It does not get to take anything else down with it.
    console.error("journal write failed", error);
    return { wrote: false, reason: "The post could not be written." };
  }
}

/**
 * A row as a bag of unknowns, or an empty one.
 *
 * The property and customer queries are conditional on the job having those
 * columns filled in, so both branches of the union have to be readable the same
 * way. An empty object rather than null means every read below is a plain
 * property access that yields undefined, which `text` already handles.
 */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
