import test from "node:test";
import assert from "node:assert/strict";

import {
  lookUpInTurns,
  readGeocodeAnswer,
  stateCode,
  stopsTheRun,
  type GeocodeAnswer,
  type GeocodePayload,
} from "./geocode-answer.ts";

// What Google sent production for every address on the route page, word for word.
const KEY_REFUSED: GeocodePayload = {
  status: "REQUEST_DENIED",
  error_message:
    "This API key is not authorized to use this service or API. Please check the API restrictions settings of your API key in the Google Cloud Console to ensure that all of the APIs and services you need to use are correctly specified in the list of enabled APIs. For more information, see https://developers.google.com/maps/api-key-best-practices.",
  results: [],
};

const match = (state: string, formatted: string, lat = 34.953, lng = -120.436): GeocodePayload => ({
  status: "OK",
  results: [
    {
      formatted_address: formatted,
      geometry: { location: { lat, lng } },
      address_components: [
        { long_name: state === "TX" ? "Texas" : "California", short_name: state, types: ["administrative_area_level_1", "political"] },
        { long_name: "United States", short_name: "US", types: ["country", "political"] },
      ],
    },
  ],
});

test("a match is placed, with Google's spelling of the address", () => {
  const answer = readGeocodeAnswer(match("CA", "412 E Chapel St, Santa Maria, CA 93454, USA"), { savedState: "CA" });
  assert.deepEqual(answer, {
    kind: "placed",
    coordinates: { lat: 34.953, lng: -120.436 },
    formatted: "412 E Chapel St, Santa Maria, CA 93454, USA",
  });
});

test("a refused key is a setup problem, with Google's own words kept for whoever fixes it", () => {
  const answer = readGeocodeAnswer(KEY_REFUSED);
  assert.equal(answer.kind, "setup");
  assert.ok(stopsTheRun(answer));
  if (answer.kind !== "setup") return;
  // Plain words for the person at the map, not Google's paragraph.
  assert.doesNotMatch(answer.reason, /API key|Cloud Console/);
  assert.match(answer.detail, /^REQUEST_DENIED · This API key is not authorized/);
});

test("a spent daily limit or billing problem is setup too", () => {
  const answer = readGeocodeAnswer({ status: "OVER_DAILY_LIMIT", error_message: "You have exceeded your daily request quota for this API." });
  assert.equal(answer.kind, "setup");
  assert.ok(stopsTheRun(answer));
});

test("Google not answering stops the run without blaming the address", () => {
  for (const status of ["OVER_QUERY_LIMIT", "UNKNOWN_ERROR", "SOMETHING_NEW"]) {
    const answer = readGeocodeAnswer({ status });
    assert.equal(answer.kind, "unavailable", status);
    assert.ok(stopsTheRun(answer), status);
  }
  // Nothing readable at all: a proxy's error page, an empty body.
  const nothing = readGeocodeAnswer(null, { httpStatus: 502 });
  assert.equal(nothing.kind, "unavailable");
  if (nothing.kind === "unavailable") assert.match(nothing.detail, /HTTP 502/);
});

