import test from "node:test";
import assert from "node:assert/strict";

import {
  SCHEDULE_VIEWS,
  asScheduleView,
  daysPerStep,
  scheduleHref,
} from "./schedule-view.ts";

test("a view name out of the URL is one of the four, or the day", () => {
  for (const view of SCHEDULE_VIEWS) {
    assert.equal(asScheduleView(view.value), view.value);
  }

  // Somebody editing the URL by hand should land on their day, not an error.
  assert.equal(asScheduleView(""), "day");
  assert.equal(asScheduleView("year"), "day");
  assert.equal(asScheduleView("DAY"), "day");
});

test("the day arrow moves a day and the week arrow moves a week", () => {
  // It used to move seven either way, while the button said "Next day" — so
  // the strip jumped a whole week and landed on the same weekday, which is why
  // the highlight looked stuck to the Monday.
  assert.equal(daysPerStep("day"), 1);
  assert.equal(daysPerStep("week"), 7);
  assert.equal(daysPerStep("crew"), 7);
});

test("a link to a day in a view says both", () => {
  assert.equal(scheduleHref("2026-08-25", "week"), "/schedule?date=2026-08-25&view=week");
  // The view survives the link. Day links used to omit it, so opening a day
  // from the month grid silently dropped you back into the day view.
  assert.equal(scheduleHref("2026-08-25", "crew"), "/schedule?date=2026-08-25&view=crew");
});

test("every view has a label somebody can read", () => {
  for (const view of SCHEDULE_VIEWS) {
    assert.ok(view.label.trim().length > 0, view.value);
    assert.equal(asScheduleView(view.value), view.value);
  }
  assert.equal(SCHEDULE_VIEWS[0]?.value, "day", "the day is the one people open first");
});
