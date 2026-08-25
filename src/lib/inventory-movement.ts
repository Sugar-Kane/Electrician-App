/**
 * Stock arriving and leaving.
 *
 * `quantity_on_hand` used to be a number somebody typed, and a number somebody
 * types goes wrong the first week — three breakers get fitted on a Tuesday and
 * nobody opens the app to say so. Every change is a row now, the column is the
 * sum of those rows, and the only way to move stock is to say why it moved.
 *
 * That "why" is what makes the rest possible. The parts that left on jobs, at
 * the price they left at, are the material spend for the year; the ones that
 * came in are the purchases. Neither is a guess made in April from receipts in
 * a glovebox.
 *
 * Import-free, so the arithmetic can be tested without a database.
 */

export const MOVEMENT_REASONS = [
  { value: "opening", label: "Opening count", direction: "in" },
  { value: "received", label: "Received", direction: "in" },
  { value: "returned", label: "Returned to stock", direction: "in" },
  { value: "used_on_job", label: "Used on a job", direction: "out" },
  { value: "wastage", label: "Damaged or lost", direction: "out" },
  { value: "adjustment", label: "Corrected by hand", direction: "either" },
  { value: "stock_take", label: "Counted", direction: "either" },
] as const;

export type MovementReason = (typeof MOVEMENT_REASONS)[number]["value"];

const REASONS = new Map(MOVEMENT_REASONS.map((entry) => [entry.value, entry]));

export function isMovementReason(value: string): value is MovementReason {
  return REASONS.has(value as MovementReason);
}

export function movementLabel(reason: string): string {
  return REASONS.get(reason as MovementReason)?.label ?? "Moved";
}

export type Movement = {
  quantity: number;
  reason: MovementReason;
  unitCostCents: number;
};

/**
 * What a number typed into a stock box means as a movement.
 *
 * Reasons that only ever go one way have their sign applied here rather than
 * trusted from the caller: "used on a job, 3" means three fewer, and a caller
 * that passed 3 and meant -3 would otherwise quietly add stock. `adjustment`
 * and `stock_take` keep whatever sign they were given, because those are the
 * two that genuinely go either way.
 */
export function signedQuantity(reason: MovementReason, quantity: number): number {
  const size = Math.abs(quantity);
  const direction = REASONS.get(reason)?.direction ?? "either";
  if (direction === "in") return size;
  if (direction === "out") return -size;
  return quantity;
}

/** What is on hand, from the ledger alone. */
export function onHand(movements: { quantity: number }[]): number {
  const total = movements.reduce((sum, movement) => sum + movement.quantity, 0);
  // Two decimals, matching the column. Floating point over a hundred movements
  // otherwise reads 16.999999999999996 breakers.
  return Math.round(total * 100) / 100;
}

/**
 * Turning a counted total into the adjustment that gets there.
 *
 * Somebody doing a stock take types what they counted, not the difference. The
 * difference is arithmetic, and asking a person to do it in a van is how a
 * count of 17 becomes an adjustment of 17 on top of the 20 already there.
 *
 * Returns null when nothing moved, so a re-count that agrees writes no row.
 */
export function adjustmentTo(counted: number, current: number): number | null {
  const change = Math.round((counted - current) * 100) / 100;
  return change === 0 ? null : change;
}

/**
 * What the stock that left cost.
 *
 * Only what went out, at the price it went out at. A breaker bought at $38 and
 * fitted in March was a $38 expense in March however the price has moved since,
 * which is the whole reason the cost is written onto the movement rather than
 * read back off the item.
 *
 * Returns cents, and never negative — this answers "what did I spend", so a
 * return to stock reduces it rather than turning it into income.
 */
export function spentCents(movements: Movement[]): number {
  const total = movements.reduce((sum, movement) => {
    if (movement.quantity >= 0) return sum;
    return sum + Math.abs(movement.quantity) * movement.unitCostCents;
  }, 0);
  return Math.max(0, Math.round(total));
}

/** What came in, at what it cost. The other half of the tax answer. */
export function purchasedCents(movements: Movement[]): number {
  const total = movements.reduce((sum, movement) => {
    // The opening count is what was already owned, not a purchase. Counting it
    // would put a whole van's worth of stock into one day's expenses.
    if (movement.reason === "opening" || movement.quantity <= 0) return sum;
    return sum + movement.quantity * movement.unitCostCents;
  }, 0);
  return Math.max(0, Math.round(total));
}

/**
 * A quantity somebody typed.
 *
 * Refused rather than guessed at, because a quantity that silently becomes zero
 * is a movement that does nothing and a stock list that quietly stops matching
 * the van.
 */
export function parseMovementQuantity(raw: string): number | null {
  const cleaned = (raw ?? "").replace(/,/g, "").trim();
  if (!cleaned) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

  // Two decimals, matching the column. Wire is counted in feet and half-feet;
  // nobody stocks a thousandth of anything.
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? null : rounded;
}
