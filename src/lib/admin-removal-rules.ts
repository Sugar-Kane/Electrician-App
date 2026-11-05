/**
 * Which stored files a removal may delete.
 *
 * The database returns the paths of the documents it removed, but files are
 * deleted by the server with full storage access. So the server deletes only
 * paths inside the business's own folder (`<business id>/...`), never one that
 * climbs out of it, and each path once. Kept free of imports so the rule can
 * be tested on its own.
 */
export function filesInBusinessFolder(organizationId: string, paths: unknown): string[] {
  if (!/^[0-9a-f-]{36}$/i.test(organizationId) || !Array.isArray(paths)) return [];
  const prefix = `${organizationId.toLowerCase()}/`;
  const kept = new Set<string>();
  for (const path of paths) {
    if (typeof path !== "string") continue;
    const clean = path.trim();
    if (!clean.toLowerCase().startsWith(prefix)) continue;
    if (clean.length <= prefix.length) continue;
    if (clean.split("/").some((part) => part === ".." || part === ".")) continue;
    kept.add(clean);
  }
  return [...kept];
}

/** The kinds of record the admin console can delete one at a time. */
export const DELETABLE_KINDS = ["customer", "job", "invoice", "booking", "contract"] as const;
export type DeletableKind = (typeof DELETABLE_KINDS)[number];

export function isDeletableKind(value: string): value is DeletableKind {
  return (DELETABLE_KINDS as readonly string[]).includes(value);
}
