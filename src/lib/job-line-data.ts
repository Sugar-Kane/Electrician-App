import "server-only";

import { createClient } from "@/lib/supabase/server";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { currentContext } from "@/lib/request-context";
import { jobLineTotals, type JobLine, type JobLineTotals } from "@/lib/job-lines";

/**
 * The hours and parts on a job, read from the database.
 *
 * Kept apart from `job-data.ts` because that file maps rows into the
 * `PilotJob` shape the demo fixtures use, and lines have no fixture — they are
 * either real or absent. A signed-out visitor looking at the marketing view
 * gets no lines rather than somebody else's parts list.
 */

export type JobLinesResult = {
  /** Null when the job cannot be resolved for this viewer. */
  jobId: string | null;
  lines: JobLine[];
  totals: JobLineTotals;
};

const EMPTY: JobLinesResult = {
  jobId: null,
  lines: [],
  totals: { labourCents: 0, materialCents: 0, subtotalCents: 0, lineCount: 0 },
};

async function resolveContext() {
  const context = await currentContext();
  if (!context) return null;

  return {
    database: asFlexibleClient(await createClient()),
    organizationId: context.organizationId,
  };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  // Postgres numeric arrives as a string over PostgREST, so `quantity` is
  // "1.500" rather than 1.5 and arithmetic on it would concatenate.
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The database id behind a job number.
 *
 * Pages link by `job_number`, which is per-organization and human-facing.
 * Everything that writes needs the uuid, and looking it up through the caller's
 * own client means RLS decides whether this job is theirs to see at all.
 */
export async function resolveJobId(jobNumber: string): Promise<string | null> {
  const context = await resolveContext();
  if (!context) return null;

  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return null;

  const { data } = await context.database
    .from("jobs")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  return str((data as Record<string, unknown> | null)?.id) || null;
}

export async function getJobLines(jobNumber: string): Promise<JobLinesResult> {
  const context = await resolveContext();
  if (!context) return EMPTY;

  const jobId = await resolveJobId(jobNumber);
  if (!jobId) return EMPTY;

  const { data, error } = await context.database
    .from("job_line_items")
    .select("id, kind, description, quantity, unit, unit_price_cents, inventory_item_id, notes")
    .eq("organization_id", context.organizationId)
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });

  // A job with no lines has no lines. Returning the job id regardless means the
  // add form still works on a job nobody has priced yet, which is every job the
  // first time somebody opens it.
  if (error) return { ...EMPTY, jobId };

  const lines: JobLine[] = (data ?? []).map((row: Record<string, unknown>) => ({
    id: str(row.id),
    kind: row.kind === "labour" ? "labour" : "material",
    description: str(row.description),
    quantity: num(row.quantity),
    unit: str(row.unit) || "each",
    unitPriceCents: num(row.unit_price_cents),
    inventoryItemId: str(row.inventory_item_id) || null,
    notes: str(row.notes),
  }));

  return { jobId, lines, totals: jobLineTotals(lines) };
}

export type StockOption = {
  id: string;
  name: string;
  unit: string;
  unitPriceCents: number;
  quantityOnHand: number;
  location: string;
};

/**
 * What the business already owns, for the material picker.
 *
 * Ordered by name rather than by quantity: somebody adding a part is looking
 * for a name they already have in mind, not browsing what they have most of.
 */
export async function getStockOptions(): Promise<StockOption[]> {
  const context = await resolveContext();
  if (!context) return [];

  const { data, error } = await context.database
    .from("inventory_items")
    .select("id, name, unit, unit_cost_cents, quantity_on_hand, location")
    .eq("organization_id", context.organizationId)
    .is("archived_at", null)
    .order("name", { ascending: true })
    .limit(300);

  if (error) return [];

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: str(row.id),
    name: str(row.name),
    unit: str(row.unit) || "each",
    unitPriceCents: num(row.unit_cost_cents),
    quantityOnHand: num(row.quantity_on_hand),
    location: str(row.location),
  }));
}
