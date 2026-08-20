import "server-only";

import { attachmentKind, MAX_ATTACHMENTS, type Reading } from "@/lib/attachment-kinds";
import { DOCUMENTS_BUCKET } from "@/lib/document-storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Turning files somebody attached into something the model can look at.
 *
 * Two rules do the work here.
 *
 * The first is that a document id arriving in a form is a claim, not a fact.
 * Every id is read back scoped to the caller's organization before anything is
 * fetched — otherwise a crafted request would have this server dutifully fetch
 * another business's panel photos and describe them.
 *
 * The second is that a file the model cannot read must not be quietly dropped.
 * It comes back in `storedOnly` so the turn can say what happened to it. An
 * answer that ignores the video somebody attached, and never mentions it, is
 * the worst outcome available.
 */

export type AttachmentBlock =
  | { type: "image"; source: { type: "url"; url: string } }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
    };

export type PreparedAttachments = {
  /** Content blocks, in the order they were attached. */
  blocks: AttachmentBlock[];
  /** Names of files kept but not read, for the sentence that admits it. */
  storedOnly: string[];
};

/** Long enough for Anthropic to fetch the image, short enough not to linger. */
const SIGNED_URL_SECONDS = 300;

type Row = {
  storagePath: string;
  fileName: string;
  reading: Reading;
};

async function readRows(
  database: FlexibleSupabaseClient,
  organizationId: string,
  documentIds: string[],
): Promise<Row[]> {
  const { data } = await database
    .from("documents")
    .select("id, storage_path, file_name, mime_type")
    // Scoped to the caller's organization. This is the check that matters.
    .eq("organization_id", organizationId)
    .in("id", documentIds);

  const byId = new Map<string, Row>();

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const id = typeof row.id === "string" ? row.id : "";
    // Snake case here on purpose: this is the raw row, and these are column
    // names. The camel case below is this module's own shape.
    const storagePath = typeof row.storage_path === "string" ? row.storage_path : "";
    const fileName = typeof row.file_name === "string" ? row.file_name : "";
    const mimeType = typeof row.mime_type === "string" ? row.mime_type : "";
    if (!id || !storagePath) continue;

    const kind = attachmentKind(mimeType, fileName);
    if (!kind) continue;

    byId.set(id, { storagePath, fileName, reading: kind.reading });
  }

  // Returned in the order they were attached rather than the order the database
  // felt like, so "the second photo" means what the person meant.
  return documentIds.map((id) => byId.get(id)).filter((row): row is Row => Boolean(row));
}

export async function prepareAttachments(input: {
  database: FlexibleSupabaseClient;
  organizationId: string;
  documentIds: string[];
}): Promise<PreparedAttachments> {
  const wanted = input.documentIds
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_ATTACHMENTS);

  if (wanted.length === 0) return { blocks: [], storedOnly: [] };

  const rows = await readRows(input.database, input.organizationId, wanted);
  if (rows.length === 0) return { blocks: [], storedOnly: [] };

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return { blocks: [], storedOnly: rows.map((row) => row.fileName) };
  }

  const blocks: AttachmentBlock[] = [];
  const storedOnly: string[] = [];

  for (const row of rows) {
    if (row.reading === "stored") {
      storedOnly.push(row.fileName);
      continue;
    }

    if (row.reading === "image") {
      /*
       * A signed URL rather than base64.
       *
       * The whole request has to fit in 32 MB and base64 is a third bigger than
       * the file, so inlining a few phone photos spends the budget on encoding.
       * A short-lived URL costs the request nothing and Anthropic fetches it.
       */
      const signed = await admin.storage
        .from(DOCUMENTS_BUCKET)
        .createSignedUrl(row.storagePath, SIGNED_URL_SECONDS);

      const url = typeof signed.data?.signedUrl === "string" ? signed.data.signedUrl : "";
      if (!url) {
        console.error("assistant attachment: could not sign a read", signed.error);
        storedOnly.push(row.fileName);
        continue;
      }

      blocks.push({ type: "image", source: { type: "url", url } });
      continue;
    }

    // A PDF goes base64: the documented sources are base64 and the Files API,
    // and a URL source is not something to guess at with somebody's permit.
    const downloaded = await admin.storage.from(DOCUMENTS_BUCKET).download(row.storagePath);
    const file = downloaded.data;
    if (!file) {
      console.error("assistant attachment: could not download a document", downloaded.error);
      storedOnly.push(row.fileName);
      continue;
    }

    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    blocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data },
    });
  }

  return { blocks, storedOnly };
}
