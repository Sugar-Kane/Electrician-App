"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { prepareAttachments } from "@/lib/assistant-attachments";
import { attachmentKind, refuseAttachment } from "@/lib/attachment-kinds";
import { readReceipt } from "@/lib/claude";
import { documentFolderId } from "@/lib/document-folders";
import {
  DOCUMENTS_BUCKET,
  documentStoragePath,
  ensureDocumentsBucket,
} from "@/lib/document-storage";
import { getInventory } from "@/lib/job-data";
import { parseCostToCents } from "@/lib/new-job-input";
import {
  describeReceiptPlan,
  planReceipt,
  readReceiptLine,
  type ReceiptLine,
  type ReceiptPlanLine,
} from "@/lib/receipt-lines";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Photograph the receipt, and the stock list catches up with the van.
 *
 * Three steps, and the middle one is the point. The browser uploads the photo
 * straight to storage, because a Server Action's body is capped around a
 * megabyte and a photo of a receipt is three. The server reads it and comes
 * back with what it thinks the paper says. Nothing is written until somebody
 * has looked at that reading and tapped Save.
 *
 * The order matters more here than anywhere else in the app. Stock that is
 * wrong is worse than stock that is missing: a count nobody typed is one an
 * electrician still checks, and a count a scanner invented is one they believe.
 */

/** Where a scanned receipt is filed. */
const FOLDER_KEY = "receipts";
const FOLDER_NAME = "Receipts";

/** The model is capped at 40 lines; so is anything posted back. */
const MAX_LINES = 40;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function callerContext() {
  const supabase = asFlexibleClient(await createClient());

  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id ?? "";

  const { data } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId = text(data?.organization_id);
  if (!organizationId) return null;

  return { supabase, organizationId, userId };
}

export type ReceiptTicket =
  | { ok: true; path: string; token: string; bucket: string }
  | { ok: false; error: string };

/**
 * Permission to put one receipt in one place.
 *
 * A format nothing can read is refused here rather than after the upload. HEIC
 * is the one that matters: it is what an iPhone camera writes, this model
 * cannot see it, and letting it upload only to say so afterwards wastes four
 * megabytes of somebody's signal to deliver worse news later.
 */
export async function createReceiptUpload(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<ReceiptTicket> {
  const refusal = refuseAttachment(input);
  if (refusal) return { ok: false, error: refusal };

  const kind = attachmentKind(input.mimeType, input.fileName);
  if (!kind) return { ok: false, error: "That file type is not supported." };
  if (kind.reading === "stored") {
    return {
      ok: false,
      error:
        "That format cannot be read yet. Take the photo again from inside the app, or share it as a JPEG.",
    };
  }

  const context = await callerContext();
  if (!context) return { ok: false, error: "You are not a member of a business." };

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    await ensureDocumentsBucket();
    admin = getSupabaseAdmin();
  } catch {
    return { ok: false, error: "File storage is not set up yet." };
  }

  // The organization id has to be the first segment: the storage policies read
  // it back out to decide who may see the object.
  const path = documentStoragePath(
    context.organizationId,
    FOLDER_KEY,
    `${randomUUID()}.${kind.extension}`,
  );

  const signed = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data?.token) {
    console.error("receipt: could not sign an upload", signed.error);
    return { ok: false, error: "That receipt could not be started. Try again." };
  }

  return { ok: true, path, token: signed.data.token, bucket: DOCUMENTS_BUCKET };
}

export type ScannedReceipt =
  | {
      ok: true;
      documentId: string;
      supplier: string;
      purchasedOn: string;
      printedTotalCents: number;
      lines: ReceiptPlanLine[];
      summary: string;
    }
  | { ok: false; error: string };

/**
 * File the receipt that has just landed, and read it.
 *
 * The document row is written before the model is asked anything, so a receipt
 * whose reading fails is still filed under Receipts where somebody can open it.
 * That is the difference between "the scanner did not work" and "the scanner
 * did not work and lost my receipt".
 */
