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
 */

import { hasCoordinates, type Coordinates } from "@/lib/coordinates";

export type { Coordinates };
export { hasCoordinates };

export type UnplacedAddress = { address: string; reason: string };

export type GeocodeResult =
  | { ok: true; coordinates: Coordinates; formatted: string }
  | { ok: false; reason: string };

export function isGeocodingConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_SERVER_KEY);
}

/**
 * One address, geocoded.
 *
 * Never throws: a route page must still render its list when Google is down or
 * unconfigured, with the stops it could not place said out loud rather than
 * dropped or drawn in the wrong ocean.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return { ok: false, reason: "GOOGLE_MAPS_SERVER_KEY is not set." };

  const query = address.trim();
  if (query.length < 5) return { ok: false, reason: "Too little of an address to place." };

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", key);
  // A bare street name matches in a hundred countries. The business works in
  // one, and biasing the search is the difference between the right Nipomo and
  // a plausible wrong one.
  url.searchParams.set("region", "us");

  try {
    const response = await fetch(url, { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as {
      status?: string;
      error_message?: string;
      results?: {
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }[];
    };

    if (payload.status !== "OK" || !payload.results?.length) {
      return {
        ok: false,
        reason: payload.error_message || payload.status || "No match for that address.",
      };
    }

    const best = payload.results[0]!;
    const location = best.geometry?.location;
    const coordinates = { lat: Number(location?.lat), lng: Number(location?.lng) };

    if (!hasCoordinates(coordinates)) {
      return { ok: false, reason: "Google returned a result with no usable location." };
    }

    return {
      ok: true,
      coordinates,
      formatted: best.formatted_address ?? query,
    };
  } catch {
    return { ok: false, reason: "Could not reach the geocoding service." };
  }
}

/**
 * Place any of this business's properties that have never been placed, and
 * remember the answer.
 *
 * Called before a map renders rather than on a schedule, because an address
 * that nobody is looking at does not need a coordinate and every lookup costs
 * money. Already-placed properties are skipped entirely.
 *
 * Returns what it could not place, so the page can say which stops are missing
 * from the map instead of silently drawing a shorter route than the day
 * actually has.
 */
export async function ensurePropertiesGeocoded(input: {
  database: { from: (table: string) => never } | ReturnType<typeof import("@/lib/supabase/admin").getSupabaseAdmin>;
  organizationId: string;
  limit?: number;
}): Promise<{ placed: number; unplaced: UnplacedAddress[] }> {
  if (!isGeocodingConfigured()) {
    return {
      placed: 0,
      unplaced: [],
      // Not an error: an unconfigured deployment simply has no coordinates.
    };
  }

  const database = input.database as ReturnType<
    typeof import("@/lib/supabase/admin").getSupabaseAdmin
  >;

  const { data } = await database
    .from("properties")
    .select("id, address_line_1, city, state, postal_code, latitude, longitude")
    .eq("organization_id", input.organizationId)
    .is("archived_at", null)
    .is("latitude", null)
    .limit(input.limit ?? 25);

  const pending = data ?? [];
  if (pending.length === 0) return { placed: 0, unplaced: [] };

  let placed = 0;
  const unplaced: UnplacedAddress[] = [];

  for (const row of pending) {
    const record = row as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    const address = [
      text(record.address_line_1),
      text(record.city),
      text(record.state),
      text(record.postal_code),
    ]
      .filter(Boolean)
      .join(", ");

    const result = await geocodeAddress(address);
    if (!result.ok) {
      // Google's own words. "Could not place this address" is true and
      // useless; REQUEST_DENIED or BILLING_NOT_ENABLED tells somebody which
      // console page to open.
      unplaced.push({
        address: address || "an address with nothing in it",
        reason: result.reason,
      });
      continue;
    }

    await database
      .from("properties")
      .update({
        latitude: result.coordinates.lat,
        longitude: result.coordinates.lng,
      })
      .eq("id", String(record.id));

    placed += 1;
  }

  return { placed, unplaced };
}
