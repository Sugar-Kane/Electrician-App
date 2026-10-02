/**
 * What Google's answer to "where is this address?" means for the route map.
 *
 * The route page used to print Google's error once per address. When the key
 * itself was refused that was the same paragraph eleven times — "This API key
 * is not authorized to use this service or API…" — on a tablet in a truck,
 * about a setting none of those addresses could change. And it asked Google
 * again for every one of them, one after another, on every load.
 *
 * Google's statuses come in three kinds, and they want different handling:
 *
 * - About this address: no match, or a match somewhere the job says it is
 *   not. Somebody should look at the address; the next one may well be fine.
 * - About the setup: the key is refused, billing is off, a daily cap is spent.
 *   Every other address would get the same answer, so asking again is waste,
 *   and the fix is in Google's console rather than on a job.
 * - Google not answering: an outage, a rate limit, a timeout. Also the same
 *   for every address until it passes, so stop and try on the next load.
 *
 * Import-free, so the reading can be tested without a request.
 */

import { hasCoordinates, type Coordinates } from "./coordinates.ts";
import { US_STATES } from "./us-states.ts";

export type GeocodeAnswer =
  | { kind: "placed"; coordinates: Coordinates; formatted: string }
  /** This address: somebody should check it. Other addresses may be fine. */
  | { kind: "missed"; reason: string }
  /**
   * Every address would get the same answer. `reason` is for whoever is
   * looking at the map; `detail` is Google's own words, for whoever fixes it.
   */
  | { kind: "setup" | "unavailable"; reason: string; detail: string };

export type StoppingAnswer = Extract<GeocodeAnswer, { kind: "setup" | "unavailable" }>;

/** The part of a Geocoding API response this reads. */
export type GeocodePayload = {
  status?: string;
  error_message?: string;
  results?: {
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
    address_components?: { long_name?: string; short_name?: string; types?: string[] }[];
  }[];
};

/** An address Google answered for but could not put on the map. */
export type UnplacedAddress = { id: string; address: string; reason: string };

/** What placing a business's saved addresses turned up, for the route page. */
export type PlacingReport = {
  placed: number;
  unplaced: UnplacedAddress[];
  /** Why the rest are still waiting, when something stopped the lookups. */
  problem: { kind: StoppingAnswer["kind"]; reason: string; detail: string } | null;
  /** Saved addresses left without a place because of `problem`. */
  waiting: number;
};

export const NOTHING_TO_PLACE: PlacingReport = { placed: 0, unplaced: [], problem: null, waiting: 0 };

/*
 * Google's words for each status, from the Geocoding API's reference, put the
 * way somebody standing in a driveway would want them.
 */
const SETUP_REASONS: Record<string, string> = {
  // A key not allowed this API, the API switched off in the project, an
  // invalid key, or billing never enabled: all of them settings in Google's
  // console, and Google's own message says which.
  REQUEST_DENIED: "Google turned down the lookup because of a setting in Volteira's Google account.",
  OVER_DAILY_LIMIT:
    "Google turned down the lookup: Volteira's Google account has reached a usage limit or has a billing problem.",
};

const UNAVAILABLE_REASONS: Record<string, string> = {
  OVER_QUERY_LIMIT: "Google asked for fewer lookups at a time.",
  UNKNOWN_ERROR: "Google's address lookup had a problem of its own.",
};

const MISSED_REASONS: Record<string, string> = {
  ZERO_RESULTS: "Google couldn't find this address. Check the street, city and ZIP on the job.",
  INVALID_REQUEST: "There isn't enough of an address to look up.",
};

/** "CA", from "CA", "Ca" or "California". Null for anything else, which is not checked. */
export function stateCode(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  const match = US_STATES.find(
    (state) => state.code === text.toUpperCase() || state.name.toLowerCase() === text.toLowerCase(),
  );
  return match?.code ?? null;
}

function stateName(code: string): string {
  return US_STATES.find((state) => state.code === code)?.name ?? code;
}

/** Google's status and message on one line, as Google wrote them. */
function googleWords(payload: GeocodePayload, httpStatus?: number): string {
  const parts = [payload.status, payload.error_message].filter(Boolean);
  if (parts.length > 0) return parts.join(" · ");
  return httpStatus ? `HTTP ${httpStatus}, with no status from Google.` : "No status from Google.";
}

