import test from "node:test";
import assert from "node:assert/strict";

import { formatForDisplay, isSendablePhone, toE164 } from "./phone-format.ts";

test("a mobile typed the way a person writes it becomes sendable", () => {
  // Every one of these is how somebody might write the same number down.
  for (const written of [
    "209-626-9313",
    "(209) 626-9313",
    "209.626.9313",
    "209 626 9313",
    "2096269313",
    " 209-626-9313 ",
  ]) {
    assert.equal(toE164(written), "+12096269313", written);
  }
});

test("the country code is accepted whether or not it is already there", () => {
  for (const written of ["12096269313", "1 209 626 9313", "+1 (209) 626-9313", "+12096269313"]) {
    assert.equal(toE164(written), "+12096269313", written);
  }
});

test("an international number typed correctly is left alone", () => {
  // Refusing these would be worse than the problem being fixed.
  assert.equal(toE164("+442071838750"), "+442071838750");
  assert.equal(toE164("+61 2 9374 4000"), "+61293744000");
});

test("a number that cannot be dialled comes back empty rather than guessed at", () => {
  // Empty is the honest answer. Storing something unsendable would make the
  // settings page claim alerts are configured when nothing can arrive.
  for (const written of [
    "",
    "   ",
    "555-1234",
    "12345",
    "209-626-931",
    "209-626-93134444444444",
    "not a phone",
    "+",
    "+0123456789",
  ]) {
    assert.equal(toE164(written), "", JSON.stringify(written));
  }
});

test("an extension is refused, because the digits would silently change the number", () => {
  // "209-626-9313 x204" strips to 2096269313204, which is not that number.
  assert.equal(toE164("209-626-9313 x204"), "");
});

test("a leading plus is believed rather than overridden with +1", () => {
  // Somebody who typed a country code knows better than our guess.
  assert.equal(toE164("+33 1 42 68 53 00"), "+33142685300");
  assert.doesNotMatch(toE164("+33 1 42 68 53 00"), /^\+1\d/);
});

test("sendability is the same question as normalising", () => {
  assert.equal(isSendablePhone("209-626-9313"), true);
  assert.equal(isSendablePhone("555-1234"), false);
  assert.equal(isSendablePhone(""), false);
});

test("what is shown back is what a person recognises as their own number", () => {
  assert.equal(formatForDisplay("+12096269313"), "(209) 626-9313");
  assert.equal(formatForDisplay("2096269313"), "(209) 626-9313");
});

test("a number we cannot format is shown as given rather than blanked", () => {
  // Losing what somebody typed is worse than showing it unformatted.
  assert.equal(formatForDisplay("+442071838750"), "+442071838750");
  assert.equal(formatForDisplay("555-1234"), "555-1234");
});
