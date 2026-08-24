import test from "node:test";
import assert from "node:assert/strict";

import {
  isCompleteAddress,
  readAddressParts,
  readSuggestions,
  shouldSearch,
} from "./address-search.ts";

test("a query is only worth sending once it is about a place", () => {
  assert.equal(shouldSearch(""), false);
  assert.equal(shouldSearch("1"), false);
  assert.equal(shouldSearch("12"), false);
  assert.equal(shouldSearch("  12  "), false);
  assert.equal(shouldSearch("123"), true);
  assert.equal(shouldSearch("123 re"), true);
});

test("suggestions keep the street and the town apart", () => {
  const suggestions = readSuggestions({
    suggestions: [
      {
        placePrediction: {
          placeId: "place-1",
          text: { text: "123 Red Gum Lane, Nipomo, CA 93444, USA" },
          structuredFormat: {
            mainText: { text: "123 Red Gum Lane" },
            secondaryText: { text: "Nipomo, CA, USA" },
          },
        },
      },
    ],
  });

  assert.equal(suggestions.length, 1);
  assert.deepEqual(suggestions[0], {
    id: "place-1",
    label: "123 Red Gum Lane, Nipomo, CA 93444, USA",
    primary: "123 Red Gum Lane",
    secondary: "Nipomo, CA, USA",
  });
});

test("a suggestion with no place id is dropped rather than shown", () => {
  const suggestions = readSuggestions({
    suggestions: [
      { placePrediction: { text: { text: "Somewhere" } } },
      { queryPrediction: { text: { text: "pizza near me" } } },
      { placePrediction: { placeId: "keeper", structuredFormat: { mainText: { text: "1 A St" } } } },
    ],
  });

  assert.deepEqual(
    suggestions.map((entry) => entry.id),
    ["keeper"],
  );
  // No `text` on that one, so the label falls back to the street.
  assert.equal(suggestions[0]?.label, "1 A St");
});

test("nothing at all comes back as an empty list rather than throwing", () => {
  for (const payload of [null, undefined, "", 7, {}, { suggestions: "no" }]) {
    assert.deepEqual(readSuggestions(payload), []);
  }
});

test("the four columns come out of the address components", () => {
  const parts = readAddressParts({
    addressComponents: [
      { longText: "123", shortText: "123", types: ["street_number"] },
      { longText: "Red Gum Lane", shortText: "Red Gum Ln", types: ["route"] },
      { longText: "Nipomo", shortText: "Nipomo", types: ["locality", "political"] },
      { longText: "California", shortText: "CA", types: ["administrative_area_level_1"] },
      { longText: "93444", shortText: "93444", types: ["postal_code"] },
      { longText: "1234", shortText: "1234", types: ["postal_code_suffix"] },
      { longText: "United States", shortText: "US", types: ["country"] },
    ],
  });

  assert.deepEqual(parts, {
    // The long form of the street, which is how it is read out loud.
    line1: "123 Red Gum Lane",
    city: "Nipomo",
    // Short, because the column holds two characters.
    state: "CA",
    // Five digits. The +4 is a separate component and stays out.
    postalCode: "93444",
  });
});

test("an address with no locality falls back rather than coming back townless", () => {
  const parts = readAddressParts({
    addressComponents: [
      { longText: "45", types: ["street_number"] },
      { longText: "Oak Road", types: ["route"] },
      { longText: "Los Osos", types: ["postal_town"] },
      { longText: "California", shortText: "CA", types: ["administrative_area_level_1"] },
      { longText: "93402", types: ["postal_code"] },
    ],
  });

  assert.equal(parts.city, "Los Osos");
  assert.equal(parts.line1, "45 Oak Road");
});

test("a place with no street number still gives the street", () => {
  const parts = readAddressParts({
    addressComponents: [
      { longText: "Willow Creek Road", types: ["route"] },
      { longText: "Nipomo", types: ["locality"] },
      { longText: "California", shortText: "CA", types: ["administrative_area_level_1"] },
      { longText: "93444", types: ["postal_code"] },
    ],
  });

  assert.equal(parts.line1, "Willow Creek Road");
});

test("a malformed details payload reads as four empty strings", () => {
  for (const payload of [null, undefined, {}, { addressComponents: 3 }]) {
    assert.deepEqual(readAddressParts(payload), {
      line1: "",
      city: "",
      state: "",
      postalCode: "",
    });
  }
});

test("an address is only complete when the properties table would take it", () => {
  const full = { line1: "123 Red Gum Lane", city: "Nipomo", state: "CA", postalCode: "93444" };
  assert.equal(isCompleteAddress(full), true);
  assert.equal(isCompleteAddress({ ...full, postalCode: "" }), false);
  assert.equal(isCompleteAddress({ ...full, city: "" }), false);
});
