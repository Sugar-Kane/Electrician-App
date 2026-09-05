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
