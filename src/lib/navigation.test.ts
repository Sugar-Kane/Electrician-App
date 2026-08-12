import test from "node:test";
import assert from "node:assert/strict";

import {
  ALL_NAV_ITEMS,
  ALL_SETTINGS_LINKS,
  NAV_SECTIONS,
  SETTINGS_GROUPS,
  activeNavHref,
  activeNavItem,
  BOTTOM_NAV_HREFS,
  isBeyondBottomNav,
} from "./navigation.ts";

test("no destination is listed twice", () => {
  // The old menu listed /schedule and /schedule?view=jobs as separate entries,
  // so two things lit up at once and neither told you where you were.
  const hrefs = ALL_NAV_ITEMS.map((item) => item.href);
  assert.deepEqual([...new Set(hrefs)], hrefs);
});

test("no menu entry is a query string or an anchor on another page", () => {
  // A filter belongs to the page it filters, as that page's own tab.
  for (const item of ALL_NAV_ITEMS) {
    assert.doesNotMatch(item.href, /[?#]/, item.label);
  }
});

test("every entry has somewhere to go and something to say", () => {
  for (const item of ALL_NAV_ITEMS) {
    assert.match(item.href, /^\//, item.label);
    assert.ok(item.label.trim().length > 0);
    assert.ok(item.description.trim().length > 0, item.label);
    assert.ok(item.icon.trim().length > 0, item.label);
  }
});

test("the page you are on is the entry that highlights", () => {
  assert.equal(activeNavHref("/"), "/");
  assert.equal(activeNavHref("/schedule"), "/schedule");
  assert.equal(activeNavHref("/invoices"), "/invoices");
  assert.equal(activeNavHref("/settings"), "/settings");
});

test("the dashboard does not claim every page", () => {
  // "/" prefixes everything, so a naive startsWith would light up Dashboard on
  // every screen in the app.
  assert.equal(activeNavHref("/messages"), "/messages");
  assert.equal(activeNavHref("/materials"), "/materials");
});

test("a subpage belongs to its parent", () => {
  assert.equal(activeNavHref("/messages/6f1c"), "/messages");
  assert.equal(activeNavHref("/settings/team"), "/settings");
  assert.equal(activeNavHref("/settings/notifications"), "/settings");
  assert.equal(activeNavHref("/materials/orders"), "/materials");
});

test("a record opened from a list belongs to that list", () => {
  // /jobs/1045 has no /schedule prefix, but it is the schedule you came from.
  assert.equal(activeNavHref("/jobs/1045"), "/schedule");
  assert.equal(activeNavHref("/booking/2f1b7c14"), "/booking-requests");
});

test("a filter on a page does not stop that page highlighting", () => {
  assert.equal(activeNavHref("/invoices?status=overdue"), "/invoices");
  assert.equal(activeNavHref("/schedule?view=jobs"), "/schedule");
});

test("a page outside the menu highlights nothing rather than guessing", () => {
  assert.equal(activeNavHref("/login"), null);
  assert.equal(activeNavHref("/admin"), null);
  assert.equal(activeNavHref(""), null);
});

test("the longest matching entry wins", () => {
  const items = [
    { label: "Settings", href: "/settings", icon: "Settings", description: "x" },
    { label: "Settings team", href: "/settings/team", icon: "Users", description: "x" },
  ];
  assert.equal(activeNavHref("/settings/team/anything", items), "/settings/team");
});

test("the active entry can be named, for a header that says where you are", () => {
  assert.equal(activeNavItem("/messages/6f1c")?.label, "Messages");
  assert.equal(activeNavItem("/jobs/1045")?.label, "Jobs");
  assert.equal(activeNavItem("/login"), null);
});

test("every section has a name except the first, which is the dashboard alone", () => {
  assert.equal(NAV_SECTIONS[0]?.title, "");
  assert.equal(NAV_SECTIONS[0]?.items.length, 1);

  for (const section of NAV_SECTIONS.slice(1)) {
    assert.ok(section.title.trim().length > 0);
    assert.ok(section.items.length > 0, section.title);
  }
});

test("settings links are unique and each belongs to exactly one group", () => {
  const hrefs = ALL_SETTINGS_LINKS.map((link) => link.href);
  assert.deepEqual([...new Set(hrefs)], hrefs);
});

test("business timezone is a business setting, not a personal one", () => {
  // It used to sit on the account page beside the owner's own password, which
  // is where an electrician goes to look for it and does not find it.
  const business = SETTINGS_GROUPS.find((group) => group.title === "Your business");
  assert.ok(business);
  assert.ok(
    business.links.some((link) => /timezone/i.test(link.description)),
    "no business setting mentions the timezone",
  );
});

test("every settings group explains itself", () => {
  for (const group of SETTINGS_GROUPS) {
    assert.ok(group.blurb.trim().length > 0, group.title);
    assert.ok(group.links.length > 0, group.title);
  }
});

test("the bottom bar's permanent destinations are all real menu entries", () => {
  // A bottom-bar href that is not in the menu is a page the drawer cannot
  // reach, and one that has been renamed is a tab that lights up for nothing.
  for (const href of BOTTOM_NAV_HREFS) {
    assert.ok(
      ALL_NAV_ITEMS.some((item) => item.href === href),
      `${href} is in the bottom bar but not in the menu`,
    );
  }
});

test("the four permanent tabs do not light More", () => {
  for (const href of BOTTOM_NAV_HREFS) {
    assert.equal(isBeyondBottomNav(href), false, href);
  }
});

test("a page reached through the menu lights More", () => {
  // Settings used to be the bottom bar's fifth destination, so being on it lit
  // a tab labelled "More" that was really a link. It is a menu page now.
  assert.equal(isBeyondBottomNav("/settings"), true);
  assert.equal(isBeyondBottomNav("/invoices"), true);
  assert.equal(isBeyondBottomNav("/materials"), true);
  assert.equal(isBeyondBottomNav("/technicians"), true);
});

test("a job opened from the schedule keeps Jobs lit, not More", () => {
  // /jobs/1045 resolves to /schedule, which is a permanent tab. Lighting More
  // there would move the highlight while somebody is still inside their jobs.
  assert.equal(isBeyondBottomNav("/jobs/1045"), false);
  assert.equal(isBeyondBottomNav("/messages/6f1c"), false);
});

test("a page in no menu section lights nothing at all", () => {
  // Better than lighting More by default: an unknown page is not "in the menu",
  // and claiming it is would make the highlight meaningless.
  assert.equal(isBeyondBottomNav("/login"), false);
  assert.equal(isBeyondBottomNav(""), false);
});
