import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { readMessagePhotos } from "./message-media.ts";

// Exercise the actual webhook with isolated database/carrier/model adapters.
// No real customer texts or appointments are created by this test.
const route = ts.transpileModule(
  readFileSync(new URL("../app/api/twilio/inbound/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

async function receive(body: string, consentError = false, media: Record<string, string> = {}) {
  const writes: { table: string; operation: string; value: Record<string, unknown> }[] = [];
  const intake: Record<string, unknown>[] = [];
  const database = {
    from(table: string) {
      const result = { data: table === "messaging_settings" ? { organization_id: "org" }
        : table === "customers" ? [{ id: "customer", phone: "+18055550100" }]
        : table === "conversations" ? { id: "conversation" } : null,
        error: table === "messaging_consent" && consentError ? { message: "unavailable" } : null };
      const query = {
        select() { return query; }, eq() { return query; }, is() { return query; },
        order() { return query; }, limit() { return query; },
        maybeSingle: async () => result,
        single: async () => result,
        insert(value: Record<string, unknown>) { writes.push({ table, operation: "insert", value }); return query; },
        update(value: Record<string, unknown>) { writes.push({ table, operation: "update", value }); return query; },
        upsert(value: Record<string, unknown>) { writes.push({ table, operation: "upsert", value }); return query; },
        then(resolve: (value: typeof result) => unknown) { return Promise.resolve(result).then(resolve); },
      };
      return query;
    },
  };
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  runInNewContext(route, {
    exports, console,
    require(name: string) {
      if (name === "@/lib/message-media") return { readMessagePhotos };
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@/lib/messaging-rules") return { phoneMatches: (a: string, b: string) => a === b };
      if (name === "@/lib/supabase/admin") return { getSupabaseAdmin: () => database };
      if (name === "@/lib/sms-intake-runner") return { handleInboundText: async (input: Record<string, unknown>) => { intake.push(input); } };
      if (name === "@/lib/twilio") return { verifyTwilioSignature: () => true, isTwilioConfigured: () => true, twilioWebhookUrls: () => [] };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const response = await exports.POST!(new Request("https://example.com/api/twilio/inbound", {
    method: "POST",
    body: new URLSearchParams({ From: "+18055550100", Body: body, MessageSid: "SM-test", MessagingServiceSid: "MG-test", ...media }),
  }));
  return { response, writes, intake };
}

for (const body of ["YES", "Yes", "yes", " Yes! "]) {
  test(`${JSON.stringify(body)} records consent and continues booking intake exactly once`, async () => {
    const { response, writes, intake } = await receive(body);
    assert.equal(response.status, 200);
    assert.equal(writes.filter((w) => w.table === "messaging_consent" && w.operation === "upsert").length, 1);
    assert.equal(writes.filter((w) => w.table === "messages" && w.value.body === body.trim()).length, 1);
    assert.equal(intake.length, 1);
    assert.equal(intake[0].body, body.trim());
    assert.equal(intake[0].conversationId, "conversation");
  });
}

for (const body of ["START", "UNSTOP", "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]) {
  test(`${body} remains a consent-only command`, async () => {
    const { response, writes, intake } = await receive(body);
    assert.equal(response.status, 200);
    assert.equal(writes.filter((w) => w.table === "messaging_consent").length, 1);
    assert.equal(intake.length, 0);
  });
}

test("a failed YES consent write does not start booking intake", async () => {
  const { response, intake } = await receive("YES", true);
  assert.equal(response.status, 500);
  assert.equal(intake.length, 0);
});

test("ordinary appointment replies still reach intake", async () => {
  const { response, intake } = await receive("Wednesday morning works for me");
  assert.equal(response.status, 200);
  assert.equal(intake.length, 1);
});

 test("photo-only MMS is saved and sent to intake", async () => {
  const account = "AC" + "a".repeat(32), message = "MM" + "b".repeat(32);
  const { writes, intake, response } = await receive("", false, { AccountSid: account, MessageSid: message, NumMedia: "1", MediaContentType0: "image/jpeg", MediaUrl0: `https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${message}/Media/ME${"c".repeat(32)}` });
  assert.equal(response.status, 200);
  assert.equal((writes.find(w => w.table === "messages")!.value.media as unknown[]).length, 1);
  assert.equal(intake.length, 1);
  assert.match(String(intake[0].body), /attached 1 photo/);
 });
