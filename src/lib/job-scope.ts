/**
 * The scope of work written on a job, and how its lines are described to the
 * model that drafts one. Import-free.
 */

export const MAX_SCOPE_LENGTH = 2000;

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** "Labour: Replace receptacles (3 hr)", "Material: 15A outlet (4 each)". No prices: a scope never states one. */
export function workItemLabel(line: Record<string, unknown>): string {
  const description = text(line.description);
  if (!description) return "";
  const kind = line.kind === "labor" ? "Labour" : "Material";
  const quantity = Number(line.quantity ?? 0);
  const unit = text(line.unit);
  const amount = Number.isFinite(quantity) && quantity > 0 ? ` (${quantity}${unit ? ` ${unit}` : ""})` : "";
  return `${kind}: ${description}${amount}`;
}

/** The scope as saved: spaces tidied, within the column's limit, empty when blank. */
export function cleanScope(value: unknown): string {
  return (typeof value === "string" ? value : "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_SCOPE_LENGTH);
}
