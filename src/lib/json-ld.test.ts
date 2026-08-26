import test from "node:test";
import assert from "node:assert/strict";

import { safeJsonLd } from "./json-ld.ts";

/*
 * The escaping on the public pages, tested without rendering React.
 *
 * Every value that reaches it is model-written from input that includes text a
 * customer typed, so this is the last thing between an inbound text message and
 * script execution in a stranger's browser.
 */

test("a closing script tag cannot survive into the page", () => {
  const out = safeJsonLd({ headline: "</script><img src=x onerror=alert(1)>" });

  assert.equal(out.includes("</script>"), false);
  assert.equal(out.includes("<"), false);
  assert.equal(out.includes(">"), false);
  assert.ok(out.includes("\\u003c"));

  // Still the same data once a JSON parser reads it back.
  assert.equal(
    JSON.parse(out).headline,
    "</script><img src=x onerror=alert(1)>",
  );
});

test("ampersands and the line separators are escaped too", () => {
  const out = safeJsonLd({ a: "Tom & Jerry", b: "one\u2028two", c: "three\u2029four" });

  assert.equal(out.includes("&"), false);
  // Literal U+2028 and U+2029 end a line for a JavaScript parser but not for
  // JSON, so leaving them in produces a syntax error in the browser only.
  assert.equal(out.includes("\u2028"), false);
  assert.equal(out.includes("\u2029"), false);

  const back = JSON.parse(out);
  assert.equal(back.a, "Tom & Jerry");
  assert.equal(back.b, "one\u2028two");
  assert.equal(back.c, "three\u2029four");
});

test("ordinary structured data round-trips unchanged", () => {
  const data = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Why does my dryer keep tripping the breaker?",
    publisher: { "@type": ["Organization", "Electrician"], telephone: "(805) 626-7761" },
  };

  assert.deepEqual(JSON.parse(safeJsonLd(data)), data);
});
