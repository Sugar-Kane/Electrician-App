import test from "node:test";
import assert from "node:assert/strict";

import { daysSince, diagnose, headline, type HealthInput } from "./admin-health.ts";

const NOW = new Date("2026-08-11T12:00:00Z");

const HEALTHY: HealthInput = {
  memberCount: 1,
  pendingInvitations: 0,
  bookingCount: 4,
  lastBookingAt: "2026-08-10T18:00:00Z",
  ownerEmail: "nick@example.com",
  ownerPhone: "805-555-0142",
  messagingServiceSid: "MG123",
  a2pRegistered: true,
  legalPublished: true,
  archived: false,
};

test("a business with everything set has nothing to report", () => {
  assert.deepEqual(diagnose(HEALTHY, NOW), []);
  assert.deepEqual(headline([]), { label: "Working", severity: "ok" });
});

test("nobody signed in is blocking, and says whether an invitation is outstanding", () => {
  const waiting = diagnose({ ...HEALTHY, memberCount: 0, pendingInvitations: 1 }, NOW);
  assert.equal(waiting[0]?.severity, "blocking");
  assert.match(waiting[0]!.detail, /1 invitation sent/);

  const nobody = diagnose({ ...HEALTHY, memberCount: 0, pendingInvitations: 0 }, NOW);
  assert.match(nobody[0]!.detail, /no members and no pending invitations/);
});

test("two outstanding invitations are plural", () => {
  const findings = diagnose({ ...HEALTHY, memberCount: 0, pendingInvitations: 2 }, NOW);
  assert.match(findings[0]!.detail, /2 invitations sent/);
});

test("no alert address at all is blocking, because a booking would reach nobody", () => {
  const findings = diagnose({ ...HEALTHY, ownerEmail: "", ownerPhone: "" }, NOW);
  const alert = findings.find((finding) => finding.title === "Booking alerts go nowhere");
  assert.equal(alert?.severity, "blocking");
});

test("a phone but no email is only degraded, and says why email matters more", () => {
  const findings = diagnose({ ...HEALTHY, ownerEmail: "" }, NOW);
  const alert = findings.find((finding) => finding.title === "No booking-alert email");
  assert.equal(alert?.severity, "degraded");
  assert.match(alert!.detail, /email is the channel that works/);
});

test("an email and no phone is fine, because email is the channel that arrives", () => {
  assert.deepEqual(diagnose({ ...HEALTHY, ownerPhone: "" }, NOW), []);
});

test("unrecorded A2P is a note, and warns against reading it as proof texts fail", () => {
  // a2p_registered_at is filled in by hand. A business whose texts are being
  // delivered can still have it null, and calling that "blocked" sends support
  // to the wrong console.
  const findings = diagnose({ ...HEALTHY, a2pRegistered: false }, NOW);
  const a2p = findings.find((finding) => finding.title === "No A2P approval recorded");
  assert.equal(a2p?.severity, "note");
  assert.match(a2p!.detail, /not proof that texts fail/);
  assert.match(a2p!.detail, /30034/);

  // A note must not make the business look broken at a glance.
  assert.equal(headline(findings).severity, "ok");
});

test("no messaging service reports that, not the A2P problem underneath it", () => {
  // Telling somebody their campaign is unapproved when they never had a
  // messaging service sends them to the wrong console.
  const findings = diagnose({ ...HEALTHY, messagingServiceSid: "", a2pRegistered: false }, NOW);
  assert.ok(findings.some((finding) => finding.title === "No messaging service"));
  assert.ok(!findings.some((finding) => finding.title.includes("A2P")));
});

test("blocking findings sort above degraded ones", () => {
  const findings = diagnose(
    { ...HEALTHY, memberCount: 0, a2pRegistered: false, ownerEmail: "", ownerPhone: "" },
    NOW,
  );
  const severities = findings.map((finding) => finding.severity);
  assert.deepEqual([...severities].sort((a, b) => severities.indexOf(a) - severities.indexOf(b)), severities);
  assert.equal(findings[0]?.severity, "blocking");
});

test("the headline is the first blocking problem, not a count", () => {
  const findings = diagnose({ ...HEALTHY, memberCount: 0, ownerEmail: "", ownerPhone: "" }, NOW);
  assert.equal(headline(findings).severity, "blocking");
  assert.equal(headline(findings).label, "Nobody can sign in");
});

test("several degraded problems collapse into a count rather than picking one", () => {
  const findings = diagnose({ ...HEALTHY, ownerEmail: "", messagingServiceSid: "" }, NOW);
  assert.deepEqual(headline(findings), { label: "2 things need attention", severity: "degraded" });
});

test("an archived business reports only that, and stops", () => {
  // Everything else about it is irrelevant and would read as a to-do list.
  const findings = diagnose(
    { ...HEALTHY, archived: true, memberCount: 0, ownerEmail: "", ownerPhone: "" },
    NOW,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.title, "Archived");
});

test("never having booked is a note, not a fault", () => {
  const findings = diagnose({ ...HEALTHY, bookingCount: 0, lastBookingAt: "" }, NOW);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "note");
  assert.equal(headline(findings).severity, "ok");
});

test("a month of silence is worth mentioning; a day is not", () => {
  const quiet = diagnose({ ...HEALTHY, lastBookingAt: "2026-06-01T12:00:00Z" }, NOW);
  assert.match(quiet[0]!.detail, /71 days ago/);

  assert.deepEqual(diagnose({ ...HEALTHY, lastBookingAt: "2026-08-10T12:00:00Z" }, NOW), []);
});

test("a missing or unparseable timestamp does not become a wrong number of days", () => {
  assert.equal(daysSince("", NOW), null);
  assert.equal(daysSince("not a date", NOW), null);
  assert.equal(daysSince("2026-08-01T12:00:00Z", NOW), 10);

  // A booking count with no timestamp must not claim it was NaN days ago.
  const findings = diagnose({ ...HEALTHY, lastBookingAt: "" }, NOW);
  assert.deepEqual(findings, []);
});

test("legal pages are only reported when we actually know they are unpublished", () => {
  assert.deepEqual(diagnose({ ...HEALTHY, legalPublished: undefined }, NOW), []);
  assert.ok(
    diagnose({ ...HEALTHY, legalPublished: false }, NOW).some((finding) =>
      finding.title.includes("Legal pages"),
    ),
  );
});
