import { lineTotalCents, parseQuantity, readPrice } from "./job-lines.ts";
import { PART_UNITS } from "./stock-reservation.ts";

/**
 * Priced lines ChatGPT wants to put on a job, read with the same rules as the
 * job page's own boxes.
 *
 * Every line needs a customer price, and a price nobody gave is refused
 * rather than billed as nothing: "0" is how somebody says there is no charge.
 * A quantity that cannot be read is refused too, never guessed as one. Labor
 * is counted in hours; a part is counted in one of the trade's units, or
 * "each".
 *
 * Kept free of the database so the money rules can be tested on their own.
 */

export const MAX_TOOL_LINES = 60;

export type ToolLineRow = {
  kind: "labor" | "material";
  description: string;
  quantity: number;
  unit: string;
  unit_price_cents: number;
};

export type ToolLinesReading =
  | { ok: true; rows: ToolLineRow[]; totalCents: number }
  | { ok: false; error: string };

function asText(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" ? value : "";
}

export function readToolLines(items: unknown): ToolLinesReading {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "Give at least one item." };
  if (items.length > MAX_TOOL_LINES) return { ok: false, error: `Add up to ${MAX_TOOL_LINES} items at a time.` };

  const rows: ToolLineRow[] = [];
  for (const raw of items) {
    const item = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const description = asText(item.description).trim().slice(0, 300);
    if (!description) return { ok: false, error: "Every item needs a description." };

    const kind = asText(item.kind) === "labor" ? "labor" : "material";
    const quantity = parseQuantity(asText(item.quantity) || "1");
    if (quantity === null) return { ok: false, error: `The quantity for "${description}" could not be read.` };

    const price = readPrice(asText(item.unit_price));
    if (price.state === "missing") {
      return {
        ok: false,
        error: `"${description}" has no customer price. Ask the electrician for one, or use 0 if there is no charge.`,
      };
    }
    if (price.state === "invalid") {
      return { ok: false, error: `The price for "${description}" could not be read. Something like 12.50 works.` };
    }

    const typedUnit = asText(item.unit).trim().toLowerCase();
    const unit = kind === "labor" ? "hr" : (PART_UNITS as readonly string[]).includes(typedUnit) ? typedUnit : "each";

    rows.push({ kind, description, quantity, unit, unit_price_cents: price.cents });
  }

  const totalCents = rows.reduce(
    (sum, row) => sum + lineTotalCents({ quantity: row.quantity, unitPriceCents: row.unit_price_cents }),
    0,
  );
  return { ok: true, rows, totalCents };
}
