import test from "node:test";
import assert from "node:assert/strict";

import {
  MCP_PROTOCOL_VERSION,
  handleMcpRequest,
  negotiateProtocolVersion,
  type McpTool,
  type ToolResult,
} from "./mcp-protocol.ts";

const TOOLS: McpTool[] = [
  {
    name: "list_open_slots",
    description: "windows",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
];

type CallTool = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

function server(callTool: CallTool = async () => ({ text: "ok" })) {
  return {
    serverInfo: { name: "test", version: "1.0.0" },
    tools: TOOLS,
    callTool,
  };
}

test("initialize answers with the version the client asked for", async () => {
  const reply = await handleMcpRequest(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
    server(),
  );

  assert.equal(reply.status, 200);
  const body = reply.body as { result: { protocolVersion: string; capabilities: unknown } };
  assert.equal(body.result.protocolVersion, "2025-03-26");
  assert.deepEqual(body.result.capabilities, { tools: { listChanged: false } });
});

test("a version we do not speak negotiates down to one we do", () => {
  assert.equal(negotiateProtocolVersion("1999-01-01"), MCP_PROTOCOL_VERSION);
  assert.equal(negotiateProtocolVersion(undefined), MCP_PROTOCOL_VERSION);
});

test("a notification gets 202 and no body", async () => {
  const reply = await handleMcpRequest(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    server(),
  );
  assert.equal(reply.status, 202);
  assert.equal(reply.body, undefined);
});

test("tools/list returns the tools", async () => {
  const reply = await handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, server());
  const body = reply.body as { result: { tools: McpTool[] } };
  assert.deepEqual(
    body.result.tools.map((tool) => tool.name),
    ["list_open_slots"],
  );
});

test("tools/call passes the arguments through and wraps the text", async () => {
  let seen: unknown;
  const reply = await handleMcpRequest(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_open_slots", arguments: { a: 1 } },
    },
    server(async (name, args) => {
      seen = { name, args };
      return { text: "two windows" };
    }),
  );

  assert.deepEqual(seen, { name: "list_open_slots", args: { a: 1 } });
  const body = reply.body as { result: { content: { type: string; text: string }[]; isError: boolean } };
  assert.deepEqual(body.result.content, [{ type: "text", text: "two windows" }]);
  assert.equal(body.result.isError, false);
});

test("a tool that throws comes back as a result, not a protocol error", async () => {
  // A caller is on the line. The model needs words it can say, and a JSON-RPC
  // error is not something it can say.
  const reply = await handleMcpRequest(
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_open_slots" } },
    server(async () => {
      throw new Error("database is down");
    }),
  );

  assert.equal(reply.status, 200);
  const body = reply.body as { result: { isError: boolean; content: { text: string }[] }; error?: unknown };
  assert.equal(body.error, undefined);
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0]!.text, /call them back/i);
});

test("a tool the server does not have is refused before it is run", async () => {
  let called = false;
  const reply = await handleMcpRequest(
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "drop_tables" } },
    server(async () => {
      called = true;
      return { text: "ok" };
    }),
  );

  assert.equal(called, false);
  const body = reply.body as { error: { code: number } };
  assert.equal(body.error.code, -32602);
});

test("an unknown method is method-not-found", async () => {
  const reply = await handleMcpRequest(
    { jsonrpc: "2.0", id: 6, method: "resources/list" },
    server(),
  );
  const body = reply.body as { error: { code: number } };
  assert.equal(body.error.code, -32601);
});

test("something that is not a JSON-RPC message is refused", async () => {
  const reply = await handleMcpRequest({ hello: "there" }, server());
  const body = reply.body as { error: { code: number } };
  assert.equal(body.error.code, -32600);
});

test("a batch answers only the requests in it", async () => {
  const reply = await handleMcpRequest(
    [
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 7, method: "ping" },
    ],
    server(),
  );

  const body = reply.body as { id: number }[];
  assert.equal(body.length, 1);
  assert.equal(body[0]!.id, 7);
});

test("a batch of nothing but notifications gets 202", async () => {
  const reply = await handleMcpRequest(
    [{ jsonrpc: "2.0", method: "notifications/cancelled" }],
    server(),
  );
  assert.equal(reply.status, 202);
  assert.equal(reply.body, undefined);
});
