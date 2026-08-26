"use server";

import { revalidatePath } from "next/cache";

import { checkPost, retryNote } from "@/lib/blog-voice";
import { editJournalPost, type DraftedPost } from "@/lib/claude";
import { journalSystemPrompt } from "@/lib/journal-prompt";
import { writePostForJob } from "@/lib/journal-writer";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export type JournalActionState = { error: string; notice?: string };

const UUID = /^[0-9a-f-]{36}$/i;

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Take a post down, or put it back up.
 *
 * The only control that is not an edit. Posts publish themselves, so this is
 * what "published automatically" needs to be survivable: an owner who reads
 * something they do not want on their site can remove it in one tap, without
 * deleting the record of what was written.
 */
export async function setPostVisibility(
  _previous: JournalActionState,
  formData: FormData,
): Promise<JournalActionState> {
  const postId = text(formData.get("postId"));
  const hide = text(formData.get("hide")) === "true";
  if (!UUID.test(postId)) return { error: "That post could not be found." };

  const context = await currentContext();
  if (!context) return { error: "Sign in to change this." };

  const supabase = asFlexibleClient(await createClient());
  const { error } = await supabase
    .from("journal_posts")
    .update({
      status: hide ? "hidden" : "published",
      updated_at: new Date().toISOString(),
      // Unhiding a post that never had a publish time gives it one, so the
      // ordering on the public list does not put it last forever.
      ...(hide ? {} : { published_at: new Date().toISOString() }),
    })
    .eq("id", postId)
    .eq("organization_id", context.organizationId)
    // A declined row is not a post. Unhiding one would put "No post written" on
    // the public site.
    .neq("status", "declined");

  if (error) {
    console.error("journal visibility save failed", error);
    return { error: "That could not be saved. Try again." };
  }

  revalidatePath("/settings/journal");
  return { error: "", notice: hide ? "Taken down." : "Back up." };
}

/**
 * Ask the assistant to change a post.
 *
 * Three things happen in order, and the order is the design: the reply is
 * checked against the same house style the original had to pass, the version it
 * replaces is kept, and only then is the post updated. An edit that fails the
 * check changes nothing at all.
 *
 * The slug is deliberately not recomputed when the title changes. The old URL
 * is the one search engines have and the one anybody linked to; moving it to
 * gain a slightly better keyword loses everything the post has accumulated.
 */
