"use server";

import { revalidatePath } from "next/cache";

import { isBuyStatus } from "@/lib/buy-list";
import { parseQuantity } from "@/lib/job-lines";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Adding to the buy list, moving a line along it, and clearing it.
 *
 * Written through the caller's session, so row security decides whose list
 * this is, and the table's own check refuses a job, stock item or supplier
 * that belongs to another business.
 */

export type BuyListState = { error: string; notice?: string };

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function callerContext() {
  const supabase = asFlexibleClient(await createClient());
  const { data } = await supabase.from("organization_members").select("organization_id").limit(1).maybeSingle();
  const organizationId = typeof data?.organization_id === "string" ? data.organization_id : "";
  if (!organizationId) return null;
  return { supabase, organizationId };
}

function refresh() {
  revalidatePath("/materials");
  revalidatePath("/route");
}

export async function addToBuyList(_previous: BuyListState, formData: FormData): Promise<BuyListState> {
  const description = field(formData, "description").slice(0, 200);
  if (!description) return { error: "What needs buying?" };

  const quantity = parseQuantity(field(formData, "quantity") || "1");
  if (quantity === null || quantity <= 0) return { error: "That quantity could not be read. A number like 2 or 100 works." };

  const unit = field(formData, "unit").slice(0, 24) || "each";
  const neededBy = field(formData, "neededBy");
  if (neededBy && !/^\d{4}-\d{2}-\d{2}$/.test(neededBy)) return { error: "That date could not be read." };

  const context = await callerContext();
  if (!context) return { error: "You are not a member of a business." };

  // The job is chosen by its number, the way people say it; the id is looked
  // up through the caller's own session, so only their own jobs are found.
  const jobNumber = field(formData, "jobNumber");
  let jobId: string | null = null;
  if (jobNumber) {
    const { data: job } = await context.supabase
      .from("jobs")
      .select("id")
      .eq("organization_id", context.organizationId)
      .eq("job_number", Number(jobNumber))
      .maybeSingle();
    jobId = typeof job?.id === "string" ? job.id : null;
    if (!jobId) return { error: `Job #${jobNumber} could not be found.` };
  }

  const supplyStopId = field(formData, "supplyStopId") || null;
  const inventoryItemId = field(formData, "inventoryItemId") || null;

  const { error } = await context.supabase.from("buy_list_items").insert({
    organization_id: context.organizationId,
    description,
    quantity: Math.round(quantity * 100) / 100,
    unit,
    job_id: jobId,
    supply_stop_id: supplyStopId,
    inventory_item_id: inventoryItemId,
    needed_by: neededBy || null,
  });

  if (error) {
    console.error("buy list: could not add", error);
    return { error: "That could not be added to the buy list. Try again." };
  }

  refresh();
  if (jobNumber) revalidatePath(`/jobs/${jobNumber}`);
  return { error: "", notice: `Added to the buy list${jobNumber ? ` for job #${jobNumber}` : ""}.` };
}

/** Moving a line along: need to buy → ordered → ready for pickup → picked up. */
export async function updateBuyItem(_previous: BuyListState, formData: FormData): Promise<BuyListState> {
  const id = field(formData, "id");
  const status = field(formData, "status");
  if (!id) return { error: "That line could not be found." };
  if (!isBuyStatus(status)) return { error: "That is not a status a buy-list line can have." };

  const context = await callerContext();
  if (!context) return { error: "You are not a member of a business." };

  const patch: Record<string, unknown> = { status };
  if (formData.has("orderReference")) patch.order_reference = field(formData, "orderReference").slice(0, 80) || null;
  if (formData.has("supplyStopId")) patch.supply_stop_id = field(formData, "supplyStopId") || null;

  const { data, error } = await context.supabase
    .from("buy_list_items")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", context.organizationId)
    .select("id");

  if (error || !Array.isArray(data) || data.length === 0) {
    return { error: "That line could not be changed. Reload and try again." };
  }

  refresh();
  return { error: "", notice: "Saved." };
}

export async function removeBuyItem(_previous: BuyListState, formData: FormData): Promise<BuyListState> {
  const id = field(formData, "id");
  if (!id) return { error: "That line could not be found." };

  const context = await callerContext();
  if (!context) return { error: "You are not a member of a business." };

  const { error } = await context.supabase
    .from("buy_list_items")
    .delete()
    .eq("id", id)
    .eq("organization_id", context.organizationId);

  if (error) return { error: "That line could not be removed." };
  refresh();
  return { error: "", notice: "Removed." };
}
