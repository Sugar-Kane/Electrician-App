import test from "node:test";
import assert from "node:assert/strict";

import {
  ASSISTANT_TOOLS,
  assistantToolPrompt,
  describeProposal,
  findTool,
  requiresConfirmation,
} from "./assistant-tools.ts";

test("everything that reaches a customer needs a tap", () => {
  // The line that matters. A misheard instruction becoming a real bill in a
  // real customer's inbox has no undo.
  for (const tool of ASSISTANT_TOOLS) {
    if (tool.outbound) {
      assert.equal(tool.confirm, true, `${tool.name} is outbound and must confirm`);
    }
  }

  assert.equal(requiresConfirmation("send_invoice"), true);
  assert.equal(requiresConfirmation("send_text"), true);
});

test("everything that changes a record needs a tap too", () => {
  for (const name of [
    "schedule_job",
    "set_invoice_amount",
    "draft_contract",
    // Stock is a record like any other. A misheard "three" that quietly takes
    // thirty off the shelf is a van that arrives at the next job empty.
    "adjust_stock",
    "add_stock_item",
  ] as const) {
    assert.equal(requiresConfirmation(name), true, name);
  }
});

test("a stock change says what it will do before it does it", () => {
  // Read off the confirmation card, so the sentence has to be the action.
  assert.match(
    describeProposal("adjust_stock", { part: "20A breaker", quantity: "6", reason: "received" }),
    /Add 6 20A breaker/,
  );
  assert.match(
    describeProposal("adjust_stock", { part: "20A breaker", quantity: "17", reason: "stock_take" }),
    /Set the count of 20A breaker to 17/,
  );
  assert.match(
    describeProposal("adjust_stock", { part: "wire nuts", quantity: "2", reason: "wastage" }),
    /Take 2 wire nuts out/,
  );
  assert.match(
    describeProposal("add_stock_item", { name: "AFCI breaker", quantity: "4" }),
    /Add AFCI breaker to the stock list with 4 on hand/,
  );
});

test("reading runs immediately", () => {
  // A search that returns the wrong customer costs a second look, not a
  // customer relationship.
  for (const name of [
    "search_jobs",
    "search_customers",
    "check_stock",
    "search_stock",
    "list_invoices",
    "lookup_code",
  ] as const) {
    assert.equal(requiresConfirmation(name), false, name);
  }
});

test("an unknown tool is treated as needing confirmation", () => {
  // The model and this list disagreeing is precisely the moment not to act on
  // the model's word.
  assert.equal(requiresConfirmation("delete_everything"), true);
  assert.equal(requiresConfirmation(""), true);
  assert.equal(findTool("delete_everything"), undefined);
});

test("a proposal names the recipient and quotes the payload", () => {
  // "Send the invoice" is not something anybody can meaningfully approve.
  assert.equal(
    describeProposal("send_invoice", { invoice_number: "INV-10024", channel: "both" }),
    "Send invoice INV-10024 to the customer by text and email.",
  );

  const texted = describeProposal("send_text", {
    customer: "Dana Harper",
    message: "Running 20 minutes late.",
  });
  assert.match(texted, /Dana Harper/);
  assert.match(texted, /Running 20 minutes late\./);
});

test("a proposal with a missing field says so rather than reading as complete", () => {
  // A summary that quietly omits the amount is one somebody approves without
  // noticing there is no amount.
  assert.match(describeProposal("set_invoice_amount", { job_number: "1045" }), /\(no amount\)/);
  assert.match(describeProposal("send_invoice", { channel: "sms" }), /\(unspecified\)/);
  assert.match(describeProposal("schedule_job", { job_number: "1045" }), /\(no time\)/);
});

test("scheduling states the duration it will actually use", () => {
  const summary = describeProposal("schedule_job", {
    job_number: "1045",
    start_local: "2026-08-18T08:00",
    duration_hours: "",
  });

  assert.match(summary, /for 2 hours/);
});

test("every tool has a schema the API will accept", () => {
  for (const tool of ASSISTANT_TOOLS) {
    assert.equal(tool.input_schema.type, "object");
    assert.equal(tool.input_schema.additionalProperties, false);

    // Strict tool use requires every property to be required.
    const properties = Object.keys(tool.input_schema.properties);
    assert.deepEqual(
      [...tool.input_schema.required].sort(),
      properties.sort(),
      `${tool.name} required does not match its properties`,
    );
  }
});

test("tool names are unique and findable", () => {
  const names = ASSISTANT_TOOLS.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);

  for (const name of names) {
    assert.equal(findTool(name)?.name, name);
  }
});

test("the prompt forbids claiming an action that has only been proposed", () => {
  // A model saying "sent" while a confirmation sits unread is worse than one
  // that cannot send at all, because nobody goes back to check.
  const prompt = assistantToolPrompt("Pacific Plains Electric");

  assert.match(prompt, /Never say you have sent, booked, invoiced or drafted something you have only proposed/i);
  assert.match(prompt, /Never invent a job number/i);
  assert.match(prompt, /call lookup_code/i);
});

test("assigning a technician needs a tap, listing them does not", () => {
  // Listing is a read. Putting somebody on a job changes who drives where.
  assert.equal(requiresConfirmation("list_technicians"), false);
  assert.equal(requiresConfirmation("assign_technician"), true);
});

test("an empty technician name reads as unassigning, not as a missing field", () => {
  // The two are genuinely different instructions, and a summary that blurred
  // them would let somebody approve "put (unspecified) on #5".
  assert.equal(
    describeProposal("assign_technician", { job_number: "5", technician: "Nick" }),
    "Put Nick on job #5.",
  );
  assert.equal(
    describeProposal("assign_technician", { job_number: "5", technician: "" }),
    "Take the assigned technician off job #5.",
  );
});
