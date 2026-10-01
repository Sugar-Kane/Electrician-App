import test from "node:test";
import assert from "node:assert/strict";

import { buildLegDirectionsUrl, mapsAppFor } from "./pilot-data.ts";

const AGENTS = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
  // What an iPad sends by default: it asks for the desktop site.
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  samsungInternet:
    "Mozilla/5.0 (Linux; Android 14; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
};

test("Apple devices get Apple Maps, whichever browser they use", () => {
  for (const agent of [AGENTS.iphoneSafari, AGENTS.iphoneChrome, AGENTS.ipad, AGENTS.macChrome]) {
    assert.equal(mapsAppFor(agent), "apple", agent);
  }
});

test("Android phones and Windows PCs get Google Maps", () => {
  for (const agent of [AGENTS.androidChrome, AGENTS.samsungInternet, AGENTS.edgeWindows]) {
    assert.equal(mapsAppFor(agent), "google", agent);
  }
});

test("one leg in Google Maps goes from the last stop to the next, by car", () => {
  const url = new URL(buildLegDirectionsUrl("google", "88 Calle Cielo, Nipomo, CA", "412 E Chapel St, Santa Maria, CA"));
  assert.equal(url.origin + url.pathname, "https://www.google.com/maps/dir/");
  assert.equal(url.searchParams.get("api"), "1");
  assert.equal(url.searchParams.get("origin"), "412 E Chapel St, Santa Maria, CA");
  assert.equal(url.searchParams.get("destination"), "88 Calle Cielo, Nipomo, CA");
  assert.equal(url.searchParams.get("travelmode"), "driving");
});

test("with no starting point, Google Maps starts from where the phone is", () => {
  const url = new URL(buildLegDirectionsUrl("google", "88 Calle Cielo, Nipomo, CA"));
  assert.equal(url.searchParams.get("origin"), null);
  assert.equal(url.searchParams.get("destination"), "88 Calle Cielo, Nipomo, CA");
});

test("one leg in Apple Maps is the same link as before", () => {
  const url = new URL(buildLegDirectionsUrl("apple", "88 Calle Cielo, Nipomo, CA", "412 E Chapel St, Santa Maria, CA"));
  assert.equal(url.host, "maps.apple.com");
  assert.equal(url.searchParams.get("saddr"), "412 E Chapel St, Santa Maria, CA");
  assert.equal(url.searchParams.get("daddr"), "88 Calle Cielo, Nipomo, CA");
  assert.equal(url.searchParams.get("dirflg"), "d");
});