export async function scanReceipt(input: {
  path: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<ScannedReceipt> {
  const context = await callerContext();
  if (!context) return { ok: false, error: "You are not a member of a business." };

  const expectedPrefix = documentStoragePath(context.organizationId, FOLDER_KEY, "");
  if (!input.path || !input.path.startsWith(expectedPrefix)) {
    return { ok: false, error: "That receipt could not be read." };
  }

  const kind = attachmentKind(input.mimeType, input.fileName);
  if (!kind || kind.reading === "stored") {
    return { ok: false, error: "That file type is not supported." };
  }

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return { ok: false, error: "File storage is not set up yet." };
  }

  // Signing an object that is not there fails, which is the cheapest way to ask
  // whether the upload actually finished.
  const exists = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUrl(input.path, 60);
  if (exists.error) {
    return { ok: false, error: "That receipt did not finish uploading. Try again." };
  }

  const folderId = await documentFolderId({
    database: context.supabase,
    organizationId: context.organizationId,
    jobId: "",
    jobNumber: "",
    fallbackKey: FOLDER_KEY,
    fallbackName: FOLDER_NAME,
  });
  if (!folderId) return { ok: false, error: "The receipts folder could not be prepared." };

  const { data: document, error: documentError } = await context.supabase
    .from("documents")
    .insert({
      organization_id: context.organizationId,
      folder_id: folderId,
      storage_path: input.path,
      file_name: input.fileName || `receipt.${kind.extension}`,
      display_name: input.fileName || "Receipt",
      document_type: "receipt",
      mime_type: kind.mimeType,
      size_bytes: Number.isFinite(input.sizeBytes) ? input.sizeBytes : 0,
      uploaded_by: context.userId,
    })
    .select("id")
    .maybeSingle();

  const documentId = text(document?.id);
  if (documentError || !documentId) {
    // Nothing points at the object. Left alone it is stranded in the bucket.
    await admin.storage.from(DOCUMENTS_BUCKET).remove([input.path]);
    console.error("receipt: could not write the document row", documentError);
    return { ok: false, error: "That receipt could not be filed." };
  }

  // The same preparation the assistant's attachments go through — signed URL
  // for a photo, base64 for a PDF — and the same re-check that the id belongs
  // to this organization.
  const prepared = await prepareAttachments({
    database: context.supabase,
    organizationId: context.organizationId,
    documentIds: [documentId],
  });

  const block = prepared.blocks[0];
  if (!block) {
    return {
      ok: false,
      error: "That receipt was saved, but it could not be opened for reading. Try a clearer photo.",
    };
  }

  const read = await readReceipt({ block });
  if (!read) {
    return {
      ok: false,
      error: "That receipt was saved, but it could not be read. Add the parts by hand, or try a clearer photo.",
    };
  }

  const lines: ReceiptLine[] = read.lines
    .slice(0, MAX_LINES)
    .map((raw) => readReceiptLine(raw))
    .filter((line): line is ReceiptLine => line !== null);

  const stock = await getInventory();
  const planned = planReceipt(
    lines,
    stock.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      partNumber: item.partNumber,
      location: item.location,
    })),
  );

  revalidatePath("/files");

  return {
    ok: true,
    documentId,
    supplier: read.supplier,
    purchasedOn: read.purchasedOn,
    printedTotalCents: read.totalCents,
    lines: planned,
    summary: describeReceiptPlan(planned),
  };
}

export type ReceiptSaveState = {
  error: string;
  notice?: string;
  /** Set once a receipt has been saved, so the panel can close itself. */
  savedId?: string;
};

type PostedLine = {
  name: string;
  quantity: number;
  unit: string;
  unitCostCents: number;
  partNumber: string;
  matchId: string;
};

/**
 * What came back from the review table.
 *
 * Every field is re-read rather than trusted. The rows went out to a browser
 * and came back, so this is ordinary untrusted input — and `matchId` in
 * particular is a uuid that decides which row gets stock added to it, checked
 * against the caller's own organization below before anything moves.
 */
function readPostedLines(formData: FormData): PostedLine[] {
  const lines: PostedLine[] = [];

  for (const raw of formData.getAll("line").slice(0, MAX_LINES)) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      continue;
    }

    const name = text(parsed.name).slice(0, 200);
    if (!name) continue;

    const quantity = Number(parsed.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const cost = parseCostToCents(text(parsed.unitCost));

    lines.push({
      name,
      quantity: Math.round(quantity * 100) / 100,
      unit: text(parsed.unit).slice(0, 24) || "each",
      unitCostCents: cost && cost > 0 ? cost : 0,
      partNumber: text(parsed.partNumber).slice(0, 64),
      matchId: text(parsed.matchId).slice(0, 64),
    });
  }

  return lines;
}

