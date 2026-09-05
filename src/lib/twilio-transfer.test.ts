import assert from "node:assert/strict";
import test from "node:test";

import {
  activeInboundCall,
  liveTransferTwiml,
  missedTransferTwiml,
  transferActionUrl,
  transferCompleted,
} from "./twilio-transfer.ts";

const PARENT = "CA11111111111111111111111111111111";

test("selects the newest exact inbound parent call and ignores the SIP child", () => {
  const selected = activeInboundCall(
    {
      calls: [
        {
          sid: "CA22222222222222222222222222222222",
          from: "+18055550101",
          to: "+18056267761",
          status: "in-progress",
          direction: "outbound-dial",
          parent_call_sid: PARENT,
          start_time: "2026-08-26T20:00:02Z",
        },
        {
          sid: PARENT,
          from: "+18055550101",
          to: "+18056267761",
          status: "in-progress",
          direction: "inbound",
          parent_call_sid: null,
          start_time: "2026-08-26T20:00:01Z",
        },
      ],
    },
    { from: "(805) 555-0101", to: "(805) 626-7761" },
  );

  assert.equal(selected?.sid, PARENT);
});

test("refuses a mismatched or completed call", () => {
  assert.equal(
    activeInboundCall(
      {
        calls: [
          {
            sid: PARENT,
            from: "+18055550199",
            to: "+18056267761",
            status: "completed",
            direction: "inbound",
          },
        ],
      },
      { from: "+18055550101", to: "+18056267761" },
    ),
    null,
  );
});

test("builds a signed-callback-ready bilingual transfer", () => {
  const actionUrl = transferActionUrl({
    origin: "https://www.volteira.com",
    callSid: PARENT,
    requestId: "request with spaces",
    language: "es",
  });
  assert.match(
    actionUrl,
    /^https:\/\/www\.volteira\.com\/api\/twilio\/transfer\?/,
  );
  assert.match(actionUrl, /request=request\+with\+spaces/);

  const body = liveTransferTwiml({
    to: "+18055559313",
    callerId: "+18056267761",
    actionUrl,
    language: "es",
  });
  assert.match(body, /Polly\.Lupe/);
  assert.match(body, /timeout="20"/);
  assert.match(body, /Un momento/);
  assert.match(body, /&amp;/);
});

test("only an answered completed dial counts as connected", () => {
  assert.equal(transferCompleted("completed"), true);
  assert.equal(transferCompleted("no-answer"), false);
  assert.equal(transferCompleted("busy"), false);
  assert.match(missedTransferTwiml("en"), /right away/);
  assert.match(missedTransferTwiml("en"), /usually within 24 hours/);
  assert.match(missedTransferTwiml("es"), /ahora mismo/);
  assert.match(missedTransferTwiml("es"), /dentro de 24 horas/);
});
