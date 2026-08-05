export function getSafeNextPath(candidate: string | null | undefined) {
  if (!candidate?.startsWith("/")) return "/";

  try {
    const base = new URL("https://volteira.local");
    const destination = new URL(candidate, base);
    if (destination.origin !== base.origin) return "/";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}