/**
 * Put the receipt into stock.
 *
 * Each line is either a movement against a row that exists or a new row and its
 * first movement — never a number written over `quantity_on_hand`, which the
 * trigger owns. The price paid goes onto the movement, because a breaker bought
 * at $42 in August was a $42 expense in August however the price moves later.
 *
 * The receipt itself is linked from every movement it produced, so "show me
 * what that purchase was" has an answer that is the actual piece of paper.
 */
export async function saveReceipt(
  _previous: ReceiptSaveState,
  formData: FormData,
): Promise<ReceiptSaveState> {
  const documentId = field(formData, "documentId");
  const supplier = field(formData, "supplier").slice(0, 120);
  const purchasedOn = field(formData, "purchasedOn").slice(0, 10);

  const lines = readPostedLines(formData);
  if (lines.length === 0) return { error: "There was nothing on that receipt to save." };

  const context = await callerContext();
  if (!context) return { error: "You are not a member of a business." };
  const { supabase, organizationId } = context;

  /*
   * The receipt has to belong to this business before it is written onto
   * anything. It arrived in a form field, which makes it a claim.
   */
  let receiptId: string | null = null;
  if (documentId) {
    const { data: document } = await supabase
      .from("documents")
      .select("id")
      .eq("id", documentId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    receiptId = text(document?.id) || null;
  }

  const note = [supplier ? `From ${supplier}` : "From a receipt", purchasedOn]
    .filter(Boolean)
    .join(", ");

  let added = 0;
  let created = 0;
  const failed: string[] = [];

  for (const line of lines) {
    let itemId = "";

    if (line.matchId) {
      // Scoped to this organization, so a pasted uuid cannot add stock to
      // somebody else's shelf.
      const { data: existing } = await supabase
        .from("inventory_items")
        .select("id")
        .eq("id", line.matchId)
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .maybeSingle();

      itemId = text(existing?.id);
    }

    if (!itemId) {
      const { data: madeItem, error: itemError } = await supabase
        .from("inventory_items")
        // Zero, and the movement below decides. Setting it here would be a
        // number the trigger immediately disagrees with.
        .insert({
          organization_id: organizationId,
          name: line.name,
          quantity_on_hand: 0,
          unit: line.unit,
          sku: line.partNumber || null,
          supplier: supplier || null,
          unit_cost_cents: line.unitCostCents,
          created_by: context.userId || null,
        })
        .select("id")
        .maybeSingle();

      itemId = text(madeItem?.id);
      if (itemError || !itemId) {
        console.error("receipt: an item could not be created", itemError);
        failed.push(line.name);
        continue;
      }
      created += 1;
    } else if (line.unitCostCents > 0) {
      /*
       * The latest price paid becomes the item's price.
       *
       * Only the item's — every movement keeps the price it happened at, so
       * this changes what the next estimate quotes without rewriting what last
       * quarter cost.
       */
      await supabase
        .from("inventory_items")
        .update({ unit_cost_cents: line.unitCostCents })
        .eq("id", itemId)
        .eq("organization_id", organizationId);
    }

    const { error: movementError } = await supabase.from("inventory_movements").insert({
      organization_id: organizationId,
      item_id: itemId,
      quantity: line.quantity,
      reason: "received",
      unit_cost_cents: line.unitCostCents,
      note,
      receipt_document_id: receiptId,
      created_by: context.userId || null,
    });

    if (movementError) {
      console.error("receipt: a movement could not be recorded", movementError);
      failed.push(line.name);
      continue;
    }

    added += 1;
  }

  revalidatePath("/inventory");
  revalidatePath("/materials");

  if (added === 0) {
    return { error: "None of that receipt could be saved. Nothing was changed." };
  }

  const parts = [
    `${added} ${added === 1 ? "line" : "lines"} added to stock`,
    created > 0 ? `${created} ${created === 1 ? "part is" : "parts are"} new to the list` : "",
    // Named rather than counted. "One line failed" sends somebody hunting; the
    // name tells them which one to type in by hand.
    failed.length > 0 ? `${failed.join(", ")} could not be saved` : "",
  ].filter(Boolean);

  return { error: "", notice: `${parts.join(". ")}.`, savedId: documentId || "saved" };
}
