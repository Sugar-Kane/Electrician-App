import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as rules from "./messaging-rules.ts";
import * as phone from "./phone-format.ts";
import * as policy from "./supervised-actions.ts";

/*
 * The executor with a fake database and fake providers: nothing is texted or
 * emailed. What matters is what it refuses to do, and that an unknown outcome
 * is never reported as a failure (which could invite a resend).
 */

const source = ts.transpileModule(readFileSync(new URL("./supervised-executor.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

type Claim = Record<string, unknown>;
type Finish = Record<string, unknown>;

function harness(options: {
  execute?: string;
  claims?: Claim[];
  customerPhone?: string;
  quiet?: boolean;
  textOutcome?: Record<string, unknown> | (() => never);
  invoice?: Record<string, unknown> | null;
}) {
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const finishes: Finish[] = [];
  const texts: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      const data =
        table === "customers"
          ? { id: "cust-1", phone: options.customerPhone ?? "(805) 555-0100", email: "c@example.com" }
          : table === "messaging_settings"
            ? options.quiet
              ? { quiet_hours_start: "00:00:00", quiet_hours_end: "23:59:00" }
              : { quiet_hours_start: "23:59:00", quiet_hours_end: "00:00:00" }
            : table === "organizations"
              ? { timezone: "UTC" }
              : table === "invoices"
                ? (options.invoice ?? null)
                : null;
      const q = {
        select: () => q,
        eq: () => q,
        not: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data, error: null }),
      };
      return q;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      if (name === "claim_supervised_actions") return { data: options.claims ?? [], error: null };
      finishes.push(args);
      return { data: [{ ok: true, status: "done" }], error: null };
    },
  };
  const exports: { runSupervisedWorker?: (o?: unknown) => Promise<{ claimed: number; results: { outcome: string }[] }> } = {};
  runInNewContext(source, {
    exports,
    console: { error() {} },
    process: { env: { VOLTEIRA_PHASE2_EXECUTE: options.execute ?? "" } },
    Date,
    require(name: string) {
      if (name === "server-only") return {};
      if (name.endsWith("/customer-text"))
        return {
          sendCustomerText: async (_db: unknown, input: Record<string, unknown>) => {
            texts.push(input);
            if (typeof options.textOutcome === "function") options.textOutcome();
            return options.textOutcome ?? { ok: true, providerMessageId: "SM1", messageId: "m1" };
          },
        };
      if (name.endsWith("/email")) return { sendEmail: async () => ({ ok: true, id: "e1" }) };
      if (name.endsWith("/messaging-rules")) return rules;
      if (name.endsWith("/phone-format")) return phone;
      if (name.endsWith("/supervised-actions")) return policy;
      if (name.endsWith("/supabase/admin")) return { getSupabaseAdmin: () => db };
      if (name.endsWith("/supabase/flexible")) return { asFlexibleClient: (client: unknown) => client };
      if (name.endsWith("/twilio")) return { sendSms: async () => ({ ok: true }) };
      throw new Error(`unexpected import ${name}`);
    },
  });
  return { run: () => exports.runSupervisedWorker!({}), rpcs, finishes, texts };
}

const textClaim: Claim = {
  id: "p1",
  organization_id: "org-1",
  action_type: "send_customer_message",
  content: "Hi, your invoice is due.",
  claim_token: "token-1",
  attempts: 1,
  customer_id: "cust-1",
  recipient: "+18055550100",
  template_key: "invoice_overdue",
  payload: {},
  idempotency_key: "k1",
};

test("nothing runs unless the deployment names the action types", async () => {
  const off = harness({ claims: [textClaim] });
  assert.equal((await off.run()).claimed, 0);
  assert.equal(off.rpcs.length, 0);
});

test("binding and financial actions are never claimed, even when named", async () => {
  const h = harness({ execute: "issue_refund,send_contract,purchase_materials,send_customer_message", claims: [] });
  await h.run();
  assert.deepEqual(h.rpcs[0]?.args.p_action_types, ["send_customer_message"]);
});

