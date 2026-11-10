/**
 * Whether a password has turned up in a known data breach, by Have I Been
 * Pwned's k-anonymity range lookup: only the first five characters of the
 * password's SHA-1 leave the device, never the password or its full hash.
 * Padding is asked for, so the reply's size says nothing either.
 *
 * Supabase offers this check only on its paid plan; this is the same lookup,
 * run by the app on sign-up, password reset and password change.
 *
 * Fails open: if the service cannot be reached in a few seconds, the password
 * is not refused for it. It is a guard against reused passwords, not a gate.
 *
 * Import-free, and works in the browser and on the server.
 */

export const BREACHED_PASSWORD_MESSAGE =
  "That password has appeared in a known data breach, so it is easy to guess. Choose a different one.";

const RANGE_URL = "https://api.pwnedpasswords.com/range/";

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** How many times this hash suffix appears in a range reply (padding lines count 0). */
export function countInRange(body: string, suffix: string): number {
  const wanted = suffix.toUpperCase();
  for (const line of body.split(/\r?\n/)) {
    const [lineSuffix, count] = line.trim().split(":");
    if (lineSuffix?.toUpperCase() === wanted) return Number.parseInt(count ?? "0", 10) || 0;
  }
  return 0;
}

/** True when the password is in a known breach; false when not, or when the lookup failed. */
export async function passwordIsBreached(
  password: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 3000,
): Promise<boolean> {
  if (!password) return false;
  try {
    const hash = await sha1Hex(password);
    const response = await fetchImpl(`${RANGE_URL}${hash.slice(0, 5)}`, {
      headers: { "Add-Padding": "true" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    return countInRange(await response.text(), hash.slice(5)) > 0;
  } catch {
    return false;
  }
}
