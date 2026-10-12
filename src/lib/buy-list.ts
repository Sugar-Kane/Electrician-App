/**
 * The buy list: parts to get, for a job or for the van.
 *
 * Every status is set by a person — nothing here talks to a store, so nothing
 * here can say a store has a part, has reserved it, or what it costs. "Ready
 * for pickup" is what somebody was told, written down; it is not a promise
 * this app makes.
 *
 * Import-free, so the page, the route and anything else read it the same way.
 */

export const BUY_STATUSES = [
  { value: "need_to_buy", label: "Need to buy" },
  { value: "ordered", label: "Ordered" },
  { value: "ready_for_pickup", label: "Ready for pickup" },
  { value: "picked_up", label: "Picked up" },
] as const;

export type BuyStatus = (typeof BUY_STATUSES)[number]["value"];

export function isBuyStatus(value: string): value is BuyStatus {
  return BUY_STATUSES.some((status) => status.value === value);
}

export function buyStatusLabel(status: string): string {
  return BUY_STATUSES.find((entry) => entry.value === status)?.label ?? "Need to buy";
}

export type BuyItem = {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  status: BuyStatus;
  orderReference: string;
  /** YYYY-MM-DD, or "". */
  neededBy: string;
  jobId: string | null;
  jobNumber: string | null;
  supplyStopId: string | null;
  /** The supply stop's name, or "" when no supplier has been chosen. */
  supplierName: string;
};

/** Still to collect: everything not yet picked up. */
export function stillToGet(item: Pick<BuyItem, "status">): boolean {
  return item.status !== "picked_up";
}

/**
 * The list as it is shopped: one group per supplier, the ones with no supplier
 * yet last, and within each group what is ready to collect first.
 */
export function groupBySupplier(items: readonly BuyItem[]): { supplierName: string; supplyStopId: string | null; items: BuyItem[] }[] {
  const order: BuyStatus[] = ["ready_for_pickup", "ordered", "need_to_buy", "picked_up"];
  const groups = new Map<string, { supplierName: string; supplyStopId: string | null; items: BuyItem[] }>();
  for (const item of items) {
    const key = item.supplyStopId ?? "";
    const group = groups.get(key) ?? { supplierName: item.supplierName || "No supplier chosen", supplyStopId: item.supplyStopId, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.items.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.supplyStopId !== !b.supplyStopId) return a.supplyStopId ? -1 : 1;
    return a.supplierName.localeCompare(b.supplierName);
  });
}

/**
 * What the day's route has to collect: the open buy-list items for that day's
 * jobs, by job number. A supply stop is only worth a detour when this is not
 * empty.
 */
export function pickupsFor(items: readonly BuyItem[], jobNumbers: ReadonlySet<string>): BuyItem[] {
  return items.filter((item) => stillToGet(item) && item.jobNumber !== null && jobNumbers.has(item.jobNumber));
}

/** "2 items for job #12, 1 for job #14". */
export function pickupSummary(items: readonly BuyItem[]): string {
  const byJob = new Map<string, number>();
  for (const item of items) {
    const key = item.jobNumber ?? "";
    byJob.set(key, (byJob.get(key) ?? 0) + 1);
  }
  return [...byJob.entries()]
    .map(([job, count], index) => {
      const what = index === 0 ? `${count} ${count === 1 ? "item" : "items"}` : String(count);
      return job ? `${what} for job #${job}` : `${what} for the van`;
    })
    .join(", ");
}

/**
 * The big-box stores' own search pages, for "Check supplier".
 *
 * Only a search: the result page is theirs, and whether they have it, and at
 * what price, is theirs to say.
 */
export function supplierSearchLinks(query: string): { label: string; href: string }[] {
  const term = query.trim();
  if (!term) return [];
  return [
    { label: "Search Lowe’s", href: `https://www.lowes.com/search?searchTerm=${encodeURIComponent(term)}` },
    { label: "Search Home Depot", href: `https://www.homedepot.com/s/${encodeURIComponent(term)}` },
  ];
}
