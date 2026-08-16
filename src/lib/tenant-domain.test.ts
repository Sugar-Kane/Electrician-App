import test from "node:test";
import assert from "node:assert/strict";

import {
  bookingHostFor,
  checkBookingHostname,
  isPlatformHost,
  normaliseHost,
} from "./tenant-domain.ts";

const APP = "https://volteira.app";

test("an ordinary host is left alone but lowercased", () => {
  assert.equal(normaliseHost("Book.AcmeElectric.com"), "book.acmeelectric.com");
});

test("a port is not part of the host", () => {
  assert.equal(normaliseHost("book.acme.com:3000"), "book.acme.com");
  assert.equal(normaliseHost("localhost:3000"), "localhost");
});

test("an IPv6 literal keeps its brackets and loses only the port", () => {
  // Splitting on ":" unconditionally would leave "[" here, which then matches
  // nothing and reads as a tenant host.
  assert.equal(normaliseHost("[::1]:3000"), "[::1]");
  assert.equal(normaliseHost("[::1]"), "[::1]");
});

test("a forwarded list keeps the host the browser asked for", () => {
  assert.equal(normaliseHost("book.acme.com, internal.fly.dev"), "book.acme.com");
});

test("a trailing dot is the same host", () => {
  // "acme.com." is fully qualified and would otherwise match no row.
  assert.equal(normaliseHost("book.acme.com."), "book.acme.com");
});

test("a scheme or path that should not be here is stripped", () => {
  assert.equal(normaliseHost("https://book.acme.com/book"), "book.acme.com");
  assert.equal(normaliseHost("book.acme.com/x?y=1"), "book.acme.com");
});

test("nonsense normalises to nothing", () => {
  for (const bad of ["", "   ", ",", "..", "a b c"]) {
    assert.equal(normaliseHost(bad), "", JSON.stringify(bad));
  }
});

test("the app's own hosts are the platform", () => {
  assert.equal(isPlatformHost("volteira.app", APP), true);
  assert.equal(isPlatformHost("VOLTEIRA.APP", APP), true);
  assert.equal(isPlatformHost("localhost", APP), true);
  assert.equal(isPlatformHost("localhost:3000", APP), true);
  assert.equal(isPlatformHost("[::1]", APP), true);
});

test("preview deployments are the platform", () => {
  // Every branch deploy has its own hostname and none of them is a tenant.
  assert.equal(
    isPlatformHost("electrician-app-git-claude-adams-projects.vercel.app", APP),
    true,
  );
});

test("a customer's domain is not the platform", () => {
  assert.equal(isPlatformHost("book.acmeelectric.com", APP), false);
  assert.equal(isPlatformHost("schedule.pacificplains.com", APP), false);
});

test("an unreadable host is treated as the platform", () => {
  // The recoverable direction: serve the app rather than rewrite a request
  // nobody can explain into a booking page.
  assert.equal(isPlatformHost("", APP), true);
  assert.equal(isPlatformHost("a b c", APP), true);
});

test("the forwarded host wins over the proxy's own", () => {
  assert.equal(
    bookingHostFor({
      host: "internal.vercel.app",
      forwardedHost: "book.acme.com",
      appUrl: APP,
    }),
    "book.acme.com",
  );
});

test("an app request has no booking host", () => {
  assert.equal(
    bookingHostFor({ host: "volteira.app", forwardedHost: null, appUrl: APP }),
    "",
  );
});

test("a subdomain is accepted", () => {
  assert.deepEqual(checkBookingHostname(" Book.AcmeElectric.com "), {
    ok: true,
    hostname: "book.acmeelectric.com",
  });
});

test("an apex domain is refused, and says why", () => {
  // The case that matters most: this would take over their website, not add to
  // it, and DNS would not warn them.
  const result = checkBookingHostname("acmeelectric.com");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /replace your website/);
});

test("our own domains cannot be claimed", () => {
  assert.equal(checkBookingHostname("anything.vercel.app").ok, false);
});

test("labels that no certificate could be issued for are refused", () => {
  for (const bad of ["book..acme.com", "-book.acme.com", "book-.acme.com", "bo ok.acme.com"]) {
    assert.equal(checkBookingHostname(bad).ok, false, bad);
  }
});

test("hyphens inside a label are fine", () => {
  assert.equal(checkBookingHostname("book-now.acme-electric.com").ok, true);
});
