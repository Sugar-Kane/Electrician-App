"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { attachmentKind, refuseAttachment } from "@/lib/attachment-kinds";
import {
  adjustmentTo,
  isMovementReason,
  parseMovementQuantity,
  signedQuantity,
  type MovementReason,
} from "@/lib/inventory-movement";
import {
  DOCUMENTS_BUCKET,
  documentStoragePath,
  ensureDocumentsBucket,
} from "@/lib/document-storage";
import { parseCostToCents } from "@/lib/new-job-input";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * The stock list, edited by the person who owns it.
 *
 * Written through the caller's session so RLS decides whose stock this is. The
 * organization is read from the caller's membership and never taken from the
 * form — an item id is a uuid somebody could paste.
 *
 * Almost every field is optional. An electrician adding stock on a phone
 * between jobs types a name and a number; a form that demands a part number is
 * a form that does not get used, and an inventory nobody maintains is worse
 * than none because the materials list then lies about what is on the van.
 *
 * What is on hand is no longer one of those fields. It is the sum of
 * `inventory_movements`, kept in step by a trigger, so a quantity typed here
 * becomes a movement saying what changed and why. That is what makes the count
 * survive a busy fortnight, and what makes the year's material spend a sum
 * rather than a guess.
 */

export type InventoryState = {
  error: string;
  notice?: string;
  /**
   * The item a successful add just created.
   *
   * The form uses it to tell one save from the next, so "Add another" clears
   * the confirmation rather than showing it again — and so two parts with the
   * same name are still two saves.
   */
  savedId?: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/** Where a photo of a part is filed. */
const PHOTO_FOLDER = "inventory";

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

export async function saveInventoryItem(
  _previous: InventoryState,
  formData: FormData,
): Promise<InventoryState> {
  const id = field(formData, "id");
  const name = field(formData, "name");
  if (!name) return { error: "An item needs a name." };

  const quantityRaw = field(formData, "quantity");
  // Blank is "do not touch the count", which is what editing a part number
  // without recounting the shelf means. Zero is a real answer and says so.
  const counted = quantityRaw === "" ? null : Number(quantityRaw.replace(/,/g, ""));
  if (counted !== null && (!Number.isFinite(counted) || counted < 0)) {
    return { error: "The quantity has to be a number, and not negative." };
  }

  const costRaw = field(formData, "unitCost");
  const unitCostCents = parseCostToCents(costRaw);
  if (unitCostCents === null) {
    return { error: "That cost could not be read. Try a figure like 59.98." };
  }

  const context = await callerContext();
  if (!context) return { error: "You are not a member of a business." };
  const { supabase, organizationId } = context;

  const details = {
    organization_id: organizationId,
    name,
    sku: field(formData, "partNumber") || null,
    unit: field(formData, "unit") || "each",
    supplier: field(formData, "supplier") || null,
    unit_cost_cents: costRaw ? unitCostCents : 0,
    location: field(formData, "location") || null,
    notes: field(formData, "notes") || null,
    // Empty means "leave the photo alone"; the upload sets it separately.
    ...(field(formData, "photoPath") ? { photo_path: field(formData, "photoPath") } : {}),
  };

  if (id) {
    const { data: existing } = await supabase
      .from("inventory_items")
      .select("quantity_on_hand")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!existing) return { error: "That item could not be found." };

    const { error } = await supabase
      .from("inventory_items")
      // Deliberately not `quantity_on_hand`. The trigger owns that column, and
      // writing it here would be overwritten by the next movement anyway.
      .update(details)
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (error) {
      console.error("stock: the item could not be updated", error);
      return { error: "That item could not be saved." };
    }

    /*
     * A recount, not a replacement.
     *
     * Somebody editing an item types what they counted. The difference between
     * that and what the ledger says is the adjustment, and a count that agrees
     * writes no row at all.
     */
    if (counted !== null) {
      const onHandNow = Number(existing.quantity_on_hand ?? 0);
      const change = adjustmentTo(counted, onHandNow);
      if (change !== null) {
        await supabase.from("inventory_movements").insert({
          organization_id: organizationId,
          item_id: id,
          quantity: change,
          reason: "stock_take",
          unit_cost_cents: costRaw ? unitCostCents : 0,
          note: "Counted while editing the item.",
          created_by: context.userId || null,
        });
      }
    }

    revalidatePath("/inventory");
    revalidatePath(`/inventory/${id}`);
    revalidatePath("/materials");
    return { error: "", notice: `${name} updated.` };
  }

  const { data: created, error } = await supabase
    .from("inventory_items")
    // Zero, and then the opening movement below decides. Setting it here would
    // be a number the trigger immediately disagrees with.
    .insert({ ...details, quantity_on_hand: 0, created_by: context.userId || null })
    .select("id")
    .maybeSingle();

  const newId = text(created?.id);
  if (error || !newId) {
    console.error("stock: the item could not be created", error);
    return { error: "That item could not be saved." };
  }

  if (counted && counted > 0) {
    await supabase.from("inventory_movements").insert({
      organization_id: organizationId,
      item_id: newId,
      quantity: counted,
      reason: "opening",
      unit_cost_cents: costRaw ? unitCostCents : 0,
      note: "What was on the shelf when this item was added.",
      created_by: context.userId || null,
    });
  }

  revalidatePath("/inventory");
  revalidatePath("/materials");
  return { error: "", notice: `${name} added to stock.`, savedId: newId };
}

