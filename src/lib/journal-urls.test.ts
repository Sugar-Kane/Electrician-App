import test from "node:test";
import assert from "node:assert/strict";

import {
  appSitemapCarries,
  canonicalIndexUrl,
  canonicalOrigin,
  canonicalPostUrl,
  journalIndexPath,
  journalPostPath,
  originOf,
  tenantSitemapOrigin,
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

/*
 * The two sitemaps, checked against each other rather than one at a time.
 *
 * Each is correct read alone, which is how the gap survived being written: the
 * product's skips a business with a verified host, the tenant's serves the host
 * it was asked on, and neither file mentions the state where a domain row
 * exists but has not passed verification. Only the pair is wrong there.
 */

/** Where a post is submitted, given what the database actually knows. */
function submittedFrom(world: { verifiedHost: string; servingHosts: string[] }): string[] {
  const places: string[] = [];
  if (appSitemapCarries(world.verifiedHost)) places.push("https://volteira.com");
  for (const host of world.servingHosts) {
    // Every host the proxy resolves gets its own sitemap request.
    const origin = tenantSitemapOrigin({ requestHost: host, verifiedHost: world.verifiedHost });
    if (origin) places.push(origin);
  }
  return places;
}

test("a post is submitted to crawlers from exactly one sitemap", () => {
  // Nobody has pointed a domain at us. Ours carries it.
  assert.deepEqual(submittedFrom({ verifiedHost: "", servingHosts: [] }), [
    "https://volteira.com",
  ]);

  // Verified. Theirs carries it and ours steps aside, so the value accumulates
  // on the address the canonical names.
  assert.deepEqual(
    submittedFrom({ verifiedHost: "blog.acme.com", servingHosts: ["blog.acme.com"] }),
    ["https://blog.acme.com"],
  );

  /*
   * The regression. DNS is pointed at us and verification has not finished, so
   * `get_booking_page_by_host` resolves the host and serves real pages while
   * `get_verified_host_for_slug` still returns nothing and those pages
   * canonicalise home. Before the guard this returned both origins: the post
   * went into two sitemaps, and the tenant one advertised a URL that disowned
   * itself.
   */
  assert.deepEqual(submittedFrom({ verifiedHost: "", servingHosts: ["blog.acme.com"] }), [
    "https://volteira.com",
  ]);

  /*
   * Two domain rows, one verified. A request arriving on the pending one is not
   * on the address that owns these posts, even though the business does have
   * one. Testing the verified host for existence rather than for equality with
   * the request would submit the same posts from both hostnames.
   */
  assert.deepEqual(
    submittedFrom({
      verifiedHost: "blog.acme.com",
      servingHosts: ["blog.acme.com", "www.acme.com"],
    }),
    ["https://blog.acme.com"],
  );
});

test("the sitemap a host may submit is the one its posts call canonical", () => {
  /*
   * The invariant underneath the pairing: a submitted URL and the canonical tag
   * on the page it points at have to agree, or the sitemap is arguing with the
   * markup.
   */
  for (const verifiedHost of ["", "blog.acme.com"]) {
    const origin =
      tenantSitemapOrigin({ requestHost: "blog.acme.com", verifiedHost }) ||
      "https://volteira.com";

    assert.equal(
      `${origin}${journalPostPath("acme", "wet-outlet", Boolean(verifiedHost))}`,
      canonicalPostUrl({
        appUrl: APP,
        tenantHost: verifiedHost,
        orgSlug: "acme",
        postSlug: "wet-outlet",
      }),
    );
  }
});

test("a hostname that is not one submits nothing", () => {
  // Same posture as canonicalOrigin: never build "https://javascript:alert(1)".
  assert.equal(tenantSitemapOrigin({ requestHost: "not a host", verifiedHost: "not a host" }), "");
  assert.equal(tenantSitemapOrigin({ requestHost: null, verifiedHost: null }), "");
  assert.equal(tenantSitemapOrigin({ requestHost: "BLOG.acme.com", verifiedHost: "blog.acme.com" }), "https://blog.acme.com");
  assert.equal(appSitemapCarries("not a host"), true);
});
