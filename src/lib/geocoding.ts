import "server-only";

/**
 * Turning an address into a point on a map.
 *
 * Properties are created from what somebody said on the phone — "994 Red Gum
 * Lane, Nipomo" — and carry no coordinates. Until now `mapJob` read those nulls
 * as `0, 0`, which is a real place: a stretch of the Atlantic off West Africa.
 * Nothing plotted it, so nobody noticed. A map does plot it, so it has to be
 * fixed before one exists rather than after.
 *
 * Results are written back to the property, so an address is geocoded once
 * rather than on every render. Google bills per request and rate-limits, and a
 * route page that re-geocodes eight stops on every load would be both slow and
 * expensive.
 *
 * Reading Google's answers — which ones are about an address and which are
 * about the key — is geocode-answer.ts, where it can be tested.
 */

import { hasCoordinates, type Coordinates } from "@/lib/coordinates";
import {
  lookUpInTurns,
  NOTHING_TO_PLACE,
  readGeocodeAnswer,
  type GeocodeAnswer,
  type PlacingReport,
  type UnplacedAddress,
} from "@/lib/geocode-answer";

export type { Coordinates, GeocodeAnswer, PlacingReport, UnplacedAddress };
export { hasCoordinates };

/**
 * Long enough for Google on a slow day, short enough that a route page does
 * not hang on it. The page waits for these lookups before it draws.
 */
const LOOKUP_TIMEOUT_MS = 8_000;

export function isGeocodingConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_SERVER_KEY);
}

/**
 * One address, geocoded.
 *
 * Never throws: a route page must still render its list when Google is down or
 * unconfigured, with the stops it could not place said out loud rather than
 * dropped or drawn in the wrong ocean.
 *
 * `savedState` is the state on the job, so a match in another state is caught
 * rather than drawn (geocode-answer.ts).
 */
export async function geocodeAddress(address: string, savedState?: string | null): Promise<GeocodeAnswer> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) {
    return {
      kind: "setup",
      reason: "Address lookups aren't set up on this copy of Volteira.",
      detail: "GOOGLE_MAPS_SERVER_KEY is not set.",
    };
  }

  const query = address.trim();
  if (query.length < 5) return { kind: "missed", reason: "There isn't enough of an address to look up." };

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", key);
  // A bare street name matches in a hundred countries. The business works in
  // one, and biasing the search is the difference between the right Nipomo and
  // a plausible wrong one.
  url.searchParams.set("region", "us");

  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    const payload = await response.json().catch(() => null);
    return readGeocodeAnswer(payload, { savedState, httpStatus: response.status });
  } catch (error) {
    // The URL carries the key, so neither it nor the error's text (which can
    // quote it) goes anywhere but this sentence.
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      kind: "unavailable",
      reason: timedOut
        ? "Google's address lookup didn't answer in time."
        : "Google's address lookup couldn't be reached.",
      detail: timedOut
        ? `No answer within ${LOOKUP_TIMEOUT_MS / 1000} seconds.`
        : "The request failed before Google answered.",
    };
  }
}

/** "412 E Chapel St, Santa Maria, CA, 93454", from a property row. */
function addressOf(record: Record<string, unknown>): string {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  return [text(record.address_line_1), text(record.city), text(record.state), text(record.postal_code)]
    .filter(Boolean)
    .join(", ");
}

/**
 * Place any of this business's properties that have never been placed, and
 * remember the answer.
 *
 * Called before a map renders rather than on a schedule, because an address
 * that nobody is looking at does not need a coordinate and every lookup costs
 * money. Already-placed properties are skipped entirely.
 *
 * Returns what it could not place and why, so the page can say which stops
 * are missing from the map instead of silently drawing a shorter route than
 * the day actually has — and, when the cause is the key or Google rather than
 * the addresses, says that once instead of once per address.
 */
export async function ensurePropertiesGeocoded(input: {
  database: { from: (table: string) => never } | ReturnType<typeof import("@/lib/supabase/admin").getSupabaseAdmin>;
  organizationId: string;
  limit?: number;
}): Promise<PlacingReport> {
  // Not an error: an unconfigured deployment simply has no coordinates.
  if (!isGeocodingConfigured()) return NOTHING_TO_PLACE;

  const database = input.database as ReturnType<
    typeof import("@/lib/supabase/admin").getSupabaseAdmin
  >;

  const { data, count } = await database
    .from("properties")
    .select("id, address_line_1, city, state, postal_code", { count: "exact" })
    .eq("organization_id", input.organizationId)
    .is("archived_at", null)
    .is("latitude", null)
    .limit(input.limit ?? 25);

  const pending = (data ?? []) as Record<string, unknown>[];
  if (pending.length === 0) return NOTHING_TO_PLACE;

  const { answered, stoppedBy } = await lookUpInTurns(pending, (row) =>
    geocodeAddress(addressOf(row), typeof row.state === "string" ? row.state : null),
  );

  const unplaced: UnplacedAddress[] = [];
  const found: { id: string; coordinates: Coordinates }[] = [];
  for (const { item, answer } of answered) {
    if (answer.kind === "placed") {
      found.push({ id: String(item.id), coordinates: answer.coordinates });
    } else if (answer.kind === "missed") {
      unplaced.push({
        id: String(item.id),
        address: addressOf(item) || "an address with nothing in it",
        reason: answer.reason,
      });
    }
  }

  const saved = await Promise.all(
    found.map(async ({ id, coordinates }) => {
      const { error } = await database
        .from("properties")
        .update({ latitude: coordinates.lat, longitude: coordinates.lng })
        .eq("id", id);
      // Not fatal: the address is simply looked up again next time.
      if (error) console.error("could not save a placed address", { propertyId: id, error: error.message });
      return !error;
    }),
  );
  const placed = saved.filter(Boolean).length;

  if (stoppedBy) {
    // Once per page load, in the server log, where the deployment's owner can
    // find it. Google's words, never the URL: it carries the key.
    console.error("address lookups stopped", {
      organizationId: input.organizationId,
      kind: stoppedBy.kind,
      detail: stoppedBy.detail,
    });
  }

  const waitingTotal = Math.max(count ?? pending.length, pending.length);
  return {
    placed,
    unplaced,
    problem: stoppedBy ? { kind: stoppedBy.kind, reason: stoppedBy.reason, detail: stoppedBy.detail } : null,
    waiting: stoppedBy ? Math.max(waitingTotal - placed - unplaced.length, 0) : 0,
  };
}
