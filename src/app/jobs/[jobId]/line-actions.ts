"use server";

import { revalidatePath } from "next/cache";

import { formatMoney } from "@/lib/invoice-messages";
import { invoiceIsLive, invoiceIsOpenDraft, lineLockedBecause } from "@/lib/job-billing";
import {
  jobInvoices,
  rebuildInvoiceDocument,
  retotalInvoice,
  returnStock,
  takeFromStock,
} from "@/lib/job-billing-server";
import { lineTotalCents, parseQuantity, readPrice } from "@/lib/job-lines";
import { PACK_CONTENTS, PACK_UNITS, PART_UNITS } from "@/lib/stock-reservation";
import { asFlexibleClient } from "@/lib/supabase/flexible";
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

  const { data: auth } = await supabase.auth.getUser();
  return { supabase, organizationId, userId: auth.user?.id ?? "" };
}

async function findJob(jobNumber: string) {
  const context = await callerContext();
  if (!context) return null;

  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return null;

  const { data } = await context.supabase
    .from("jobs")
    .select("id, status, diagnostic_paid, diagnostic_fee_cents, follow_up_of")
    .eq("organization_id", context.organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  const id = typeof data?.id === "string" ? data.id : "";
  if (!id) return null;

  return {
    ...context,
    jobId: id,
    status: typeof data?.status === "string" ? data.status : "",
    // What a draft invoice's recount needs to give the diagnostic credit once.
    billedJob: {
      id,
      followUpOf: typeof data?.follow_up_of === "string" ? data.follow_up_of : null,
      diagnosticPaid: data?.diagnostic_paid === true,
      diagnosticFeeCents: Number(data?.diagnostic_fee_cents ?? 0),
    },
  };
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

  /*
   * Blank and zero are different answers. A customer price left blank is
   * refused rather than billed as nothing — "0" is how somebody says there is
   * no charge. A cost left blank is recorded as unknown, not as free.
   */
  const price = readPrice(text(formData, "unitPrice"));
  if (price.state === "missing") {
    return {
      error:
        kind === "labor"
          ? "Enter the customer rate. Type 0 if there is no charge."
          : "Enter the customer price each. Type 0 if there is no charge.",
    };
  }
  if (price.state === "invalid") {
    return { error: "That price could not be read. Something like 59.99 works." };
  }
  const unitPriceCents = price.cents;

  const cost = kind === "material" ? readPrice(text(formData, "unitCost")) : ({ state: "missing" } as const);
  if (cost.state === "invalid") {
    return { error: "Your cost could not be read. Something like 4.20 works, or leave it blank." };
  }

  // Labor is hours. A part is counted in one of the trade's units, or in the
  // stock item's own unit when it was picked from stock.
  const typedUnit = text(formData, "unit");
  const unit =
    kind === "labor"
      ? "hr"
      : (PART_UNITS as readonly string[]).includes(typedUnit) || (typedUnit && text(formData, "inventoryItemId"))
        ? typedUnit
        : "each";

  // What one box, roll or stick holds, when somebody said. Only kept when the
  // unit is a pack and both halves are there: half a conversion is a guess.
  const packSize = parseQuantity(text(formData, "packSize"));
  const packUnit = text(formData, "packUnit");
  const packed =
    PACK_UNITS.has(unit) && packSize !== null && packSize > 0 && (PACK_CONTENTS as readonly string[]).includes(packUnit);

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
      unit,
      unit_price_cents: unitPriceCents,
      unit_cost_cents: cost.state === "set" ? cost.cents : null,
      pack_size: packed ? packSize : null,
      pack_unit: packed ? packUnit : null,
      // Only when it came from the stock list. A part typed by hand has no
      // inventory row, and inventing a link would let a later change to that
      // stock item rewrite what this job was charged.
      inventory_item_id: inventoryItemId || null,
    })
    .select("id")
    .maybeSingle();

  if (error || !created) return { error: "That line could not be saved." };

  // A part added after the materials were marked ready has not been gathered.
  if (kind === "material") {
    await context.supabase
      .from("jobs")
      .update({ materials_ready_at: null })
      .eq("id", context.jobId)
      .not("materials_ready_at", "is", null);
  }

  /*
   * A part on a job that is still open is reserved, not taken.
   *
   * It stays on the van and in the count, held for this job, and comes off
   * when the job is finished and somebody says how many were used. Taking it
   * now — what this used to do — emptied the shelf for quotes nobody accepted.
   *
   * A part written onto a job that is already finished was used: there is no
   * later moment for it to come off, so it comes off now. A line typed by hand
   * has no `inventory_item_id` and moves nothing — it was bought for the job.
   *
   * Deliberately not fatal. The line is what the electrician asked for, and
   * losing it to a bookkeeping row would be a poor trade — but the failure is
   * said out loud, because a count that quietly stops moving is worse than one
   * that never moved.
   */
  if (inventoryItemId && context.status === "completed") {
    const moved = await takeFromStock(context.supabase, {
      organizationId: context.organizationId,
      jobId: context.jobId,
      lines: [
        {
          lineId: String(created.id),
          itemId: inventoryItemId,
          quantity,
          unit,
          packSize: packed ? packSize : null,
          packUnit: packed ? packUnit : null,
        },
      ],
    });
    if (!moved) console.error("job line: stock was not deducted", { lineId: created.id });
    revalidatePath(`/jobs/${jobNumber}`);
    revalidatePath("/inventory");
    revalidatePath("/materials");
    return { error: "", notice: "Added, and taken from stock: this job is finished." };
  }

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath("/inventory");
  revalidatePath("/materials");
  return { error: "", notice: inventoryItemId ? "Added and reserved for this job." : "Added." };
}