/**
 * One response, read.
 *
 * `savedState` is the state on the job. A match in a different state is not
 * placed: Google answering "100 W Wall St, Midland, CA, 79701" with the
 * Midland in Texas would put a stop a thousand miles from the rest of the day
 * and draw the route to it, and the job's address is what needs fixing.
 */
export function readGeocodeAnswer(
  payload: GeocodePayload | null | undefined,
  options: { savedState?: string | null; httpStatus?: number } = {},
): GeocodeAnswer {
  if (!payload || typeof payload !== "object") {
    return {
      kind: "unavailable",
      reason: "Google's address lookup sent back something that wasn't an answer.",
      detail: options.httpStatus ? `HTTP ${options.httpStatus}, with no readable body.` : "No readable body.",
    };
  }

  const status = payload.status ?? "";

  if (status === "OK") {
    const best = payload.results?.[0];
    if (!best) return { kind: "missed", reason: MISSED_REASONS.ZERO_RESULTS! };

    const location = best.geometry?.location;
    const coordinates = { lat: Number(location?.lat), lng: Number(location?.lng) };
    if (!hasCoordinates(coordinates)) {
      return { kind: "missed", reason: "Google answered without a usable location for this address." };
    }

    const formatted = best.formatted_address ?? "";
    const saved = stateCode(options.savedState);
    const found = best.address_components?.find((component) =>
      component.types?.includes("administrative_area_level_1"),
    );
    const foundCode = (found?.short_name ?? "").trim().toUpperCase();
    if (saved && foundCode && foundCode !== saved) {
      return {
        kind: "missed",
        reason:
          `Google's closest match is in ${stateName(foundCode)}, but the job says ${stateName(saved)}` +
          `${formatted ? ` (${formatted})` : ""}. Check the address on the job.`,
      };
    }

    return { kind: "placed", coordinates, formatted };
  }

  if (MISSED_REASONS[status]) return { kind: "missed", reason: MISSED_REASONS[status]! };

  if (SETUP_REASONS[status]) {
    return { kind: "setup", reason: SETUP_REASONS[status]!, detail: googleWords(payload, options.httpStatus) };
  }

  // Rate limits, Google's own errors, and any status this has never heard of:
  // stop, and try again on the next load rather than guess.
  return {
    kind: "unavailable",
    reason: UNAVAILABLE_REASONS[status] ?? "Google's address lookup had a problem of its own.",
    detail: googleWords(payload, options.httpStatus),
  };
}

/** Whether the rest of the addresses would get this answer too. */
export function stopsTheRun(answer: GeocodeAnswer): answer is StoppingAnswer {
  return answer.kind === "setup" || answer.kind === "unavailable";
}

/**
 * Look up every address: one on its own, then a few at a time, stopping as
 * soon as an answer means the rest would be refused too.
 *
 * The first goes alone so that a refused key costs one request a page load
 * rather than one per waiting address. After that, a few at once, because the
 * page waits for these and one at a time is a second or more for a new day.
 */
export async function lookUpInTurns<T>(
  items: readonly T[],
  lookUp: (item: T) => Promise<GeocodeAnswer>,
  options: { atOnce?: number } = {},
): Promise<{
  answered: { item: T; answer: GeocodeAnswer }[];
  stoppedBy: StoppingAnswer | null;
  notAsked: T[];
}> {
  const atOnce = Math.max(1, Math.floor(options.atOnce ?? 4));
  const answered: { item: T; answer: GeocodeAnswer }[] = [];

  let next = 0;
  let turnSize = 1;
  while (next < items.length) {
    const turn = items.slice(next, next + turnSize);
    next += turn.length;

    const answers = await Promise.all(
      turn.map((item) =>
        lookUp(item).catch(
          (error: unknown): GeocodeAnswer => ({
            kind: "unavailable",
            reason: "Google's address lookup couldn't be reached.",
            detail: error instanceof Error ? error.message : String(error),
          }),
        ),
      ),
    );
    turn.forEach((item, index) => answered.push({ item, answer: answers[index]! }));

    const stop = answers.find(stopsTheRun);
    if (stop) return { answered, stoppedBy: stop, notAsked: items.slice(next) };

    turnSize = atOnce;
  }

  return { answered, stoppedBy: null, notAsked: [] };
}
