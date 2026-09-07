/**
 * Whether a filed PDF was rendered from the contract wording that is current
 * now. A PDF can remain safely on file after a failed rebuild, but it must not
 * be eligible for signature until this snapshot agrees with the record again.
 */

export type ContractSource = {
  body: string;
  scope: string;
  unfilled: string[];
};

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return null;
  }
  return value as string[];
}

export function contractSourceMatches(snapshot: unknown, source: ContractSource): boolean {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;

  const recorded = snapshot as Record<string, unknown>;
  const unfilled = strings(recorded.unfilled);
  if (!unfilled) return false;

  return recorded.body === source.body &&
    recorded.scope === source.scope &&
    unfilled.length === source.unfilled.length &&
    unfilled.every((value, index) => value === source.unfilled[index]);
}
