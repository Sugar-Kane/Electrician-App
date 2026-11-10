import test from "node:test";
import assert from "node:assert/strict";

import { countInRange, passwordIsBreached } from "./pwned-password.ts";

// SHA-1("password") = 5BAA6 1E4C9B93F3F0682250B6CF8331B7EE68FD8
const PREFIX = "5BAA6";
const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

function replying(body: string, seen: string[] = [], status = 200): typeof fetch {
  return (async (url: string | URL | Request) => {
    seen.push(String(url));
    return new Response(body, { status });
  }) as typeof fetch;
}

test("only the first five characters of the hash are sent", async () => {
  const seen: string[] = [];
  await passwordIsBreached("password", replying("", seen));
  assert.equal(seen.length, 1);
  assert.ok(seen[0].endsWith(`/range/${PREFIX}`));
  const path = new URL(seen[0]).pathname;
  assert.equal(path, `/range/${PREFIX}`);
  assert.equal(path.includes(SUFFIX), false);
});

test("a password in the range reply is breached; padding lines are not", async () => {
  assert.equal(await passwordIsBreached("password", replying(`0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n${SUFFIX}:9659365`)), true);
  assert.equal(await passwordIsBreached("password", replying(`${SUFFIX}:0`)), false);
  assert.equal(await passwordIsBreached("password", replying("0018A45C4D1DEF81644B54AB7F969B88D65:3")), false);
  assert.equal(countInRange(`abc:1\n${SUFFIX.toLowerCase()}:4`, SUFFIX), 4);
});

test("the check fails open when the service is down or slow", async () => {
  assert.equal(await passwordIsBreached("password", replying(`${SUFFIX}:5`, [], 503)), false);
  const failing = (async () => { throw new Error("offline"); }) as typeof fetch;
  assert.equal(await passwordIsBreached("password", failing), false);
  assert.equal(await passwordIsBreached("", replying(`${SUFFIX}:5`)), false);
});
