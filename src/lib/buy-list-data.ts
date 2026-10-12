import "server-only";

import { isBuyStatus, type BuyItem } from "@/lib/buy-list";
import { normalizeName } from "@/lib/inventory-match";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * The buy list and the parts open jobs need, read through the caller's own
 * session so row security decides whose they are.
 */

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

async function resolve() {
  const context = await currentContext();
  if (!context) return null;
  return { ...context, database: asFlexibleClient(await createClient()) };
}

export async function getBuyList(): Promise<BuyItem[]> {
  const context = await resolve();
  if (!context) return [];

  const { data, error } = await context.database
    .from("buy_list_items")
    .select(
      "id, description, quantity, unit, status, order_reference, needed_by, job_id, supply_stop_id, job:jobs(job_number), stop:supply_stops(name)",
    )
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: true })
    .limit(300);

  if (error) {
    console.error("buy list: could not be read", error);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const job = (row.job ?? null) as Record<string, unknown> | null;
    const stop = (row.stop ?? null) as Record<string, unknown> | null;
    const status = str(row.status);
    return {
      id: str(row.id),
      description: str(row.description),
      quantity: num(row.quantity),
      unit: str(row.unit) || "each",
      status: isBuyStatus(status) ? status : "need_to_buy",
      orderReference: str(row.order_reference),
      neededBy: str(row.needed_by),
      jobId: str(row.job_id) || null,
      jobNumber: job?.job_number !== undefined && job?.job_number !== null ? String(job.job_number) : null,
      supplyStopId: str(row.supply_stop_id) || null,
      supplierName: str(stop?.name),
    };
  });
}

export type JobMaterialLine = {
  lineId: string;
  description: string;
  quantity: number;
  unit: string;
  /** Picked from stock, so it is reserved on the van rather than bought. */
  fromStock: boolean;
  /** Its buy-list line, when it has one. */
  bought: BuyItem | null;
};

export type JobMaterials = {
  jobId: string;
  jobNumber: string;
  customer: string;
  /** "Tue, Oct 13", or "" with no time. */
  whenLabel: string;
  lines: JobMaterialLine[];
};

/**
 * What each open job needs in parts, and where each is coming from: the van
 * (reserved from stock), the buy list (with its status), or nowhere yet.
 *
 * A part typed by hand and a buy-list line for the same job are matched by
 * name, normalised the way the stock search normalises it — the line added
 * from a job's part carries that part's name, so the two meet.
 */
export async function getJobMaterials(buyList: readonly BuyItem[]): Promise<JobMaterials[]> {
  const context = await resolve();
  if (!context) return [];

  const { data, error } = await context.database
    .from("job_line_items")
    .select(
      "id, description, quantity, unit, inventory_item_id, job_id, job:jobs!inner(job_number, status, scheduled_start, customer:customers(first_name, last_name, company_name))",
    )
    .eq("organization_id", context.organizationId)
    .eq("kind", "material")
    .not("job.status", "in", "(completed,canceled)")
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    console.error("materials: open jobs' parts could not be read", error);
    return [];
  }

  const jobs = new Map<string, JobMaterials & { startsAt: string }>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const job = (row.job ?? {}) as Record<string, unknown>;
    const customer = (job.customer ?? {}) as Record<string, unknown>;
    const jobId = str(row.job_id);
    const entry =
      jobs.get(jobId) ??
      {
        jobId,
        jobNumber: String(job.job_number ?? ""),
        customer:
          str(customer.company_name).trim() ||
          [str(customer.first_name), str(customer.last_name)].filter(Boolean).join(" ").trim() ||
          "Customer",
        startsAt: str(job.scheduled_start),
        whenLabel: str(job.scheduled_start)
          ? new Intl.DateTimeFormat("en-US", {
              timeZone: context.timeZone,
              weekday: "short",
              month: "short",
              day: "numeric",
            }).format(new Date(str(job.scheduled_start)))
          : "",
        lines: [],
      };

    const description = str(row.description);
    const name = normalizeName(description);
    entry.lines.push({
      lineId: str(row.id),
      description,
      quantity: num(row.quantity),
      unit: str(row.unit) || "each",
      fromStock: Boolean(str(row.inventory_item_id)),
      bought:
        buyList.find((item) => item.jobId === jobId && normalizeName(item.description) === name) ?? null,
    });
    jobs.set(jobId, entry);
  }

  // Soonest first; jobs with no time after the ones that have one.
  return [...jobs.values()]
    .sort((a, b) => (a.startsAt || "9999").localeCompare(b.startsAt || "9999"))
    .map(({ startsAt: _startsAt, ...rest }) => rest);
}
