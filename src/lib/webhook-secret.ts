import { timingSafeEqual } from "node:crypto";

/** Constant-time comparison for provider webhook secrets. */
export function webhookSecretMatches(received: string | null, expected: string): boolean {
  if (!received || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
