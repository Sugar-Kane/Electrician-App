import assert from "node:assert/strict";
import test from "node:test";

import { xaiSipBridgeTwiml, xaiSipUriForPhone } from "./twilio-sip.ts";

test("builds the registered xAI SIP address from an E.164 number", () => {
  assert.equal(
    xaiSipUriForPhone("+19165550123"),
    "sip:+19165550123@sip.voice.x.ai;transport=tls",
  );
});

test("refuses values that could change the SIP destination", () => {
  assert.equal(xaiSipUriForPhone("19165550123"), null);
  assert.equal(xaiSipUriForPhone("+19165550123@example.com"), null);
  assert.equal(xaiSipUriForPhone("+19165550123;transport=udp"), null);
});

test("records both call legs and posts the completed recording to Volteira", () => {
  const xml = xaiSipBridgeTwiml({
    phone: "+19165550123",
    recordingCallbackUrl: "https://www.volteira.com/api/twilio/recording?source=xai&mode=dual",
  });

  assert.ok(xml);
  assert.match(xml, /This call will be recorded/);
  assert.match(xml, /Esta llamada será grabada/);
  assert.ok(xml.indexOf("This call will be recorded") < xml.indexOf("<Dial"));
  assert.match(xml, /record="record-from-answer-dual"/);
  assert.match(xml, /recordingStatusCallbackMethod="POST"/);
  assert.match(xml, /recordingStatusCallbackEvent="completed absent"/);
  assert.match(xml, /source=xai&amp;mode=dual/);
  assert.match(xml, /<Sip>sip:\+19165550123@sip\.voice\.x\.ai;transport=tls<\/Sip>/);
});

test("requires a valid recording callback URL", () => {
  assert.equal(
    xaiSipBridgeTwiml({ phone: "+19165550123", recordingCallbackUrl: "not a URL" }),
    null,
  );
});

test("a call back presents the customer as the caller, and only a real number gets in", () => {
  const xml = xaiSipBridgeTwiml({
    phone: "+19165550123",
    recordingCallbackUrl: "https://www.volteira.com/api/twilio/recording",
    callerId: "+18055550142",
  });
  assert.ok(xml);
  assert.match(xml, /<Dial answerOnBridge="true" record="record-from-answer-dual" callerId="\+18055550142"/);
  for (const callerId of ['+1805" action="https://evil.example', "8055550142", "+18055550142;x=1", ""]) {
    assert.equal(
      xaiSipBridgeTwiml({ phone: "+19165550123", recordingCallbackUrl: "https://www.volteira.com/r", callerId }),
      null,
      `${callerId} is refused`,
    );
  }
});

test("a call back says one short recording notice, still before anything is recorded", () => {
  const xml = xaiSipBridgeTwiml({
    phone: "+19165550123",
    recordingCallbackUrl: "https://www.volteira.com/api/twilio/recording",
    callerId: "+18055550142",
    briefNotice: true,
  });
  assert.ok(xml);
  assert.equal((xml.match(/<Say/g) ?? []).length, 1);
  assert.match(xml, /This call may be recorded\./);
  assert.ok(xml.indexOf("This call may be recorded.") < xml.indexOf("<Dial"));
  assert.equal((xml.match(/<Dial/g) ?? []).length, 1);
  assert.match(xml, /callerId="\+18055550142"/);
  assert.equal(
    xaiSipBridgeTwiml({
      phone: "+19165550123",
      recordingCallbackUrl: "https://www.volteira.com/r",
      callerId: '+1805" action="https://evil.example',
      briefNotice: true,
    }),
    null,
  );
});
