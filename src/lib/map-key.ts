/**
 * Naming a browser map key without printing it.
 *
 * Two Google keys live in this deployment and they have been swapped between
 * their variables at least once. Telling them apart meant reading environment
 * variables in a hosting console, which is slow, and pasting them into a chat,
 * which is worse. The last few characters are enough to answer "is the right
 * key in the right variable" and are not enough to use.
 *
 * This is only ever applied to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, which is
 * compiled into the JavaScript bundle and served to every visitor already.
 * Never call it on `GOOGLE_MAPS_SERVER_KEY`.
 */
export function keyTail(key: string | undefined | null, visible = 6): string {
  const trimmed = typeof key === "string" ? key.trim() : "";
  if (!trimmed) return "(nothing)";
  // A key too short to hide is a key that is wrong anyway; still refuse to
  // print it whole, so this function has no input that leaks its argument.
  if (trimmed.length <= visible) return `…${trimmed.slice(-2)}`;
  return `…${trimmed.slice(-visible)}`;
}