test("an approved text goes to the approved number and records the provider id against the claim", async () => {
  const h = harness({ execute: "send_customer_message", claims: [textClaim] });
  const report = await h.run();
  assert.equal(report.results[0]?.outcome, "succeeded");
  assert.equal(h.texts[0]?.to, "+18055550100");
  assert.equal(h.finishes[0]?.p_claim_token, "token-1");
  assert.equal(h.finishes[0]?.p_external_ref, "SM1");
});

test("a number changed since approval is not texted", async () => {
  const h = harness({ execute: "send_customer_message", claims: [textClaim], customerPhone: "(805) 555-0199" });
  assert.equal((await h.run()).results[0]?.outcome, "failed");
  assert.equal(h.texts.length, 0);
});

test("quiet hours defer the text instead of sending it", async () => {
  const h = harness({ execute: "send_customer_message", claims: [textClaim], quiet: true });
  assert.equal((await h.run()).results[0]?.outcome, "deferred");
  assert.equal(h.texts.length, 0);
  assert.ok(h.finishes[0]?.p_retry_at);
});

test("a dropped connection is uncertain, a STOP is a failure, a rate limit is retried", async () => {
  const sendFailed = (errorCode: string) => ({ ok: false, sent: false, code: "SEND_FAILED", message: "x", messageId: "m1", errorCode });
  const outcomes = [];
  for (const errorCode of ["network_error", "replied_stop", "21610", "429", "503"]) {
    const h = harness({ execute: "send_customer_message", claims: [textClaim], textOutcome: sendFailed(errorCode) });
    outcomes.push((await h.run()).results[0]?.outcome);
  }
  assert.deepEqual(outcomes, ["uncertain", "failed", "failed", "retryable", "uncertain"]);
});

test("no consent: not sent, and not retried", async () => {
  const h = harness({
    execute: "send_customer_message",
    claims: [textClaim],
    textOutcome: { ok: false, sent: false, code: "NO_CONSENT", message: "No consent." },
  });
  assert.equal((await h.run()).results[0]?.outcome, "failed");
});

test("a handler that throws partway leaves the action uncertain", async () => {
  const h = harness({
    execute: "send_customer_message",
    claims: [textClaim],
    textOutcome: () => {
      throw new Error("socket hang up");
    },
  });
  assert.equal((await h.run()).results[0]?.outcome, "uncertain");
});

const reminder: Claim = { ...textClaim, amount_cents: 20000, payload: { invoice_id: "inv-1", due_at: "2026-11-01T00:00:00Z" } };

test("an invoice reminder is not sent once the invoice is paid, voided or changed", async () => {
  const cases: [Record<string, unknown> | null, string][] = [
    [{ status: "paid", balance_due_cents: 0, due_at: "2026-11-01T00:00:00Z" }, "paid"],
    [{ status: "void", balance_due_cents: 20000, due_at: "2026-11-01T00:00:00Z" }, "void"],
    [{ status: "sent", balance_due_cents: 5000, due_at: "2026-11-01T00:00:00Z" }, "part paid"],
    [{ status: "sent", balance_due_cents: 20000, due_at: "2026-12-01T00:00:00Z" }, "new due date"],
    [null, "deleted"],
  ];
  for (const [invoice, label] of cases) {
    const h = harness({ execute: "send_customer_message", claims: [reminder], invoice });
    assert.equal((await h.run()).results[0]?.outcome, "failed", label);
    assert.equal(h.texts.length, 0, label);
  }
});

test("a reminder whose invoice is unchanged still goes out", async () => {
  const h = harness({
    execute: "send_customer_message",
    claims: [reminder],
    invoice: { status: "sent", balance_due_cents: 20000, due_at: "2026-11-01T00:00:00Z" },
  });
  assert.equal((await h.run()).results[0]?.outcome, "succeeded");
  assert.equal(h.texts.length, 1);
});