/**
 * One item from the materials list: the customer's price, and what one cost
 * the business at the store it was priced from (blank when it was not).
 */
export type ListedPart = {
  itemId: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  unitCost?: string;
};

/**
 * Items chosen from the job's materials list, added as parts in one go.
 *
 * Each needs a customer price, as a part typed in by hand does: blank is
 * refused, 0 is no charge. A store price, when there is one, is kept as what
 * the part cost; blank leaves the cost unknown. All or none: one unreadable
 * figure stops the batch and says which item, rather than adding half the
 * list.
 */
export async function addListedParts(
  jobNumber: string,
  parts: ListedPart[],
): Promise<LineActionState & { added?: string[] }> {
  if (!Array.isArray(parts) || parts.length === 0) return { error: "Choose at least one item." };
  if (parts.length > 60) return { error: "Add up to 60 items at a time." };

  const rows: Record<string, unknown>[] = [];
  for (const part of parts) {
    const description = String(part?.description ?? "").trim().slice(0, 300);
    if (!description) return { error: "Every item needs a description." };
    const quantity = parseQuantity(String(part?.quantity ?? "") || "1");
    if (quantity === null) return { error: `The quantity for "${description}" could not be read.` };
    const price = readPrice(String(part?.unitPrice ?? ""));
    if (price.state === "missing") return { error: `Enter a price each for "${description}". Type 0 if there is no charge.` };
    if (price.state === "invalid") return { error: `The price for "${description}" could not be read. Something like 12.50 works.` };
    const cost = readPrice(String(part?.unitCost ?? ""));
    if (cost.state === "invalid") return { error: `The store cost for "${description}" could not be read.` };
    const unit = (PART_UNITS as readonly string[]).includes(String(part?.unit)) ? String(part.unit) : "each";
    rows.push({
      kind: "material",
      description,
      quantity,
      unit,
      unit_price_cents: price.cents,
      unit_cost_cents: cost.state === "set" ? cost.cents : null,
    });
  }

  const context = await findJob(jobNumber);
  if (!context) return { error: "That job could not be found." };

  const { error } = await context.supabase
    .from("job_line_items")
    .insert(rows.map((row) => ({ ...row, organization_id: context.organizationId, job_id: context.jobId })));
  if (error) return { error: "Those items could not be added. Try again." };

  // New parts have not been gathered, as with a part added by hand.
  await context.supabase
    .from("jobs")
    .update({ materials_ready_at: null })
    .eq("id", context.jobId)
    .not("materials_ready_at", "is", null);

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath("/jobs");
  return {
    error: "",
    notice: `${rows.length} ${rows.length === 1 ? "item" : "items"} added to the estimate.`,
    added: parts.map((part) => String(part.itemId ?? "")),
  };
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

  // Scoped to the job as well as the id, so a stale form from another job
  // cannot reach a line by guessing a uuid.
  const { data: found } = await context.supabase
    .from("job_line_items")
    .select("id, invoice_id, quantity, unit_price_cents")
    .eq("id", lineId)
    .eq("job_id", context.jobId)
    .eq("organization_id", context.organizationId)
    .maybeSingle();

  if (!found) return { error: "That line could not be found." };
  const line = found as Record<string, unknown>;
  const invoiceId = typeof line.invoice_id === "string" ? line.invoice_id : null;

  /*
   * A line on an invoice the customer has been sent, or has paid, is part of
   * that bill. Taking it off the job would leave the invoice charging for a
   * line that no longer exists, and the next copy of its PDF printing a
   * different bill from the one in their hands.
   */
  const invoices = invoiceId ? await jobInvoices(context.supabase, context.organizationId, context.jobId) : [];
  const locked = lineLockedBecause({ invoiceId }, invoices);
  if (locked) return { error: locked };

  /*
   * Put the parts back before the line goes: the movement names the line it
   * returns, and a line that is already gone cannot be named. If the delete
   * then fails, asking again finds nothing more owed rather than returning the
   * same parts twice.
   */
  await returnStock(context.supabase, {
    organizationId: context.organizationId,
    jobId: context.jobId,
    lineIds: [lineId],
    note: "The job line it was used on was removed.",
  });

  const { error } = await context.supabase
    .from("job_line_items")
    .delete()
    .eq("id", lineId)
    .eq("job_id", context.jobId)
    .eq("organization_id", context.organizationId);

  if (error) return { error: "That line could not be removed." };

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath("/inventory");
  revalidatePath("/materials");

  // On a draft nobody has seen, the draft follows: its total comes down by
  // what the line came to, and its PDF is laid out again without it.
  const draft = invoices.find((invoice) => invoice.id === invoiceId);
  if (!draft || !invoiceIsLive(draft) || !invoiceIsOpenDraft(draft)) {
    return { error: "", notice: "Removed." };
  }

  const recounted = await retotalInvoice(context.supabase, {
    organizationId: context.organizationId,
    invoice: draft,
    job: context.billedJob,
    subtotalCents:
      draft.subtotalCents -
      lineTotalCents({ quantity: Number(line.quantity ?? 0), unitPriceCents: Number(line.unit_price_cents ?? 0) }),
  });

  revalidatePath("/invoices");
  if (!recounted) {
    return {
      error: `Removed, but INV-${draft.number}'s total could not be updated. Open the invoice before sending it.`,
    };
  }

  await rebuildInvoiceDocument(context.supabase, {
    organizationId: context.organizationId,
    invoiceId: draft.id,
    uploadedBy: context.userId,
  });

  return {
    error: "",
    notice: `Removed. INV-${draft.number} now comes to ${formatMoney(recounted.totalCents / 100)}.`,
  };
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
