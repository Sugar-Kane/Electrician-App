import test from "node:test";
import assert from "node:assert/strict";

import { isPublicPath, signInPath } from "./public-paths.ts";

test("the business's own pages need somebody signed in", () => {
  for (const path of ["/", "/jobs/15", "/schedule", "/invoices", "/invoices/abc", "/inventory", "/materials", "/messages",
    "/customers/7", "/files", "/reports", "/settings/contract", "/account", "/assistant", "/booking-requests", "/onboarding",
    "/admin", "/technicians", "/route", "/search", "/supply-stops", "/jobs/new"]) {
    assert.equal(isPublicPath(path), false, path);
  }
});

test("what customers, strangers and webhooks are sent to stays open", () => {
  for (const path of ["/login", "/signup", "/auth/callback", "/book/pacific-plains", "/book/by-host/confirmation",
    "/booking/0b9c/pay", "/contract/5f2a", "/invite/91ab", "/journal/pacific-plains/first-post", "/legal/pacific-plains/terms",
    "/api/twilio/inbound", "/api/stripe/webhook", "/robots.txt", "/sitemap.xml", "/login/"]) {
    assert.equal(isPublicPath(path), true, path);
  }
});

test("a public word inside a private page does not open it", () => {
  // "/booking-requests" is the business's inbox, not the customer's booking page.
  assert.equal(isPublicPath("/booking-requests"), false);
  assert.equal(isPublicPath("/jobs/book"), false);
  assert.equal(isPublicPath("/settings/legal"), false);
  assert.equal(isPublicPath("/loginx"), false);
});

test("signing in sends them back to what they asked for", () => {
  assert.equal(signInPath("/"), "/login");
  assert.equal(signInPath("/jobs/15"), "/login?next=%2Fjobs%2F15");
  assert.equal(signInPath("/schedule", "?view=week"), "/login?next=%2Fschedule%3Fview%3Dweek");
});
