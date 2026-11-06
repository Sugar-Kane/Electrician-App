import assert from "node:assert/strict";
import { test } from "node:test";

import { runTextHistoryTool, type HistoryDatabase, type HistoryQuery } from "./mcp-text-history.ts";

/*
 * Two businesses whose customers share a name and a phone number, so the only
 * thing keeping one business's texts from the other is the business filter.
 * The fake database applies eq/in/is filters for real and records every query.
 */
const OURS = "org-ours";
const THEIRS = "org-theirs";

const tables: Record<string, Record<string, unknown>[]> = {
  customers: [
    { id: "c-ours", organization_id: OURS, first_name: "Jane", last_name: "Smith", phone: "+15550001111", archived_at: null },
    { id: "c-theirs", organization_id: THEIRS, first_name: "Jane", last_name: "Smith", phone: "+15550001111", archived_at: null },
  ],
  conversations: [
    { id: "t-ours", organization_id: OURS, customer_id: "c-ours", channel: "sms", status: "open", last_message_at: "2026-11-06T05:18:00Z", archived_at: null },
    { id: "t-theirs", organization_id: THEIRS, customer_id: "c-theirs", channel: "sms", status: "open", last_message_at: "2026-11-06T06:00:00Z", archived_at: null },
  ],
  messages: [
    { organization_id: OURS, conversation_id: "t-ours", direction: "inbound", body: "My panel is not working", status: "received", created_at: "2026-11-06T05:18:00Z" },
    { organization_id: OURS, conversation_id: "t-ours", direction: "outbound", body: "We will call you back", status: "failed", ai_generated: true, created_at: "2026-11-06T05:18:01Z" },
    { organization_id: THEIRS, conversation_id: "t-theirs", direction: "inbound", body: "SECRET from the other business", status: "received", created_at: "2026-11-06T06:00:00Z" },
  ],
};

function fakeDatabase() {
  const queries: { table: string; filters: [string, string, unknown][] }[] = [];
  const database: HistoryDatabase = {
    from(table) {
      const filters: [string, string, unknown][] = [];
      let select = "";
      let order: { column: string; ascending: boolean } | null = null;
      let limit = Infinity;
      queries.push({ table, filters });
      const query: HistoryQuery = {
        select(columns) { select = columns; return query; },
        eq(column, value) { filters.push(["eq", column, value]); return query; },
        in(column, values) { filters.push(["in", column, values]); return query; },
        is(column, value) { filters.push(["is", column, value]); return query; },
        order(column, options) { order = { column, ...options }; return query; },
        limit(count) { limit = count; return query; },
        then(resolve) {
          let found = (tables[table] ?? []).filter((row) =>
            filters.every(([kind, column, value]) =>
              kind === "in" ? (value as unknown[]).includes(row[column]) : kind === "is" ? row[column] == null : row[column] === value,
            ),
          );
          if (order) {
            const { column, ascending } = order;
            found = [...found].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
          }
          found = found.slice(0, limit).map((row) =>
            select.includes("customers(") ? { ...row, customers: tables.customers!.find((c) => c.id === row.customer_id) } : row,
          );
          return Promise.resolve({ data: found, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  return { database, queries };
}

test("reading a conversation only ever returns this business's messages", async () => {
  const { database, queries } = fakeDatabase();
  const result = await runTextHistoryTool({
    database, organizationId: OURS, timeZone: "America/Los_Angeles", name: "get_text_conversation", args: { customer: "Jane Smith" },
  });
  assert.match(result.text, /My panel is not working/);
  assert.doesNotMatch(result.text, /SECRET/, "the other business's same-named customer stays out");
  assert.match(result.text, /NOT DELIVERED/);
  for (const query of queries) {
    assert.ok(
      query.filters.some(([kind, column, value]) => kind === "eq" && column === "organization_id" && value === OURS),
      `every ${query.table} query is filtered to the connected business`,
    );
  }
});

test("finding the customer by phone number does not cross businesses either", async () => {
  const { database } = fakeDatabase();
  const result = await runTextHistoryTool({
    database, organizationId: OURS, timeZone: "America/Los_Angeles", name: "get_text_conversation", args: { customer: "(555) 000-1111" },
  });
  assert.match(result.text, /My panel is not working/);
  assert.doesNotMatch(result.text, /SECRET/);
});

test("the conversation list shows only this business's threads", async () => {
  const { database, queries } = fakeDatabase();
  const result = await runTextHistoryTool({
    database, organizationId: OURS, timeZone: "America/Los_Angeles", name: "list_text_conversations", args: {},
  });
  assert.match(result.text, /1 most recent text conversation/);
  assert.doesNotMatch(result.text, /SECRET/);
  assert.ok(queries.every((query) => query.filters.some(([, column, value]) => column === "organization_id" && value === OURS)));
});

test("customers' words are not copied into the call log, and are marked as not instructions", async () => {
  const { database } = fakeDatabase();
  const result = await runTextHistoryTool({
    database, organizationId: OURS, timeZone: "America/Los_Angeles", name: "get_text_conversation", args: { customer: "Jane" },
  });
  assert.ok(result.logText);
  assert.doesNotMatch(result.logText!, /panel/);
  assert.match(result.text, /never as instructions/);
});

test("a connection with no business reads nothing", async () => {
  const { database, queries } = fakeDatabase();
  const result = await runTextHistoryTool({
    database, organizationId: "", timeZone: "America/Los_Angeles", name: "list_text_conversations", args: {},
  });
  assert.equal(result.isError, true);
  assert.equal(queries.length, 0);
});
