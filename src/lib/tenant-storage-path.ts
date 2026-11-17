/**
 * Whether a storage object path belongs to the business (or person) asking.
 *
 * Files live in buckets under a first path segment that names their owner:
 * `{organizationId}/jobs/{jobId}/photo.jpg`, `{userId}/avatar.png`. The bucket
 * policies check that segment for signed-in users, but the server signs,
 * downloads and deletes with the service role, where no policy applies. Those
 * calls were given a path read from a row (or sent back by the browser) and
 * trusted it — so a row whose path had been edited to point at another
 * business's file would have that file signed, emailed, read by the AI, or
 * deleted.
 *
 * Every service-role storage call now asks this first. A path passes only in
 * one canonical shape: the owner's id, then plain segments. Anything that could
 * name a different object than it appears to — `..`, `.`, empty segments,
 * backslashes, percent-encoding, control characters — is refused rather than
 * normalised, because a path that needs normalising is not one this app wrote.
 *
 * Import-free, so the rule is tested on its own.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Longer than anything the app writes; a guard against abuse, not a format rule. */
const MAX_PATH_LENGTH = 1024;

function cleanSegment(segment: string): boolean {
  if (!segment || segment === "." || segment === "..") return false;
  // Backslashes, percent-encoding and control characters can make one string
  // name a different object somewhere along the way. None is ever written here.
  return !/[\\%\u0000-\u001f\u007f]/.test(segment);
}

/**
 * True when `path` is `{ownerId}/...` in canonical form, at least `minSegments`
 * long (owner included), and inside `folder` when one is given
 * (`jobs/{jobId}`, `assistant`, ...).
 */
export function isOwnedObjectPath(
  path: unknown,
  ownerId: string,
  options: { folder?: string; minSegments?: number } = {},
): path is string {
  if (typeof path !== "string" || !path || path.length > MAX_PATH_LENGTH) return false;
  if (!UUID.test(ownerId)) return false;
  const segments = path.split("/");
  if (segments.length < Math.max(2, options.minSegments ?? 2)) return false;
  if (!segments.every(cleanSegment)) return false;
  if (segments[0]!.toLowerCase() !== ownerId.toLowerCase()) return false;
  if (options.folder) {
    const folder = options.folder.split("/").filter(Boolean);
    if (!folder.every(cleanSegment)) return false;
    // The folder, and then at least one more segment: the file itself.
    if (segments.length < folder.length + 2) return false;
    if (!folder.every((part, index) => segments[index + 1] === part)) return false;
  }
  return true;
}

/** The paths, of those given, that belong to the owner. The rest are dropped and counted. */
export function ownedObjectPaths(
  paths: readonly unknown[],
  ownerId: string,
  options: { folder?: string; minSegments?: number } = {},
): { paths: string[]; refused: number } {
  const owned: string[] = [];
  let refused = 0;
  for (const path of paths) {
    if (path === "" || path === null || path === undefined) continue;
    if (isOwnedObjectPath(path, ownerId, options)) owned.push(path);
    else refused += 1;
  }
  return { paths: owned, refused };
}

/** Said once in the logs when a path is refused, without the path itself. */
export function reportRefusedPaths(where: string, refused: number): void {
  if (refused > 0) console.error(`storage: ${refused} path(s) refused in ${where}: not owned by the caller`);
}
