"use server";

import { revalidatePath } from "next/cache";

import { parsePriceCents, parseQuantity } from "@/lib/job-lines";
import { asFlexibleClient, type FlexibleSupabaseClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Adding and removing what a job is made of, and what the technician wrote.
 *
 * Everything here goes through the caller's own session, so RLS decides whether
 * the job is theirs. The job number in the form is a lookup key, never an
 * authorisation — a number typed by hand reaches somebody else's job only if
 * the policies let it, and they do not.
 */

export type LineActionState = { error: string; notice?: string };

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** The organization the caller belongs to, and a client scoped to their session. */
async function callerContext() {
  const supabase = asFlexibleClient(await createClient());

  const { data } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId =
    typeof data?.organization_id === "string" ? data.organization_id : "";
  if (!organizationId) return null;

  return { supabase, organizationId };
}

async function findJob(jobNumber: string) {
  const context = await callerContext();
  if (!context) return null;

  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return null;

  const { data } = await context.supabase
    .from("jobs")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  const id = typeof data?.id === "string" ? data.id : "";
  if (!id) return null;

  return { ...context, jobId: id };
}

export async function addJobLine(
  _previous: LineActionState,
  formData: FormData,
): Promise<LineActionState> {
  const jobNumber = text(formData, "jobNumber");
  const kind = text(formData, "kind") === "labor" ? "labor" : "material";
  const description = text(formData, "description");

  if (!description) {
    return { error: kind === "labor" ? "What was the work?" : "What is the part?" };
  }

  // Refused rather than guessed. A quantity that silently becomes zero is a
  // line that bills nothing, and nobody re-reads a total they expected.
  const quantity = parseQuantity(text(formData, "quantity") || "1");
  if (quantity === null) {
    return { error: "That quantity could not be read. A number like 2 or 1.5 works." };
  }

  const unitPriceCents = parsePriceCents(text(formData, "unitPrice") || "0");
  if (unitPriceCents === null) {
    return { error: "That price could not be read. Something like 59.99 works." };
  }

  const context = await findJob(jobNumber);
  if (!context) return { error: "That job could not be found." };

  const inventoryItemId = text(formData, "inventoryItemId");

  const { data: created, error } = await context.supabase
    .from("job_line_items")
    .insert({
      organization_id: context.organizationId,
      job_id: context.jobId,
      kind,
      description,
      quantity,
      unit: text(formData, "unit") || (kind === "labor" ? "hr" : "each"),
      unit_price_cents: unitPriceCents,
      // Only when it came from the stock list. A part typed by hand has no
      // inventory row, and inventing a link would let a later change to that
      // stock item rewrite what this job was charged.
      inventory_item_id: inventoryItemId || null,
    })
    .select("id")
    .maybeSingle();

  if (error || !created) return { error: "That line could not be saved." };

  /*
   * The part left the van when it was written down.
   *
   * Not at completion: the count has to be true for the rest of the day, or
   * the next job's materials list says there are three breakers on the shelf
   * that are already in somebody's wall. Nobody deducts by hand — that is the
   * habit that makes a stock list stop being true within a fortnight.
   *
   * A line typed by hand has no `inventory_item_id` and moves nothing, which is
   * right: it was bought for this job, not taken from stock.
   *
   * Deliberately not fatal. The line is what the electrician asked for, and
   * losing it to a bookkeeping row would be a poor trade — but the failure is
   * said out loud, because a count that quietly stops moving is worse than one
   * that never moved.
   */
  if (inventoryItemId) {
    const moved = await recordStockUse({
      supabase: context.supabase,
      organizationId: context.organizationId,
      jobId: context.jobId,
      lineId: String(created.id),
      itemId: inventoryItemId,
      quantity,
    });
    if (!moved) console.error("job line: stock was not deducted", { lineId: created.id });
  }

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath("/inventory");
  revalidatePath("/materials");
  return { error: "", notice: "Added." };
}

/**
 * Taking the parts off the shelf.
 *
 * The cost is read off the item now and written onto the movement, because what
 * a breaker cost the day it was fitted is the expense — not what the same
 * breaker costs when somebody runs a report in April.
 */
async function recordStockUse(input: {
  supabase: FlexibleSupabaseClient;
  organizationId: string;
  jobId: string;
  lineId: string;
  itemId: string;
  quantity: number;
}): Promise<boolean> {
  const { data: item } = await input.supabase
    .from("inventory_items")
    .select("unit_cost_cents")
    .eq("id", input.itemId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  // An item id that is not this organization's is not an item. Nothing moves.
  if (!item) return false;

  const { error } = await input.supabase.from("inventory_movements").insert({
    organization_id: input.organizationId,
    item_id: input.itemId,
    quantity: -Math.abs(input.quantity),
    reason: "used_on_job",
    job_id: input.jobId,
    job_line_item_id: input.lineId,
    unit_cost_cents: Number(item.unit_cost_cents ?? 0),
  });

  return !error;
}

export async function removeJobLine(
  _previous: LineActionState,
  formData: FormData,
): Promise<LineActionState> {
  const jobNumber = text(formData, "jobNumber");
  const lineId = text(formData, "lineId");
  if (!lineId) return { error: "That line could not be found." };

  const context = await findJob(jobNumber);
  if (!context) return { error: "That job could not be found." };

  /*
   * What this line took off the shelf, before the line goes.
   *
   * `job_line_item_id` is `on delete set null`, so the movement survives the
   * line and would otherwise leave the stock permanently short by a part that
   * was never used.
   */
  const { data: used } = await context.supabase
    .from("inventory_movements")
    .select("item_id, quantity, unit_cost_cents")
    .eq("job_line_item_id", lineId)
    .eq("organization_id", context.organizationId)
    .eq("reason", "used_on_job")
    .maybeSingle();

  // Scoped to the job as well as the id, so a stale form from another job
  // cannot delete a line by guessing a uuid.
  const { error } = await context.supabase
    .from("job_line_items")
    .delete()
    .eq("id", lineId)
    .eq("job_id", context.jobId)
    .eq("organization_id", context.organizationId);

  if (error) return { error: "That line could not be removed." };

  /*
   * Put the parts back, by writing the opposite movement.
   *
   * Not by deleting the original: a ledger is corrected by saying what happened
   * next, and "three breakers came back" is what happened. The history then
   * explains the count instead of quietly agreeing with it.
   */
  if (used?.item_id) {
    const { error: returnError } = await context.supabase.from("inventory_movements").insert({
      organization_id: context.organizationId,
      item_id: used.item_id,
      quantity: Math.abs(Number(used.quantity ?? 0)),
      reason: "returned",
      job_id: context.jobId,
      unit_cost_cents: Number(used.unit_cost_cents ?? 0),
      note: "The job line it was used on was removed.",
    });
    if (returnError) console.error("job line: stock was not returned", returnError);
  }

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath("/inventory");
  revalidatePath("/materials");
  return { error: "", notice: "Removed." };
}

/**
 * What the technician wrote on site.
 *
 * Separate from `customer_description`, which is the complaint, and from
 * `ai_summary`, which is a machine's reading of it. This one is never shown to
 * the customer, and the form says so.
 */
export async function saveTechnicianNotes(
  _previous: LineActionState,
  formData: FormData,
): Promise<LineActionState> {
  const jobNumber = text(formData, "jobNumber");
  const notes = String(formData.get("notes") ?? "").trim();

  if (notes.length > 5000) {
    return { error: "That is longer than the notes field holds. Trim it a little." };
  }

  const context = await findJob(jobNumber);
  if (!context) return { error: "That job could not be found." };

  const { error } = await context.supabase
    .from("jobs")
    .update({ technician_notes: notes || null })
    .eq("id", context.jobId)
    .eq("organization_id", context.organizationId);

  if (error) return { error: "Those notes could not be saved." };

  revalidatePath(`/jobs/${jobNumber}`);
  return { error: "", notice: "Saved." };
}
