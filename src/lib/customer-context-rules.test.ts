import test from "node:test";
import assert from "node:assert/strict";

import {
  EARLIER_TEXTS,
  earlierCallsForText,
  earlierContactForCall,
  earlierTexts,
  type EarlierCall,
  type EarlierText,
} from "./customer-context-rules.ts";

const now = new Date("2026-10-28T18:00:00Z");
const tz = "America/Los_Angeles";
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

const call = (over: Partial<EarlierCall> = {}): EarlierCall => ({
  at: daysAgo(2),
  intent: "visit",
  status: "new",
  description: "Breaker trips when the dryer runs",
  windowStart: "2026-10-29T15:00:00Z",
  windowEnd: "2026-10-29T17:00:00Z",
  address: "418 Alder Lane",
  ...over,
});

test("a first-time contact gets no note at all", () => {
  assert.equal(earlierContactForCall({ texts: [], calls: [], timeZone: tz, now }), "");
  assert.equal(earlierCallsForText({ calls: [], timeZone: tz, now }), "");
});

test("only the recent past is shared: an old thread or a future-dated row is left out", () => {
  const texts: EarlierText[] = [
    { direction: "inbound", body: "Old job from last year", at: daysAgo(45) },
    { direction: "inbound", body: "Not yet sent", at: new Date(now.getTime() + 60_000).toISOString() },
    { direction: "inbound", body: "My panel is buzzing", at: daysAgo(1) },
  ];
  const note = earlierContactForCall({ texts, calls: [call({ at: daysAgo(40) })], timeZone: tz, now });
  assert.match(note, /My panel is buzzing/);
  assert.doesNotMatch(note, /Old job|Not yet sent|Breaker trips/);
});

test("the newest texts are kept, oldest first, each on one line", () => {
  const texts: EarlierText[] = Array.from({ length: EARLIER_TEXTS + 5 }, (_, index) => ({
    direction: index % 2 ? "outbound" : "inbound",
    body: `message ${index}\nsecond line`,
    at: new Date(now.getTime() - (100 - index) * 60_000).toISOString(),
  }));
  const kept = earlierTexts(texts, now);
  assert.equal(kept.length, EARLIER_TEXTS);
  assert.equal(kept[0].body.startsWith("message 5"), true);
  const note = earlierContactForCall({ texts, calls: [], timeZone: tz, now });
  assert.match(note, /customer: message 16 second line/);
  assert.match(note, /business: message 15 second line/);
});

test("a call is told by what came of it", () => {
  const booked = earlierCallsForText({ calls: [call()], timeZone: tz, now });
  assert.match(booked, /called about: Breaker trips when the dryer runs\. A visit was booked for Thu, Oct 29, 8:00 AM at 418 Alder Lane\./);
  const callback = earlierCallsForText({ calls: [call({ intent: "callback", windowStart: null })], timeZone: tz, now });
  assert.match(callback, /asked for someone to call them back/);
  const cancelled = earlierCallsForText({ calls: [call({ status: "cancelled" })], timeZone: tz, now });
  assert.match(cancelled, /later cancelled/);
});
