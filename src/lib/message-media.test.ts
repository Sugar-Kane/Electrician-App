import test from "node:test";
import assert from "node:assert/strict";
import { readMessagePhotos } from "./message-media.ts";
const p = { AccountSid: "AC" + "a".repeat(32), MessageSid: "MM" + "b".repeat(32), NumMedia: "1", MediaContentType0: "image/jpeg", MediaUrl0: "" };
p.MediaUrl0 = `https://api.twilio.com/2010-04-01/Accounts/${p.AccountSid}/Messages/${p.MessageSid}/Media/ME${"c".repeat(32)}`;
test("signed message photos are accepted", () => { assert.equal(readMessagePhotos(p).length, 1); });
test("external URLs, mismatched messages, and active image formats are rejected", () => {
  for (const patch of [{ MediaUrl0: "https://evil.example/photo" }, { MessageSid: "SM" + "d".repeat(32) }, { MediaContentType0: "image/svg+xml" }, { MediaUrl0: p.MediaUrl0 + "?other=1" }]) assert.deepEqual(readMessagePhotos({ ...p, ...patch }), []);
});
