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
    .select("id, invoice_id, contract_id, version_number, archived_at")
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

  revalidatePath("/files", "layout");
  revalidatePath("/invoices");

  return {
    error: "",
    notice: `Version ${Number(row.version_number ?? 1)} is the one on file now.`,
  };
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
