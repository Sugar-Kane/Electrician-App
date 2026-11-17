import assert from "node:assert/strict";
import { test } from "node:test";

import { redactLogArguments, scrubLogText } from "./mcp-log-redaction.ts";

/*
 * The MCP call log keeps what tracing a failure needs, and nothing that
 * identifies a customer or opens a link on its own.
 */

test("people's details are redacted whatever field they arrive in", () => {
  const kept = redactLogArguments({
    job_number: 32,
    customer_name: "Pat Customer",
    phone: "805-555-0100",
    email: "pat@example.com",
    address: "12 Elm St",
    message: "Gate code is 4471",
    notes: "Dog in yard",
    confirmed: true,
    discount_type: "percentage",
    customer_id: "11111111-1111-4111-8111-111111111111",
  });
  assert.deepEqual(kept, {
    job_number: 32,
    customer_name: "[redacted]",
    phone: "[redacted]",
    email: "[redacted]",
    address: "[redacted]",
    message: "[redacted]",
    notes: "[redacted]",
    confirmed: true,
    discount_type: "percentage",
    customer_id: "11111111-1111-4111-8111-111111111111",
  });
});

test("details hiding in other fields are masked in the text", () => {
  const kept = redactLogArguments({ query: "call pat@example.com or (805) 555-0100" });
  assert.equal(kept.query, "call [email] or [phone]");
});

test("nested values are redacted too, and depth and size are bounded", () => {
  const kept = redactLogArguments({ lines: [{ kind: "labor", description: "Run circuit to 12 Elm St", quantity: 2 }] });
  assert.deepEqual(kept, { lines: [{ kind: "labor", description: "[redacted]", quantity: 2 }] });
  const deep = redactLogArguments({ a: { b: { c: { d: { e: 1 } } } } });
  assert.deepEqual(deep, { a: { b: { c: { d: "[nested]" } } } });
  const many = redactLogArguments({ ids: Array.from({ length: 100 }, (_, index) => index) });
  assert.equal((many.ids as unknown[]).length, 20);
});

test("results lose links, emails, phone numbers and card numbers, and are capped", () => {
  const text = scrubLogText(
    "Sent to pat@example.com and +1 805.555.0100. Sign: https://volteira.com/contract/2b1c6f3e-1111-4111-8111-111111111111 card 4242 4242 4242 4242",
  );
  assert.equal(text, "Sent to [email] and [phone]. Sign: [link] card [number]");
  assert.equal(scrubLogText("x".repeat(5000)).length, 1000);
});

test("amounts, job numbers and dates survive, so a failure can still be traced", () => {
  assert.equal(scrubLogText("Invoice INV-32 for $1,980.00 due Nov 17, 2026, job #32"), "Invoice INV-32 for $1,980.00 due Nov 17, 2026, job #32");
});

test("nothing is a bad input", () => {
  assert.deepEqual(redactLogArguments(undefined), {});
  assert.equal(scrubLogText(""), "");
});
