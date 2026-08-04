import "server-only";

type ZipCoordinates = { latitude: number; longitude: number };

export type ServiceAreaResult = {
  status: "inside" | "outside" | "unverified";
  distanceMiles: number | null;
};

async function getZipCoordinates(postalCode: string): Promise<ZipCoordinates | null> {
  const zip = postalCode.slice(0, 5);

  try {
    const response = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`, {
      cache: "force-cache",
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      places?: Array<{ latitude?: string; longitude?: string }>;
    };
    const latitude = Number(payload.places?.[0]?.latitude);
    const longitude = Number(payload.places?.[0]?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  } catch {
    return null;
  }
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceInMiles(origin: ZipCoordinates, destination: ZipCoordinates) {
  const earthRadiusMiles = 3_958.8;
  const latitudeDelta = toRadians(destination.latitude - origin.latitude);
  const longitudeDelta = toRadians(destination.longitude - origin.longitude);
  const originLatitude = toRadians(origin.latitude);
  const destinationLatitude = toRadians(destination.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(haversine));
}

export async function checkServiceArea(
  originPostalCode: string,
  destinationPostalCode: string,
  radiusMiles: number,
): Promise<ServiceAreaResult> {
  const [origin, destination] = await Promise.all([
    getZipCoordinates(originPostalCode),
    getZipCoordinates(destinationPostalCode),
  ]);

  if (!origin || !destination) {
    return { status: "unverified", distanceMiles: null };
  }

  const distanceMiles = Math.round(distanceInMiles(origin, destination) * 10) / 10;
  return {
    status: distanceMiles <= radiusMiles ? "inside" : "outside",
    distanceMiles,
  };
}