test("no match is about this address, and does not stop the others", () => {
  const answer = readGeocodeAnswer({ status: "ZERO_RESULTS", results: [] });
  assert.equal(answer.kind, "missed");
  assert.equal(stopsTheRun(answer), false);
  if (answer.kind === "missed") assert.match(answer.reason, /couldn't find this address/);

  assert.equal(readGeocodeAnswer({ status: "INVALID_REQUEST" }).kind, "missed");
  // OK with nothing in it is no match, not a place.
  assert.equal(readGeocodeAnswer({ status: "OK", results: [] }).kind, "missed");
});

test("a match with no usable location is not placed in the ocean", () => {
  const atNullIsland = match("CA", "Somewhere", 0, 0);
  assert.equal(readGeocodeAnswer(atNullIsland, { savedState: "CA" }).kind, "missed");
  const noGeometry: GeocodePayload = { status: "OK", results: [{ formatted_address: "Somewhere" }] };
  assert.equal(readGeocodeAnswer(noGeometry).kind, "missed");
});

test("a match in another state is not placed: the job's address needs fixing", () => {
  // Saved as CA, with a Texas city and ZIP: the state is the typo.
  const answer = readGeocodeAnswer(match("TX", "100 W Wall St, Midland, TX 79701, USA", 32.0, -102.08), {
    savedState: "CA",
  });
  assert.equal(answer.kind, "missed");
  if (answer.kind !== "missed") return;
  assert.match(answer.reason, /in Texas, but the job says California/);
  assert.match(answer.reason, /100 W Wall St, Midland, TX 79701, USA/);
});

test("the saved state is read however it was typed, and not checked when it is missing", () => {
  const santaMaria = match("CA", "Santa Maria, CA, USA");
  assert.equal(readGeocodeAnswer(santaMaria, { savedState: "Ca" }).kind, "placed");
  assert.equal(readGeocodeAnswer(santaMaria, { savedState: "california" }).kind, "placed");
  assert.equal(readGeocodeAnswer(santaMaria, { savedState: "" }).kind, "placed");
  assert.equal(readGeocodeAnswer(santaMaria, { savedState: null }).kind, "placed");
  // Not a state at all: nothing to compare with, so Google's answer stands.
  assert.equal(readGeocodeAnswer(santaMaria, { savedState: "Cali" }).kind, "placed");

  assert.equal(stateCode("tx"), "TX");
  assert.equal(stateCode(" Texas "), "TX");
  assert.equal(stateCode("Cali"), null);
});

const fakeLookUp = (answers: Record<string, GeocodeAnswer>) => {
  const asked: string[] = [];
  let inFlight = 0;
  let mostAtOnce = 0;
  const lookUp = async (address: string): Promise<GeocodeAnswer> => {
    asked.push(address);
    inFlight += 1;
    mostAtOnce = Math.max(mostAtOnce, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return answers[address] ?? { kind: "placed", coordinates: { lat: 35, lng: -120 }, formatted: address };
  };
  return { lookUp, asked, mostAtOnce: () => mostAtOnce };
};

const refused = readGeocodeAnswer(KEY_REFUSED);
const ADDRESSES = Array.from({ length: 11 }, (_, index) => `${index + 1} Main St`);

test("a refused key costs one request, not one per waiting address", async () => {
  const google = fakeLookUp(Object.fromEntries(ADDRESSES.map((address) => [address, refused])));
  const result = await lookUpInTurns(ADDRESSES, google.lookUp);
  assert.deepEqual(google.asked, ["1 Main St"]);
  assert.equal(result.stoppedBy?.kind, "setup");
  assert.equal(result.answered.length, 1);
  assert.equal(result.notAsked.length, 10);
});

test("with Google answering, every address is asked, a few at a time", async () => {
  const google = fakeLookUp({ "3 Main St": { kind: "missed", reason: "no match" } });
  const result = await lookUpInTurns(ADDRESSES, google.lookUp, { atOnce: 4 });
  assert.equal(result.stoppedBy, null);
  assert.equal(result.answered.length, 11);
  assert.deepEqual(result.notAsked, []);
  assert.equal(google.asked.length, 11);
  assert.equal(google.mostAtOnce(), 4);
  // One bad address is that address's problem.
  assert.equal(result.answered.filter(({ answer }) => answer.kind === "missed").length, 1);
});

test("a refusal part-way through stops after that turn", async () => {
  const google = fakeLookUp({ "4 Main St": refused });
  const result = await lookUpInTurns(ADDRESSES, google.lookUp, { atOnce: 4 });
  // The first alone, then 2–5 together; 4 is refused, so nothing after 5 is asked.
  assert.deepEqual(google.asked, ["1 Main St", "2 Main St", "3 Main St", "4 Main St", "5 Main St"]);
  assert.equal(result.stoppedBy?.kind, "setup");
  assert.equal(result.notAsked.length, 6);
});

test("a lookup that throws is Google not answering, not a crash", async () => {
  const result = await lookUpInTurns(["1 Main St", "2 Main St"], async () => {
    throw new Error("fetch failed");
  });
  assert.equal(result.stoppedBy?.kind, "unavailable");
  assert.equal(result.stoppedBy?.detail, "fetch failed");
  assert.equal(result.notAsked.length, 1);
});

test("nothing to look up asks nothing", async () => {
  const google = fakeLookUp({});
  const result = await lookUpInTurns([], google.lookUp);
  assert.deepEqual(result, { answered: [], stoppedBy: null, notAsked: [] });
  assert.equal(google.asked.length, 0);
});
