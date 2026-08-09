/**
 * The Model Context Protocol wire format, and nothing else.
 *
 * A voice model that can book an appointment needs tools it can call mid-call.
 * MCP is how xAI's realtime API takes them: it is handed an HTTPS URL and it
 * speaks JSON-RPC 2.0 to it over Streamable HTTP. That framing is small enough
 * to implement directly, and doing so keeps a large SDK — and its own idea of
 * how a server should be structured — out of a Next route handler.
 *
 * This module knows about envelopes, not about electricians. It is import-free
 * so the protocol can be exercised without a database.
 *
 * Stateless by choice: no session is issued at initialize, so no state has to
 * survive between two serverless invocations. The caller's identity travels in
 * the URL instead (see mcp-session-token), which is what makes that safe.
 */

/** The newest version we implement. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** Versions we will negotiate down to if a client asks for one of them. */
export const SUPPORTED_MCP_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export type JsonRpcId = string | number | null;

export type McpTool = {
  name: string;
  title?: string;
  description: string;
  /** JSON Schema. Objects only — MCP tool arguments are always an object. */
  inputSchema: Record<string, unknown>;
};

/**
 * What a tool did.
 *
 * `isError` is deliberately part of the *result*, not a JSON-RPC error: a
 * refusal ("that window is not open") is something the model should read and
 * respond to, while a JSON-RPC error is a protocol failure it can only give up
 * on. Booking rules produce the former.
 */
export type ToolResult = { text: string; isError?: boolean };

export type McpReply = { status: number; body?: unknown };

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorBody(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function resultBody(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

/** The protocol version to answer `initialize` with. */
export function negotiateProtocolVersion(requested: unknown): string {
  const asked = typeof requested === "string" ? requested : "";
  return (SUPPORTED_MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked)
    ? asked
    : MCP_PROTOCOL_VERSION;
}

export type McpServerOptions = {
  serverInfo: { name: string; version: string };
  tools: McpTool[];
  callTool: (name: string, args: JsonRecord) => Promise<ToolResult>;
};

/**
 * Answer one JSON-RPC message.
 *
 * Returns `undefined` for anything that takes no response — notifications, and
 * responses to requests we never send. The caller turns that into a 202.
 */
async function handleOne(
  message: unknown,
  options: McpServerOptions,
): Promise<JsonRecord | undefined> {
  if (!isRecord(message) || message.jsonrpc !== "2.0") {
    return errorBody(null, -32600, "Invalid Request: not a JSON-RPC 2.0 message");
  }

  const method = typeof message.method === "string" ? message.method : "";
  const hasId = "id" in message && (typeof message.id === "string" || typeof message.id === "number");
  const id = hasId ? (message.id as JsonRpcId) : null;

  // No method and an id means this is a response to something we sent. We never
  // send requests, so there is nothing to do with it.
  if (!method) return undefined;

  // Notifications carry no id and are never answered, whatever they say.
  if (!hasId) return undefined;

  const params = isRecord(message.params) ? message.params : {};

  switch (method) {
    case "initialize":
      return resultBody(id, {
        protocolVersion: negotiateProtocolVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: options.serverInfo,
      });

    case "ping":
      return resultBody(id, {});

    case "tools/list":
      return resultBody(id, { tools: options.tools });

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = isRecord(params.arguments) ? params.arguments : {};

      if (!options.tools.some((tool) => tool.name === name)) {
        return errorBody(id, -32602, `Unknown tool: ${name || "(none given)"}`);
      }

      try {
        const result = await options.callTool(name, args);
        return resultBody(id, {
          content: [{ type: "text", text: result.text }],
          isError: result.isError === true,
        });
      } catch {
        // A thrown tool is still a tool result: the model is mid-call with a
        // customer on the line and needs something it can say out loud, not a
        // protocol error that ends the exchange.
        return resultBody(id, {
          content: [
            {
              type: "text",
              text: "That did not go through. Tell the customer you will have someone call them back, and do not promise a time.",
            },
          ],
          isError: true,
        });
      }
    }

    default:
      return errorBody(id, -32601, `Method not found: ${method}`);
  }
}

/**
 * Answer one POST body, which may be a single message or a batch of them.
 *
 * A body containing only notifications gets 202 and no content, which is what
 * the transport specification asks for.
 */
export async function handleMcpRequest(
  body: unknown,
  options: McpServerOptions,
): Promise<McpReply> {
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return { status: 400, body: errorBody(null, -32600, "Invalid Request: empty batch") };
    }
    const replies: JsonRecord[] = [];
    for (const message of body) {
      const reply = await handleOne(message, options);
      if (reply) replies.push(reply);
    }
    return replies.length > 0 ? { status: 200, body: replies } : { status: 202 };
  }

  const reply = await handleOne(body, options);
  return reply ? { status: 200, body: reply } : { status: 202 };
}
