import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalIndexUrl,
  canonicalOrigin,
  canonicalPostUrl,
  journalIndexPath,
  journalPostPath,
  originOf,
} from "./journal-urls.ts";

const APP = "https://volteira.com";

test("a post has one canonical, and it moves to the business's own domain", () => {
  /*
   * The whole reason this module exists. The same words are served at two
   * addresses on purpose, and if both claim to be canonical the ranking splits
   * between them and neither wins.
   */
  const onOurs = canonicalPostUrl({
    appUrl: APP,
    tenantHost: "",
    orgSlug: "pacific-plains-electric",
    postSlug: "why-does-my-dryer-trip",
  });
  assert.equal(onOurs, "https://volteira.com/journal/pacific-plains-electric/why-does-my-dryer-trip");

  // The day they verify a subdomain, the canonical follows them there and the
  // accumulated value goes with it.
  const onTheirs = canonicalPostUrl({
    appUrl: APP,
    tenantHost: "blog.pacificplainselectric.com",
    orgSlug: "pacific-plains-electric",
    postSlug: "why-does-my-dryer-trip",
  });
  assert.equal(onTheirs, "https://blog.pacificplainselectric.com/journal/why-does-my-dryer-trip");
});

test("the org slug is dropped on a hostname that already names one business", () => {
  assert.equal(journalPostPath("acme", "a-post", true), "/journal/a-post");
  assert.equal(journalPostPath("acme", "a-post", false), "/journal/acme/a-post");
  assert.equal(journalIndexPath("acme", true), "/journal");
  assert.equal(journalIndexPath("acme", false), "/journal/acme");
});

test("links rendered on a tenant page stay on that hostname", () => {
  // `onTenantHost` is what the visitor typed, not where the canonical points.
  // Getting this backwards bounces a reader onto volteira.com mid-visit.
  assert.equal(journalIndexPath("acme", true), "/journal");
  assert.notEqual(journalIndexPath("acme", true), journalIndexPath("acme", false));
});

test("a slug with awkward characters cannot break out of the path", () => {
  assert.equal(journalPostPath("acme", "a post/../etc", false), "/journal/acme/a%20post%2F..%2Fetc");
  assert.equal(journalPostPath("a/b", "post", false), "/journal/a%2Fb/post");
});

test("an unusable origin yields no canonical rather than a broken one", () => {
  // A relative canonical is better than one pointing at localhost, and callers
  // omit the tag entirely when this is empty.
  assert.equal(originOf(""), "");
  assert.equal(originOf("volteira.com"), "");
  assert.equal(originOf("not a url"), "");
  assert.equal(originOf(null), "");
  assert.equal(originOf("https://volteira.com/"), "https://volteira.com");
  assert.equal(originOf("https://volteira.com///"), "https://volteira.com");

  assert.equal(
    canonicalPostUrl({ appUrl: "", tenantHost: "", orgSlug: "acme", postSlug: "p" }),
    "",
  );
});

test("a tenant host wins over the app origin, and is always https", () => {
  assert.equal(
    canonicalOrigin({ appUrl: APP, tenantHost: "blog.acme.com" }),
    "https://blog.acme.com",
  );
  // A hostname that is not a hostname falls back rather than producing
  // "https://javascript:alert(1)".
  assert.equal(canonicalOrigin({ appUrl: APP, tenantHost: "not a host" }), APP);
  assert.equal(canonicalOrigin({ appUrl: APP, tenantHost: "  " }), APP);
  assert.equal(canonicalOrigin({ appUrl: null, tenantHost: null }), "");
});

test("the index canonical follows the same rule as a post's", () => {
  assert.equal(
    canonicalIndexUrl({ appUrl: APP, tenantHost: "", orgSlug: "acme" }),
    "https://volteira.com/journal/acme",
  );
  assert.equal(
    canonicalIndexUrl({ appUrl: APP, tenantHost: "blog.acme.com", orgSlug: "acme" }),
    "https://blog.acme.com/journal",
  );
});
