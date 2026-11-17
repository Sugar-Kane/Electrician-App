/**
 * The words of a change order: what the customer reads and signs.
 *
 * Every change is listed — added, changed, removed — by what it is and how
 * much of it, the way the work is described to the customer. Prices are given
 * as the totals a customer checks (added materials, added labor, changed work,
 * removed work, this change order, the contract after it), not line by line:
 * the per-part prices stay with the electrician, as they do on the invoice.
 *
 * The parties and the job come from the same facts a contract is filled from,
 * so a missing name is a blank to fill in exactly as it is on a contract, and
 * the page refuses to let anybody sign around it. Everything typed on an item
 * is written in after filling, so it can never be read as a blank.
 *
 * Import-free apart from the shared rules, so the wording is tested.
 */

import { changeOrderSummary, signedCents, type ChangeOrderItem } from "./change-order-math.ts";
import { fillTemplate, type ContractFacts, type FilledContract } from "./contract-template.ts";
import { formatCents, formatQuantity } from "./job-lines.ts";

/** "{{" in something somebody typed must not read as a blank to fill in. */
function plain(text: string): string {
  return (text ?? "").replace(/\{\{|\}\}/g, (pair) => pair[0]!).trim();
}

function amount(item: Pick<ChangeOrderItem, "quantity" | "unit">): string {
  const unit = item.unit && item.unit !== "each" ? ` ${item.unit}` : "";
  return `${formatQuantity(item.quantity)}${unit}`;
}

/** One change, in words. */
export function describeChange(item: ChangeOrderItem): string {
  const what = plain(item.description);
  if (item.action === "add") return `${what} (${amount(item)})`;
  if (item.action === "remove") {
    return item.original ? `${plain(item.original.description)} (${amount(item.original)})` : what;
  }
  const from = item.original;
  if (!from) return what;
  const parts: string[] = [];
  if (plain(from.description) !== what) parts.push(`${plain(from.description)} becomes ${what}`);
  else parts.push(what);
  if (Math.round(from.quantity * 1000) !== Math.round(item.quantity * 1000)) {
    parts.push(`from ${amount(from)} to ${amount(item)}`);
  }
  if (item.unitPriceCents !== null && item.unitPriceCents !== from.unitPriceCents) parts.push("at a revised price");
  return parts.join(", ");
}

export function changeOrderDocument(input: {
  number: number;
  facts: Partial<ContractFacts>;
  /** When the customer signed the agreement, as it should read: "Oct 2, 2026". Empty when unsigned. */
  signedOn: string;
  description: string;
  reason?: string;
  items: readonly ChangeOrderItem[];
  /** What the contract stands at before this change order, or null when unknown. */
  contractBeforeCents: number | null;
}): FilledContract {
  const head = fillTemplate(
    `CHANGE ORDER #${Math.max(1, Math.round(input.number))}

This change order is made on {{today}} between {{business_name}} ("the Contractor") and {{customer_name}} ("the Customer"). It changes the work agreed for job {{job_number}} at {{service_address}}${input.signedOn ? `, in the contract signed on ${plain(input.signedOn)}` : ""}.`,
    input.facts,
  );

  const added = input.items.filter((item) => item.action === "add");
  const changed = input.items.filter((item) => item.action === "modify");
  const removed = input.items.filter((item) => item.action === "remove");
  const summary = changeOrderSummary(input.items);

  const sections: string[] = [head.body];
  const description = plain(input.description);
  if (description) sections.push(`WHAT IS CHANGING\n${description}`);
  const reason = plain(input.reason ?? "");
  if (reason) sections.push(`WHY\n${reason}`);
  if (added.length) sections.push(["WORK ADDED", ...added.map(describeChange)].join("\n"));
  if (changed.length) sections.push(["WORK CHANGED", ...changed.map(describeChange)].join("\n"));
  if (removed.length) sections.push(["WORK REMOVED", ...removed.map(describeChange)].join("\n"));

  const price: string[] = ["PRICE"];
  if (input.contractBeforeCents !== null) price.push(`Contract amount before this change order: ${formatCents(input.contractBeforeCents)}`);
  if (summary.addedMaterialsCents) price.push(`Added materials: ${signedCents(summary.addedMaterialsCents, formatCents)}`);
  if (summary.addedLaborCents) price.push(`Added labor: ${signedCents(summary.addedLaborCents, formatCents)}`);
  if (summary.modifiedCents) price.push(`Changed work: ${signedCents(summary.modifiedCents, formatCents)}`);
  if (summary.removedCents) price.push(`Removed work: ${signedCents(summary.removedCents, formatCents)}`);
  price.push(`This change order: ${signedCents(summary.netCents, formatCents)}`);
  price.push(
    input.contractBeforeCents !== null
      ? `Revised contract total: ${formatCents(Math.max(0, input.contractBeforeCents + summary.netCents))}`
      : summary.netCents >= 0
        ? `This is added to the price already agreed.`
        : `This is taken off the price already agreed.`,
  );
  sections.push(price.join("\n"));

  sections.push(
    "Everything else that was agreed stays the same. By signing, the Customer approves the changes above and the revised price.",
  );

  return { body: sections.join("\n\n"), unfilled: head.unfilled };
}
