/**
 * Whether a stored pair is a place, or the absence of one.
 *
 * Properties created from a phone call carry null coordinates, and the job
 * mapper used to read those as `0, 0`. That is a real point — a stretch of the
 * Atlantic off West Africa — so nothing complained until something plotted it.
 *
 * Exactly both-zero is therefore treated as missing. Import-free, because the
 * rule matters more than the service that produces the numbers.
 */

export type Coordinates = { lat: number; lng: number };

export function hasCoordinates(
  value: { lat: number | null; lng: number | null } | null | undefined,
): value is Coordinates {
  if (!value) return false;
  const { lat, lng } = value;
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** Google and Apple both accept a bare "lat,lng" as an origin or destination. */
export function formatPoint(point: Coordinates): string {
  return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}
