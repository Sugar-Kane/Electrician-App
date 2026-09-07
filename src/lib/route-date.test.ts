import test from "node:test";
import assert from "node:assert/strict";

import { routeDateFor } from "./route-date.ts";

const jobs = [
  { id: "unscheduled", date: "", status: "New" },
  { id: "today", date: "2026-09-07", status: "Booked" },
  { id: "future", date: "2026-09-09", status: "Booked" },
  { id: "canceled", date: "2026-09-12", status: "Canceled" },
];

test("a scheduled focused job selects its service day", () => {
  assert.equal(
    routeDateFor({ jobs, today: "2026-09-07", focusJobId: "future" }),
    "2026-09-09",
  );
});

test("an unscheduled focused job falls back to today's active work", () => {
  assert.equal(
    routeDateFor({ jobs, today: "2026-09-07", focusJobId: "unscheduled" }),
    "2026-09-07",
  );
});

test("a canceled focused job does not choose its canceled service day", () => {
  assert.equal(
    routeDateFor({ jobs, today: "2026-09-07", focusJobId: "canceled" }),
    "2026-09-07",
  );
});

test("the next active service day is shown when today has no work", () => {
  assert.equal(
    routeDateFor({
      jobs: jobs.filter((job) => job.id !== "today"),
      today: "2026-09-07",
    }),
    "2026-09-09",
  );
});

test("an empty schedule stays on today", () => {
  assert.equal(routeDateFor({ jobs: [], today: "2026-09-07" }), "2026-09-07");
});
