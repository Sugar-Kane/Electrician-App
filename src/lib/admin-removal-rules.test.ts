import assert from "node:assert/strict";
import { test } from "node:test";

import { filesInBusinessFolder, isDeletableKind } from "./admin-removal-rules.ts";

const ORG = "a6256f4d-756e-49d0-b299-5d58a20ae0ad";
const OTHER = "11111111-2222-3333-4444-555555555555";

test("only files inside the business's own folder are deleted", () => {
  assert.deepEqual(
    filesInBusinessFolder(ORG, [`${ORG}/jobs/1/invoice.pdf`, `${OTHER}/jobs/1/invoice.pdf`, "invoice.pdf", `${ORG}/`]),
    [`${ORG}/jobs/1/invoice.pdf`],
  );
});

test("a path that climbs out of the folder is refused", () => {
  assert.deepEqual(filesInBusinessFolder(ORG, [`${ORG}/../${OTHER}/secret.pdf`, `${ORG}/./a.pdf`]), []);
});

test("duplicates and non-text values are dropped", () => {
  assert.deepEqual(filesInBusinessFolder(ORG, [`${ORG}/a.pdf`, `${ORG}/a.pdf`, null, 7]), [`${ORG}/a.pdf`]);
});

test("a malformed business id or a non-list deletes nothing", () => {
  assert.deepEqual(filesInBusinessFolder("not-an-id", [`not-an-id/a.pdf`]), []);
  assert.deepEqual(filesInBusinessFolder(ORG, `${ORG}/a.pdf`), []);
});

test("only the five record kinds can be deleted one at a time", () => {
  for (const kind of ["customer", "job", "invoice", "booking", "contract"]) assert.equal(isDeletableKind(kind), true);
  for (const kind of ["organization", "member", "", "jobs"]) assert.equal(isDeletableKind(kind), false);
});