export async function askAssistantToEdit(
  _previous: JournalActionState,
  formData: FormData,
): Promise<JournalActionState> {
  const postId = text(formData.get("postId"));
  const instruction = text(formData.get("instruction"));

  if (!UUID.test(postId)) return { error: "That post could not be found." };
  if (instruction.length < 4) return { error: "Say what you would like changed." };

  const context = await currentContext();
  if (!context) return { error: "Sign in to change this." };

  const supabase = asFlexibleClient(await createClient());

  const { data: post } = await supabase
    .from("journal_posts")
    .select("id, job_id, title, dek, body, lesson, kind, status")
    .eq("id", postId)
    .eq("organization_id", context.organizationId)
    .maybeSingle();

  if (!post) return { error: "That post could not be found." };
  if (post.status === "declined") {
    return { error: "There is no post here to change. Write one first." };
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("name, base_city, base_state")
    .eq("id", context.organizationId)
    .maybeSingle();

  const kind = post.kind === "story" ? "story" : "lesson";

  /*
   * The same words the writer was checked against, recovered from the job.
   *
   * Without this the edit path was weaker than the path that created the post:
   * a rewrite could put a customer's name back into a page the original was
   * refused for containing. The list is not stored on the post because it is
   * derived from records that can change, so it is read fresh each time.
   */
  const forbidden = await forbiddenWordsFor(
    supabase,
    context.organizationId,
    String(post.job_id ?? ""),
  );

  const edited = await editJournalPost({
    system: journalSystemPrompt({
      businessName: String(organization?.name ?? "this business"),
      city: String(organization?.base_city ?? ""),
      state: String(organization?.base_state ?? ""),
    }),
    post: {
      title: String(post.title ?? ""),
      dek: String(post.dek ?? ""),
      body: String(post.body ?? ""),
      lesson: String(post.lesson ?? ""),
    },
    instruction,
    // All four fields, for the same reason the writer checks all four: an edit
    // that moved a name into the title would otherwise sail through.
    check: (draft: DraftedPost) => {
      const { post, problems } = checkPost({ post: draft, kind, forbidden });
      return {
        post: { ...draft, ...post },
        problems: problems.length > 0 ? retryNote(problems) : "",
      };
    },
  });

  if (!edited) {
    return {
      error: "That change could not be made. Try asking for it a different way.",
    };
  }

  /*
   * Kept before the update, and the write is checked.
   *
   * Discarding this error meant the update ran anyway: the previous version was
   * gone, the notice below still said it had been kept, and `revisionCount`
   * stayed at zero so the undo control never appeared. Three ways of telling
   * somebody their work is recoverable when it is not.
   */
  const { error: kept } = await supabase.from("journal_post_revisions").insert({
    organization_id: context.organizationId,
    post_id: postId,
    title: String(post.title ?? ""),
    dek: String(post.dek ?? ""),
    body: String(post.body ?? ""),
    lesson: String(post.lesson ?? ""),
    instruction,
  });

  if (kept) {
    console.error("journal revision save failed", kept);
    return { error: "That could not be saved. Try again." };
  }

  const { error } = await supabase
    .from("journal_posts")
    .update({
      title: edited.title.slice(0, 200),
      dek: edited.dek.slice(0, 300),
      body: edited.body,
      lesson: edited.lesson,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId)
    .eq("organization_id", context.organizationId);

  if (error) {
    console.error("journal edit save failed", error);
    return { error: "That could not be saved. Try again." };
  }

  revalidatePath("/settings/journal");
  return { error: "", notice: "Changed. The version before this is kept." };
}

/** Put the last version back, discarding the edit on top of it. */
export async function undoLastEdit(
  _previous: JournalActionState,
  formData: FormData,
): Promise<JournalActionState> {
  const postId = text(formData.get("postId"));
  if (!UUID.test(postId)) return { error: "That post could not be found." };

  const context = await currentContext();
  if (!context) return { error: "Sign in to change this." };

  const supabase = asFlexibleClient(await createClient());

  const { data: revision } = await supabase
    .from("journal_post_revisions")
    .select("id, title, dek, body, lesson")
    .eq("post_id", postId)
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!revision) return { error: "There is nothing to go back to." };

  const { error } = await supabase
    .from("journal_posts")
    .update({
      title: String(revision.title ?? ""),
      dek: String(revision.dek ?? ""),
      body: String(revision.body ?? ""),
      lesson: String(revision.lesson ?? ""),
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId)
    .eq("organization_id", context.organizationId);

  if (error) return { error: "That could not be undone. Try again." };

  // Consumed, so a second undo goes back a further step rather than replaying
  // the same one.
  await supabase.from("journal_post_revisions").delete().eq("id", String(revision.id));

  revalidatePath("/settings/journal");
  return { error: "", notice: "Put back." };
}

/**
 * Write a post for a job that never got one.
 *
 * Every job finished before this shipped is a candidate, and so is one whose
 * write-up failed for a reason since fixed. Offered rather than backfilled: the
 * owner decides which of their old jobs become public pages, and with one
 * completed job in the system a silent backfill would have been a surprise
 * rather than a feature.
 */
export async function writePostNow(
  _previous: JournalActionState,
  formData: FormData,
): Promise<JournalActionState> {
  const jobId = text(formData.get("jobId"));
  if (!UUID.test(jobId)) return { error: "That job could not be found." };

  const context = await currentContext();
  if (!context) return { error: "Sign in to do that." };

  // Checked through the session before handing the job id to the service-role
  // writer, so a job number from another organization cannot be written up.
  const supabase = asFlexibleClient(await createClient());
  const { data: job } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", jobId)
    .eq("organization_id", context.organizationId)
    .maybeSingle();

  if (!job) return { error: "That job could not be found." };

  const outcome = await writePostForJob({ jobId });
  revalidatePath("/settings/journal");

  return outcome.wrote
    ? { error: "", notice: "Written and published." }
    : { error: "", notice: `No post: ${outcome.reason}` };
}

/**
 * The words that must not appear in this post, from the job it came from.
 *
 * The same list `journal-writer` builds when it first writes a post. Shared by
 * shape rather than by import because the writer runs with the service role
 * outside a request and this runs inside one, through the caller's session.
 */
async function forbiddenWordsFor(
  supabase: ReturnType<typeof asFlexibleClient>,
  organizationId: string,
  jobId: string,
): Promise<string[]> {
  if (!UUID.test(jobId)) return [];

  const { data: job } = await supabase
    .from("jobs")
    .select("customer_id, property_id")
    .eq("id", jobId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!job) return [];

  const [{ data: customer }, { data: property }] = await Promise.all([
    job.customer_id
      ? supabase
          .from("customers")
          .select("first_name, last_name, company_name")
          .eq("id", String(job.customer_id))
          .maybeSingle()
      : Promise.resolve({ data: null }),
    job.property_id
      ? supabase
          .from("properties")
          .select("address_line_1")
          .eq("id", String(job.property_id))
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const read = (row: unknown, key: string) => {
    const value = row && typeof row === "object" ? (row as Record<string, unknown>)[key] : "";
    return typeof value === "string" ? value : "";
  };

  return [
    read(customer, "first_name"),
    read(customer, "last_name"),
    read(customer, "company_name"),
    ...read(property, "address_line_1").split(/\s+/),
  ]
    .map((entry) => entry.trim())
    // Three characters, and never a bare house number: "412" would reject any
    // post that mentioned a 412 of any kind.
    .filter((entry) => entry.length >= 3 && !/^\d+$/.test(entry));
}
