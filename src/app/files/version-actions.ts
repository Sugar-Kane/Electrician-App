"use server";

import { revalidatePath } from "next/cache";

import { getDocumentVersions, type DocumentVersion } from "@/lib/document-workspace";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Going back to an earlier version of a document.
 *
 * Every regeneration since August has archived the version it replaced rather
 * than deleting it — row, storage object and all — so the way back has existed
 * the whole time and has been reachable from nowhere.
 *
 * Restoring is a swap of two flags, not a copy: the version being restored
 * stops being archived and the one currently on file starts. Nothing is
 * rewritten, nothing is destroyed, and restoring again puts it back. The
 * version numbers stay as they were, because they say what order these were
 * made in and that does not change by looking at them again.
 */

export type VersionState = { error: string; notice?: string };

export async function restoreDocumentVersion(
  _previous: VersionState,
  formData: FormData,
): Promise<VersionState> {
  const versionId = String(formData.get("versionId") ?? "").trim();
  if (!versionId) return { error: "That version could not be found." };

  const context = await currentContext();
  if (!context) return { error: "You are not signed in to a business." };

  const supabase = asFlexibleClient(await createClient());
  const organizationId = context.organizationId;

  const { data } = await supabase
    .from("documents")
    .select("id, invoice_id, contract_id, version_number, archived_at, source_snapshot")
    .eq("id", versionId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  const row = (data ?? null) as Record<string, unknown> | null;
  if (!row) return { error: "That version could not be found." };
  if (row.archived_at === null) return { error: "", notice: "That is the one already on file." };

  const owner =
    typeof row.invoice_id === "string" && row.invoice_id
      ? { column: "invoice_id", id: row.invoice_id }
      : typeof row.contract_id === "string" && row.contract_id
        ? { column: "contract_id", id: row.contract_id }
        : null;

  if (!owner) return { error: "That document has no earlier versions to go back to." };

  const stamp = new Date().toISOString();

  /*
   * The current one is archived first.
   *
   * The other order would leave two rows unarchived for a moment, and "the
   * current document" is defined as the unarchived one — so anything reading
   * during that moment would find two and pick whichever came back first.
   */
  const { error: archived } = await supabase
    .from("documents")
    .update({ archived_at: stamp })
    .eq("organization_id", organizationId)
    .eq(owner.column, owner.id)
    .is("archived_at", null);

  if (archived) {
    console.error("files: could not archive the current version", archived);
    return { error: "That version could not be restored." };
  }

  const { error: restored } = await supabase
    .from("documents")
    .update({ archived_at: null })
    .eq("id", versionId)
    .eq("organization_id", organizationId);

  if (restored) {
    console.error("files: could not restore the chosen version", restored);
    // The current one is archived and the chosen one is not restored, which
    // would leave the record with no document at all. Put it back.
    await supabase
      .from("documents")
      .update({ archived_at: null })
      .eq("organization_id", organizationId)
      .eq(owner.column, owner.id)
      .eq("archived_at", stamp);

    return { error: "That version could not be restored. Nothing was changed." };
  }

  /*
   * The record goes back with the file.
   *
   * Swapping the flags alone restores the picture and leaves the source holding
   * whatever it was last edited to — so the next regeneration would quietly
   * reintroduce the change somebody had just undone. The snapshot is what makes
   * this an undo rather than a screenshot.
   *
   * Done after the swap on purpose. The swap is the part with a rollback; if
   * writing the source back fails, the version on file is still the one asked
   * for, and the notice says the text was not moved.
   */
  const restoredSource = await putSourceBack(supabase, organizationId, owner, row.source_snapshot);

  revalidatePath("/files", "layout");
  revalidatePath("/invoices");

  const version = Number(row.version_number ?? 1);
  return { error: "", notice: `Version ${version} is the one on file now. ${restoredSource}`.trim() };
}

type Owner = { column: string; id: string };

/**
 * Write a version's source back onto the record it came from.
 *
 * Returns the sentence to append to the notice, because what happened here is
 * the part a person actually needs told. A version made before snapshots
 * existed cannot restore anything, and saying so is the whole point — an undo
 * that silently did half its job is worse than one that admits it.
 */
async function putSourceBack(
  supabase: ReturnType<typeof asFlexibleClient>,
  organizationId: string,
  owner: Owner,
  snapshot: unknown,
): Promise<string> {
  if (!snapshot || typeof snapshot !== "object") {
    return "It was made before edits were tracked, so the wording behind it was left as it is.";
  }

  const source = snapshot as Record<string, unknown>;

  // Only contracts carry text that an edit rewrites. An invoice's snapshot is
  // kept for the record, but its figures live on the invoice and its lines on
  // the job, and rewriting those from here would reach past this document into
  // the job's own history.
  if (owner.column !== "contract_id") return "";

  const body = typeof source.body === "string" ? source.body : "";
  if (!body) return "";

  const { error } = await supabase
    .from("contracts")
    .update({
      body,
      scope: typeof source.scope === "string" ? source.scope : null,
      unfilled: Array.isArray(source.unfilled) ? source.unfilled : [],
    })
    .eq("id", owner.id)
    .eq("organization_id", organizationId);

  if (error) {
    console.error("files: could not put the contract text back", error);
    return "The file is back, but its wording could not be restored — check it before sending.";
  }

  return "Its wording is back too.";
}

/**
 * The versions of one document, for the panel that shows them.
 *
 * A plain async action rather than a page read, because the panel asks for it
 * when somebody opens a preview — fetching the history of every document in a
 * folder to render the ones nobody opened is a page's worth of queries for
 * nothing.
 */
export async function listDocumentVersions(documentId: string): Promise<DocumentVersion[]> {
  return getDocumentVersions(documentId);
}
