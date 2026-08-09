import test from "node:test";
import assert from "node:assert/strict";

import { createHmac } from "node:crypto";

import {
  WEBHOOK_TOLERANCE_SECONDS,
  readIncomingCall,
  sipNumber,
  verifyXaiWebhook,
} from "./xai-webhook.ts";

const SECRET = "whsec_9wGf2s1kQpVn5xLbTzRcYhJdMeAoUiPq";
const BODY = JSON.stringify({ type: "realtime.call.incoming", data: { call_id: "abc" } });
const ID = "evt_123";
const NOW = new Date("2026-08-09T20:00:00Z");

function sign(input: {
  body?: string;
  id?: string;
  timestamp?: number;
  secret?: string;
  base64Key?: boolean;
}) {
  const timestamp = input.timestamp ?? Math.floor(NOW.getTime() / 1000);
  const body = input.body ?? BODY;
  const id = input.id ?? ID;
  const raw = (input.secret ?? SECRET).replace(/^whsec_/, "");
  const key = input.base64Key ? Buffer.from(raw, "base64") : Buffer.from(raw, "utf-8");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`, "utf-8").digest("base64");
  return { id, timestamp: String(timestamp), signature: `v1,${signature}`, body };
}

test("a genuine delivery verifies", () => {
  const signed = sign({});
  assert.equal(
    verifyXaiWebhook({
      secret: SECRET,
      headers: { id: signed.id, timestamp: signed.timestamp, signature: signed.signature },
      body: signed.body,
      now: NOW,
    }),
    true,
  );
});

test("a body edited in flight does not verify", () => {
  // The whole point: the call_id is what we act on, so it must be signed.
  const signed = sign({});
  assert.equal(
    verifyXaiWebhook({
      secret: SECRET,
      headers: { id: signed.id, timestamp: signed.timestamp, signature: signed.signature },
      body: signed.body.replace("abc", "def"),
      now: NOW,
    }),
    false,
  );
});

test("a signature from another secret does not verify", () => {
  const signed = sign({ secret: "whsec_someoneelse" });
  assert.equal(
    verifyXaiWebhook({
      secret: SECRET,
      headers: { id: signed.id, timestamp: signed.timestamp, signature: signed.signature },
      body: signed.body,
      now: NOW,
    }),
    false,
  );
});

test("a replayed delivery is refused once it is stale", () => {
  const fresh = Math.floor(NOW.getTime() / 1000);
  const signed = sign({ timestamp: fresh });

  const later = new Date(NOW.getTime() + (WEBHOOK_TOLERANCE_SECONDS + 60) * 1000);
  assert.equal(
    verifyXaiWebhook({
      secret: SECRET,
      headers: { id: signed.id, timestamp: signed.timestamp, signature: signed.signature },
      body: signed.body,
      now: later,
    }),
    false,
  );
});

test("a secret held base64-encoded still verifies", () => {
  // The same scheme ships both ways, and the headers look identical. Guessing
  // wrong would reject every real call.
  const signed = sign({ base64Key: true });
  assert.equal(
    verifyXaiWebhook({
      secret: SECRET,
      headers: { id: signed.id, timestamp: signed.timestamp, signature: signed.signature },
      body: signed.body,
      now: NOW,
    }),
    true,
  );
});

test("during a rotation, either signature counts", () => {
  const signed = sign({});
  const stale = sign({ secret: "whsec_oldsecret" });
  assert.equal(
    verifyXaiWebhook({
      secret: SECRET,
      headers: {
        id: signed.id,
        timestamp: signed.timestamp,
        signature: `${stale.signature} ${signed.signature}`,
      },
      body: signed.body,
      now: NOW,
    }),
    true,
  );
});

test("no secret means nothing verifies, rather than everything", () => {
  const signed = sign({});
  assert.equal(
    verifyXaiWebhook({
      secret: "",
      headers: { id: signed.id, timestamp: signed.timestamp, signature: signed.signature },
      body: signed.body,
      now: NOW,
    }),
    false,
  );
});

test("missing or nonsense headers are refused rather than thrown on", () => {
  const signed = sign({});
  const cases = [
    { id: null, timestamp: signed.timestamp, signature: signed.signature },
    { id: signed.id, timestamp: null, signature: signed.signature },
    { id: signed.id, timestamp: signed.timestamp, signature: null },
    { id: signed.id, timestamp: "not-a-number", signature: signed.signature },
    { id: signed.id, timestamp: signed.timestamp, signature: "v1," },
  ];

  for (const headers of cases) {
    assert.equal(
      verifyXaiWebhook({ secret: SECRET, headers, body: signed.body, now: NOW }),
      false,
      JSON.stringify(headers),
    );
  }
});

test("an incoming call is read down to the two numbers that route it", () => {
  const call = readIncomingCall({
    type: "realtime.call.incoming",
    data: {
      call_id: "00000000-0000-0000-0000-000000000000",
      sip_headers: [
        { name: "From", value: "+14155550100" },
        { name: "To", value: "+18005550199" },
      ],
    },
  });

  assert.deepEqual(call, {
    callId: "00000000-0000-0000-0000-000000000000",
    from: "+14155550100",
    to: "+18005550199",
  });
});

test("a real SIP From header is not a bare number", () => {
  // '"Line 2" <sip:...>' — the display name has digits in it, and the address
  // is what must be read.
  assert.equal(sipNumber('"Line 2" <sip:+18055550142@carrier.example>'), "+18055550142");
  assert.equal(sipNumber("<sip:8055550142@10.0.0.5;transport=tls>"), "+18055550142");
  assert.equal(sipNumber("sip:+18055550142@sip.voice.x.ai"), "+18055550142");
  assert.equal(sipNumber("+1 (805) 555-0142"), "+18055550142");
  assert.equal(sipNumber("anonymous"), "");
  assert.equal(sipNumber(""), "");
});

test("another event type is not an incoming call", () => {
  assert.equal(readIncomingCall({ type: "realtime.call.ended", data: { call_id: "x" } }), null);
  assert.equal(readIncomingCall(null), null);
  assert.equal(readIncomingCall("hello"), null);
});

test("a call with no dialled number is refused rather than guessed at", () => {
  // Without it there is no way to know which business is being called, and
  // answering as the wrong company is worse than not answering.
  assert.equal(
    readIncomingCall({
      type: "realtime.call.incoming",
      data: { call_id: "abc", sip_headers: [{ name: "From", value: "+14155550100" }] },
    }),
    null,
  );
});
