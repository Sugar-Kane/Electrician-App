/** CT-LICENSE-001: a lapsed or unchecked contractor license is surfaced before billing. */
import test from "node:test";
import assert from "node:assert/strict";

import { licenseBillingRefusal, licenseWarning } from "../lib/license-status.ts";

const now = new Date("2026-11-28T18:00:00Z");
const today = "2026-11-28";
const good = { number: "1162180", status: "active", expiresOn: "2027-06-30", verifiedOn: "2026-11-01", acknowledgedAt: null };

test("CT-LICENSE-001: an active, recently checked license warns of nothing and billing goes on", () => {
  assert.deepEqual(licenseWarning(good, today, now), { level: "none" });
  assert.equal(licenseBillingRefusal(licenseWarning(good, today, now)), "");
});

test("CT-LICENSE-001: missing details or a check older than 90 days is a reminder, never a block", () => {
  for (const license of [
    { ...good, status: null },
    { ...good, expiresOn: null },
    { ...good, verifiedOn: null },
    { ...good, verifiedOn: "2026-08-29" },
    { ...good, number: "" },
  ]) {
    const warning = licenseWarning(license, today, now);
    assert.equal(warning.level, "stale", JSON.stringify(license));
    assert.equal(licenseBillingRefusal(warning), "");
  }
  assert.equal(licenseWarning({ ...good, verifiedOn: "2026-08-30" }, today, now).level, "none");
});

test("CT-LICENSE-001: a license recorded as lapsed holds billing until acknowledged, for a week at most", () => {
  for (const license of [{ ...good, status: "expired" }, { ...good, status: "suspended" }, { ...good, expiresOn: "2026-11-27" }]) {
    const warning = licenseWarning(license, today, now);
    assert.equal(warning.level, "lapsed", JSON.stringify(license));
    assert.match(licenseBillingRefusal(warning), /acknowledge/);
  }
  // Expiring today is still valid today.
  assert.equal(licenseWarning({ ...good, expiresOn: today }, today, now).level, "none");
  const ackedYesterday = licenseWarning({ ...good, status: "inactive", acknowledgedAt: "2026-11-27T18:00:00Z" }, today, now);
  assert.equal(licenseBillingRefusal(ackedYesterday), "");
  const ackedLongAgo = licenseWarning({ ...good, status: "inactive", acknowledgedAt: "2026-11-20T18:00:00Z" }, today, now);
  assert.notEqual(licenseBillingRefusal(ackedLongAgo), "");
});
