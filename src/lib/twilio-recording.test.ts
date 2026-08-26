import assert from "node:assert/strict";
import test from "node:test";

import { readTwilioRecordingEvent } from "./twilio-recording.ts";

const valid = {
  AccountSid: `AC${"a".repeat(32)}`,
  CallSid: `CA${"b".repeat(32)}`,
  RecordingSid: `RE${"c".repeat(32)}`,
  RecordingStatus: "completed",
  RecordingDuration: "84",
  RecordingChannels: "2",
  RecordingStartTime: "Wed, 26 Aug 2026 20:00:00 +0000",
};

test("reads a completed dual-channel recording callback", () => {
  assert.deepEqual(readTwilioRecordingEvent(valid), {
    accountSid: valid.AccountSid,
    callSid: valid.CallSid,
    recordingSid: valid.RecordingSid,
    status: "completed",
    durationSeconds: 84,
    channels: 2,
    startedAt: "2026-08-26T20:00:00.000Z",
  });
});

test("rejects untrusted call and recording identifiers", () => {
  assert.equal(readTwilioRecordingEvent({ ...valid, CallSid: "CA../../secret" }), null);
  assert.equal(readTwilioRecordingEvent({ ...valid, RecordingSid: "RE-not-a-sid" }), null);
});

test("keeps optional numeric metadata nullable instead of guessing", () => {
  assert.deepEqual(
    readTwilioRecordingEvent({
      ...valid,
      RecordingDuration: "unknown",
      RecordingChannels: "9",
      RecordingStartTime: "not-a-date",
    }),
    {
      accountSid: valid.AccountSid,
      callSid: valid.CallSid,
      recordingSid: valid.RecordingSid,
      status: "completed",
      durationSeconds: null,
      channels: null,
      startedAt: null,
    },
  );
});
