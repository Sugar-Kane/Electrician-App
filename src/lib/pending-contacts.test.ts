import test from "node:test";
import assert from "node:assert/strict";

import { mayReviewContacts, readReviewChoice } from "./pending-contacts.ts";

test("reviewing new contacts is for the owner and admins only", () => {
  assert.equal(mayReviewContacts("owner"), true);
  assert.equal(mayReviewContacts("admin"), true);
  assert.equal(mayReviewContacts("technician"), false);
  assert.equal(mayReviewContacts(""), false);
});

test("the review buttons only keep or delete", () => {
  assert.equal(readReviewChoice("keep"), "keep");
  assert.equal(readReviewChoice("delete"), "delete");
  assert.equal(readReviewChoice("archive"), null);
  assert.equal(readReviewChoice(undefined), null);
});