/**
 * Stock in or out, said out loud.
 *
 * The only way a count changes besides a job using something. Every call writes
 * a row rather than setting a number, so "where did the other four go" always
 * has an answer.
 */
export async function adjustStock(
  _previous: InventoryState,
  formData: FormData,
): Promise<InventoryState> {
  const id = field(formData, "id");
  if (!id) return { error: "That item could not be found." };

  const reasonRaw = field(formData, "reason");
  if (!isMovementReason(reasonRaw) || reasonRaw === "opening" || reasonRaw === "used_on_job") {
    // Both of those belong to something else: one to creating the item, the
    // other to a job line. Neither is a thing to pick from a menu.
    return { error: "Say what happened to it." };
  }
  const reason = reasonRaw as MovementReason;

  const typed = parseMovementQuantity(field(formData, "quantity"));
  if (typed === null) {
    return { error: "How many? A number like 3 or 0.5 works, and not zero." };
  }

  const context = await callerContext();
  if (!context) return { error: "You are not a member of a business." };
  const { supabase, organizationId } = context;

  const { data: item } = await supabase
    .from("inventory_items")
    .select("name, unit_cost_cents")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!item) return { error: "That item could not be found." };

  const quantity = signedQuantity(reason, typed);

  const { error } = await supabase.from("inventory_movements").insert({
    organization_id: organizationId,
    item_id: id,
    quantity,
    reason,
    unit_cost_cents: Number(item.unit_cost_cents ?? 0),
    note: field(formData, "note") || null,
    created_by: context.userId || null,
  });

  if (error) {
    console.error("stock: the movement could not be recorded", error);
    return { error: "That change could not be recorded." };
  }

  revalidatePath("/inventory");
  revalidatePath(`/inventory/${id}`);
  revalidatePath("/materials");

  const moved = Math.abs(quantity);
  return {
    error: "",
    notice: quantity > 0 ? `${moved} added.` : `${moved} taken out.`,
  };
}

export async function removeInventoryItem(
  _previous: InventoryState,
  formData: FormData,
): Promise<InventoryState> {
  const id = field(formData, "id");
  if (!id) return { error: "That item could not be found." };

  const context = await callerContext();
  if (!context) return { error: "You are not a member of a business." };

  // Archived rather than deleted. A part removed by a mistyped tap is
  // recoverable; a row that no longer exists is not, and stock lists are edited
  // one-handed in a van.
  const { error } = await context.supabase
    .from("inventory_items")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", context.organizationId);

  if (error) return { error: "That item could not be removed." };

  revalidatePath("/inventory");
  revalidatePath("/materials");
  return { error: "", notice: "Removed from stock." };
}

export type PhotoTicket =
  | { ok: true; path: string; token: string; bucket: string }
  | { ok: false; error: string };

/**
 * Permission to put one photo of one part in one place.
 *
 * The same three steps as job photos and assistant attachments, for the same
 * reason: a Server Action's request body is capped around a megabyte by the
 * framework, and a photo off a phone is three to five. The file goes from the
 * browser straight to storage; the server decides where it is allowed to land
 * and writes the row pointing at it.
 */
export async function createStockPhotoUpload(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<PhotoTicket> {
  const refusal = refuseAttachment(input);
  if (refusal) return { ok: false, error: refusal };

  const kind = attachmentKind(input.mimeType, input.fileName);
  // Only a picture. A PDF of a spec sheet is a document, not what the part
  // looks like on the shelf.
  if (!kind || kind.reading === "document") {
    return { ok: false, error: "That needs to be a photo." };
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
    PHOTO_FOLDER,
    `${randomUUID()}.${kind.extension}`,
  );

  const signed = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data?.token) {
    console.error("stock photo: could not sign an upload", signed.error);
    return { ok: false, error: "That photo could not be started. Try again." };
  }

  return { ok: true, path, token: signed.data.token, bucket: DOCUMENTS_BUCKET };
}

/**
 * Point an item at the photo that has just landed.
 *
 * The path is checked twice over rather than trusted: it has to sit under this
 * caller's organization, and the object has to actually be there.
 */
export async function attachStockPhoto(input: {
  itemId: string;
  path: string;
}): Promise<InventoryState> {
  const context = await callerContext();
  if (!context) return { error: "You are not a member of a business." };

  const expectedPrefix = documentStoragePath(context.organizationId, PHOTO_FOLDER, "");
  if (!input.path || !input.path.startsWith(expectedPrefix)) {
    return { error: "That photo could not be attached." };
  }

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return { error: "File storage is not set up yet." };
  }

  // Signing an object that is not there fails, which is the cheapest way to ask
  // "did the upload actually finish".
  const exists = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUrl(input.path, 60);
  if (exists.error) return { error: "That photo did not finish uploading. Try again." };

  const { error } = await context.supabase
    .from("inventory_items")
    .update({ photo_path: input.path })
    .eq("id", input.itemId)
    .eq("organization_id", context.organizationId);

  if (error) {
    // Nothing points at the object. Left alone it is stranded.
    await admin.storage.from(DOCUMENTS_BUCKET).remove([input.path]);
    console.error("stock photo: could not record the path", error);
    return { error: "That photo could not be attached." };
  }

  revalidatePath("/inventory");
  revalidatePath(`/inventory/${input.itemId}`);
  return { error: "", notice: "Photo saved." };
}
