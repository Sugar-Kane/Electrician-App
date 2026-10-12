/**
 * Parts promised to a job, and parts that left on one.
 *
 * Adding a part to a job used to take it off the count there and then, so a
 * quote for a panel swap that was never accepted still emptied the shelf of
 * breakers. A part on an open job is now *reserved*: still on the van, still
 * counted, but spoken for. It comes off the count when the job is finished and
 * somebody says how many were actually used.
 *
 * Nothing new is stored to make this work. A line's reservation is what it
 * asked for less what the ledger says it has already taken, while its job is
 * open. Lines written before this change were taken when they were written, so
 * they reserve nothing and nothing is taken twice.
 *
 * Import-free, so the arithmetic can be tested without a database.
 */

/** Two decimals, matching the quantity columns. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function positive(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Units a part line can be counted in. Labor is always hours. */
export const PART_UNITS = ["each", "ft", "box", "roll", "stick"] as const;

/** Units that hold a number of something else: a stick of conduit, a box of connectors. */
export const PACK_UNITS = new Set(["box", "roll", "stick"]);

/** What a pack can hold. */
export const PACK_CONTENTS = ["ft", "each"] as const;

export type PackedQuantity = {
  quantity: number;
  unit: string;
  /** How much one pack holds, when the unit is a pack and somebody said. */
  packSize?: number | null;
  packUnit?: string | null;
};

/** "stick" → "sticks" when there is more than one. Units that read the same either way stay put. */
export function unitLabel(unit: string, quantity: number): string {
  if (quantity === 1) return unit;
  if (unit === "box") return "boxes";
  if (unit === "ft" || unit === "each" || unit === "hr" || unit === "hour") return unit;
  return unit.endsWith("s") ? unit : `${unit}s`;
}

function count(quantity: number): string {
  return String(round(quantity));
}

/**
 * The conversion, written out: "10 sticks × 10 ft = 100 ft".
 *
 * Empty when the line is not a pack or nobody said what the pack holds — a
 * conversion that has to be guessed is not shown.
 */
export function packLabel(line: PackedQuantity): string {
  const size = positive(line.packSize);
  if (!PACK_UNITS.has(line.unit) || size === 0 || !line.packUnit) return "";
  const total = round(positive(line.quantity) * size);
  return `${count(line.quantity)} ${unitLabel(line.unit, line.quantity)} × ${count(size)} ${line.packUnit} = ${count(total)} ${line.packUnit}`;
}

/**
 * How much of a stock item a line takes, in the unit the item is counted in.
 *
 * Ten sticks of conduit that hold ten feet each take a hundred feet from an
 * item counted in feet. A line in the item's own unit, or one whose pack holds
 * nothing the item is counted in, takes its own quantity.
 */
export function stockQuantity(line: PackedQuantity, itemUnit: string): number {
  const quantity = positive(line.quantity);
  const size = positive(line.packSize);
  if (line.unit !== itemUnit && PACK_UNITS.has(line.unit) && size > 0 && line.packUnit === itemUnit) {
    return round(quantity * size);
  }
  return round(quantity);
}

/** One line's part of the ledger. */
export type LedgerEntry = { lineId: string; quantity: number };

/**
 * What each line has taken off the shelf so far, as a positive number.
 *
 * Read from its movements: "used on a job" is negative and "returned" is
 * positive, so the net is what is out of the van because of that line.
 */
export function takenByLine(entries: readonly LedgerEntry[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.lineId) continue;
    net.set(entry.lineId, (net.get(entry.lineId) ?? 0) + (Number(entry.quantity) || 0));
  }
  const taken = new Map<string, number>();
  for (const [lineId, sum] of net) taken.set(lineId, Math.max(0, round(-sum)));
  return taken;
}

export type StockLine = {
  lineId: string;
  itemId: string;
  /** The line's quantity in the item's unit (see `stockQuantity`). */
  quantity: number;
  /** Whether the job is still open: not completed and not canceled. */
  open: boolean;
  /** What the line has already taken off the shelf (see `takenByLine`). */
  taken: number;
};

/** What a line is holding back: what it asked for, less what it took, while its job is open. */
export function reservedQuantity(line: StockLine): number {
  if (!line.open) return 0;
  return Math.max(0, round(positive(line.quantity) - positive(line.taken)));
}

/** Every item's reservations, added up. Items with nothing reserved are left out. */
export function reservedByItem(lines: readonly StockLine[]): Map<string, number> {
  const reserved = new Map<string, number>();
  for (const line of lines) {
    const amount = reservedQuantity(line);
    if (amount > 0) reserved.set(line.itemId, round((reserved.get(line.itemId) ?? 0) + amount));
  }
  return reserved;
}

/** What is on the shelf and not spoken for. Can go below zero: more promised than owned. */
export function freeQuantity(onHand: number, reserved: number): number {
  return round((Number(onHand) || 0) - positive(reserved));
}

/** "20 on hand · 4 reserved · 16 free", or just "20 on hand" when nothing is reserved. */
export function stockSummary(onHand: number, reserved: number, unit = ""): string {
  const suffix = unit ? ` ${unit}` : "";
  const held = positive(reserved);
  if (held === 0) return `${count(onHand)}${suffix} on hand`;
  return `${count(onHand)}${suffix} on hand · ${count(held)} reserved · ${count(freeQuantity(onHand, held))} free`;
}

/**
 * The movements that finishing a job writes.
 *
 * `confirmed` is what somebody said was actually used, by line, as a total for
 * that line. A line they did not mention used what it asked for. Zero, or
 * anything that is not a positive number, means none came from stock: the
 * part was bought elsewhere, or never fitted. Using more than was asked for is
 * allowed — it came off the van.
 *
 * Whatever the line has already taken is subtracted, so confirming the same
 * job twice — a retry after a failed save, a double tap — takes the parts once.
 */
export function usageMovements(
  lines: readonly Pick<StockLine, "lineId" | "itemId" | "quantity" | "taken">[],
  confirmed: ReadonlyMap<string, number | null | undefined> = new Map(),
): { lineId: string; itemId: string; quantity: number }[] {
  const moves: { lineId: string; itemId: string; quantity: number }[] = [];
  for (const line of lines) {
    const said = confirmed.has(line.lineId) ? confirmed.get(line.lineId) : line.quantity;
    const used = typeof said === "number" && Number.isFinite(said) ? Math.max(0, said) : 0;
    const quantity = Math.max(0, round(used - positive(line.taken)));
    if (quantity > 0) moves.push({ lineId: line.lineId, itemId: line.itemId, quantity });
  }
  return moves;
}

/** "Used 2 from stock, 18 left." — said after the count has moved. */
export function usedSentence(quantity: number, left: number, unit = ""): string {
  const suffix = unit && unit !== "each" ? ` ${unit}` : "";
  const remaining = left < 0 ? `the count now shows ${count(left)}${suffix}, so recount it` : `${count(left)}${suffix} left`;
  return `Used ${count(quantity)}${suffix} from stock, ${remaining}.`;
}
