/**
 * The kinds of place an electrician stops at on the way.
 *
 * Its own module because both sides need it: the form draws the choices in the
 * browser and the action checks them on the server. It lived in the action file
 * first, and every export of a `"use server"` module is replaced on the client
 * by a reference to a server action — so the list arrived as a function and the
 * page died on `SUPPLY_STOP_KINDS.map is not a function`.
 *
 * Import-free, like `navigation.ts` and `schedule-view.ts`.
 */

export const SUPPLY_STOP_KINDS = [
  { value: "supplier", label: "Supply house" },
  { value: "store", label: "Big-box store" },
  // The one the hardcoded pair could never be. Most of an electrician's stock
  // lives in a unit somewhere, not in a shop.
  { value: "storage", label: "My storage" },
  { value: "other", label: "Somewhere else" },
] as const;

export type SupplyStopKind = (typeof SUPPLY_STOP_KINDS)[number]["value"];

const KINDS = new Set<string>(SUPPLY_STOP_KINDS.map((kind) => kind.value));

export function isSupplyStopKind(value: string): value is SupplyStopKind {
  return KINDS.has(value);
}

/** What a stop reads as, whatever the column happens to hold. */
export function supplyStopLabel(value: string): string {
  return SUPPLY_STOP_KINDS.find((kind) => kind.value === value)?.label ?? "Somewhere else";
}
