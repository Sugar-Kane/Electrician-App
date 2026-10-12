import "server-only";

import { createHash } from "node:crypto";

/**
 * A preview's fingerprint as a page carries it: hashed, so a customer's number
 * never sits in the page's HTML while the page shows it masked.
 */
export function hashed(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}
