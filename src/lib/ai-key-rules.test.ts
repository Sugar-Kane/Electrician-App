import test from "node:test";
import assert from "node:assert/strict";

import { describeKeyRefusal, keyHint, looksLikeOpenAiKey } from "./ai-key-rules.ts";

const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_wxyz";

test("a saved key is only ever shown by its last four characters", () => {
  assert.equal(keyHint(key), "…wxyz");
  assert.ok(!keyHint(key).includes("sk-"), "the prefix is not shown");
  assert.ok(keyHint(key).length <= 5);
  assert.equal(keyHint("abc"), "…", "a short value shows nothing of itself");
});

test("only something shaped like an OpenAI key is accepted", () => {
  assert.equal(looksLikeOpenAiKey(key), true);
  assert.equal(looksLikeOpenAiKey("sk-" + "a".repeat(48)), true);
  for (const value of ["", "sk-short", ` ${key}`, `${key}\nnext`, "pk_live_" + "a".repeat(30), "Bearer " + key]) {
    assert.equal(looksLikeOpenAiKey(value), false, JSON.stringify(value));
  }
});

test("a refusal shown to the owner never repeats a key back", () => {
  const message = describeKeyRefusal(429, `Rate limit for ${key} exceeded`);
  assert.ok(!message.includes("sk-proj"), message);
  assert.match(describeKeyRefusal(401, "Incorrect API key provided: sk-abc123456789012345678901"), /did not accept that key/);
});
