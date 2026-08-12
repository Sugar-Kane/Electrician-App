"use server";

import { revalidatePath } from "next/cache";

import { parseCostToCents } from "@/lib/new-job-input";
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
 */

export type InventoryState = { error: string; notice?: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function organizationFor(supabase: ReturnType<typeof asFlexibleClient>) {
  const { data } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();
  return text(data?.organization_id);
}

function readQuantity(raw: string): number | null {
  if (!raw) return 0;
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value) || value < 0) return null;
  // Two decimals, matching the column. Wire is counted in feet and half-feet;
  // nobody stocks a thousandth of anything.
  return Math.round(value * 100) / 100;
}

export async function saveInventoryItem(
  _previous: InventoryState,
  formData: FormData,
): Promise<InventoryState> {
  const id = field(formData, "id");
  const name = field(formData, "name");
  if (!name) return { error: "An item needs a name." };

  const quantity = readQuantity(field(formData, "quantity"));
  if (quantity === null) return { error: "The quantity has to be a number, and not negative." };

  const costRaw = field(formData, "unitCost");
  const unitCostCents = parseCostToCents(costRaw);
  if (unitCostCents === null) {
    return { error: "That cost could not be read. Try a figure like 59.98." };
  }

  const supabase = asFlexibleClient(await createClient());
  const organizationId = await organizationFor(supabase);
  if (!organizationId) return { error: "You are not a member of a business." };

  const row = {
    organization_id: organizationId,
    name,
    sku: field(formData, "partNumber") || null,
    quantity_on_hand: quantity,
    unit: field(formData, "unit") || "each",
    supplier: field(formData, "supplier") || null,
    unit_cost_cents: costRaw ? unitCostCents : 0,
    location: field(formData, "location") || null,
    notes: field(formData, "notes") || null,
    photo_url: field(formData, "photoUrl") || null,
  };

  const { error } = id
    ? await supabase
        .from("inventory_items")
        .update(row)
        .eq("id", id)
        .eq("organization_id", organizationId)
    : await supabase.from("inventory_items").insert(row);

  if (error) return { error: "That item could not be saved." };

  revalidatePath("/inventory");
  revalidatePath("/materials");
  return { error: "", notice: id ? `${name} updated.` : `${name} added to stock.` };
}

export async function removeInventoryItem(
  _previous: InventoryState,
  formData: FormData,
): Promise<InventoryState> {
  const id = field(formData, "id");
  if (!id) return { error: "That item could not be found." };

  const supabase = asFlexibleClient(await createClient());
  const organizationId = await organizationFor(supabase);
  if (!organizationId) return { error: "You are not a member of a business." };

  // Archived rather than deleted. A part removed by a mistyped tap is
  // recoverable; a row that no longer exists is not, and stock lists are edited
  // one-handed in a van.
  const { error } = await supabase
    .from("inventory_items")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", organizationId);

  if (error) return { error: "That item could not be removed." };

  revalidatePath("/inventory");
  revalidatePath("/materials");
  return { error: "", notice: "Removed from stock." };
}
