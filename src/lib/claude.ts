import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { INTAKE_TOOLS, type IntakeDecision } from "@/lib/sms-intake";

/**
 * The one place this app talks to Claude.
 *
 * Used for reading inbound customer texts. Every call is a single request with
 * a forced tool choice — no agent loop, no streaming: a text arrives, one
 * decision comes back, the caller executes it.
 */

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  client = new Anthropic({ apiKey });
  return client;
}

export function claudeIsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type IntakeTurn = { role: "user" | "assistant"; text: string };

/**
 * Read a conversation and decide what the customer is asking for.
 *
 * Returns null rather than throwing: a model outage must not lose the
 * customer's message, and the caller has a safe fallback for every null.
 *
 * `tool_choice: any` forces a tool call, so there is no free-text branch to
 * handle — the model cannot answer the customer directly, only tell us what it
 * thinks they want.
 */
export async function readInboundText(input: {
  system: string;
  turns: IntakeTurn[];
}): Promise<IntakeDecision | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 1024,
      // A short extraction against a small context. Low effort keeps the reply
      // quick, which matters when someone is standing in a dark kitchen.
      output_config: { effort: "low" },
      system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
      tools: INTAKE_TOOLS as unknown as Anthropic.Tool[],
      tool_choice: { type: "any" },
      messages: input.turns.map((turn) => ({ role: turn.role, content: turn.text })),
    });

    if (response.stop_reason === "refusal") return null;

    const call = response.content.find((block) => block.type === "tool_use");
    if (!call || call.type !== "tool_use") return null;

    return { tool: call.name, input: (call.input ?? {}) as Record<string, unknown> };
  } catch {
    // Rate limits, outages, a malformed schema — all the same to the caller:
    // no decision, fall back to asking the customer a question.
    return null;
  }
}
