import assert from "node:assert/strict";
import { test } from "node:test";

import { isOwnedObjectPath, ownedObjectPaths } from "./tenant-storage-path.ts";

/*
 * The service role signs, downloads and deletes files without any storage
 * policy. These are the paths it may touch: the caller's own, in the one shape
 * this app writes, and nothing that could name another business's file.
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("a business's own file passes", () => {
  assert.equal(isOwnedObjectPath(`${A}/jobs/job-1/photo.jpg`, A), true);
  assert.equal(isOwnedObjectPath(`${A}/invoices/INV-32.pdf`, A, { minSegments: 3 }), true);
  assert.equal(isOwnedObjectPath(`${A}/logo.png`, A), true);
  // Ids are compared without regard to case, as Postgres prints them lower case.
  assert.equal(isOwnedObjectPath(`${A.toUpperCase()}/jobs/x/a.jpg`, A), true);
});

test("another business's file never passes", () => {
  assert.equal(isOwnedObjectPath(`${B}/jobs/job-1/photo.jpg`, A), false);
  assert.equal(isOwnedObjectPath(`x${A}/jobs/a.jpg`, A), false);
  assert.equal(isOwnedObjectPath(`${A}x/jobs/a.jpg`, A), false);
});

test("nothing that could walk out of the business's folder passes", () => {
  for (const path of [
    `${A}/jobs/../../${B}/jobs/photo.jpg`,
    `${A}/../${B}/photo.jpg`,
    `${A}/./photo.jpg`,
    `${A}//photo.jpg`,
    `${A}/photo.jpg/`,
    `/${A}/photo.jpg`,
    `${A}/%2e%2e/${B}/photo.jpg`,
    `${A}/jobs\\..\\${B}/photo.jpg`,
    `${A}/jobs/pho\u0000to.jpg`,
    `${A}/jobs/pho\nto.jpg`,
  ]) {
    assert.equal(isOwnedObjectPath(path, A), false, path);
  }
});

test("the business id alone, an empty path or a non-path is not a file", () => {
  assert.equal(isOwnedObjectPath(A, A), false);
  assert.equal(isOwnedObjectPath(`${A}/`, A), false);
  assert.equal(isOwnedObjectPath("", A), false);
  assert.equal(isOwnedObjectPath(null, A), false);
  assert.equal(isOwnedObjectPath(42, A), false);
  assert.equal(isOwnedObjectPath(`${A}/${"a".repeat(2000)}`, A), false);
});

test("an owner that is not an id owns nothing", () => {
  assert.equal(isOwnedObjectPath("jobs/photo.jpg", "jobs"), false);
  assert.equal(isOwnedObjectPath(`${A}/a.jpg`, ""), false);
});

test("a folder, when given, must be the path's folder, with a file inside it", () => {
  assert.equal(isOwnedObjectPath(`${A}/jobs/job-1/photo.jpg`, A, { folder: "jobs/job-1" }), true);
  assert.equal(isOwnedObjectPath(`${A}/jobs/job-2/photo.jpg`, A, { folder: "jobs/job-1" }), false);
  assert.equal(isOwnedObjectPath(`${A}/jobs/job-1`, A, { folder: "jobs/job-1" }), false);
  assert.equal(isOwnedObjectPath(`${A}/inventory/../assistant/a.pdf`, A, { folder: "inventory" }), false);
});

test("documents need a folder and a file under the business", () => {
  assert.equal(isOwnedObjectPath(`${A}/photo.jpg`, A, { minSegments: 3 }), false);
});

test("a batch keeps the owned paths, skips blanks, and counts what it refused", () => {
  const result = ownedObjectPaths([`${A}/jobs/a.jpg`, "", null, `${B}/jobs/b.jpg`, `${A}/../x`], A);
  assert.deepEqual(result.paths, [`${A}/jobs/a.jpg`]);
  assert.equal(result.refused, 2);
});
