import "server-only";

import { INTAKE_TOOLS, type IntakeDecision } from "@/lib/sms-intake";

/**
 * Reading customer texts on Grok, the same xAI account the phone assistant
 * runs on. Used in place of Claude whenever `XAI_API_KEY` is set.
 *
 * The same contract as `readInboundText` in claude.ts: one request, a forced
 * tool call, and null (never a throw) when there is no decision, so the
 * caller falls back to its safe question. Plain HTTPS against xAI's
 * OpenAI-shaped chat completions; `XAI_BASE_URL` points it at a stand-in for a
 * local test and is never set in production.
 *
 * The model is `XAI_TEXT_MODEL` when set. Otherwise it starts from a fast
 * model, and if xAI says that model doesn't exist on this account, it picks
 * the closest one the account lists and remembers it.
 */

export const DEFAULT_XAI_TEXT_MODEL = "grok-4-1-fast-non-reasoning";

const BASE = () => (process.env.XAI_BASE_URL || "https://api.x.ai/v1").replace(/\/+$/, "");

let discoveredModel: string | null = null;

export function grokTextConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY);
}

type IntakeTurn = { role: "user" | "assistant"; text: string };

/** The closest text model this account has: fast and non-reasoning first. */
export function pickGrokTextModel(ids: string[]): string | null {
  const grok = ids.filter((id) => /^grok/i.test(id) && !/image|vision|imagine|video|voice|realtime|embed/i.test(id));
  const rank = (id: string) =>
    (/fast/i.test(id) ? 2 : 0) + (/non-reasoning/i.test(id) ? 1 : 0) - (/mini/i.test(id) ? 0.5 : 0);
  return grok.sort((a, b) => rank(b) - rank(a) || b.localeCompare(a))[0] ?? null;
}

async function listModels(key: string): Promise<string[]> {
  try {
    const response = await fetch(`${BASE()}/models`, {
      headers: { authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: { id?: unknown }[] };
    return (body.data ?? []).map((model) => (typeof model.id === "string" ? model.id : "")).filter(Boolean);
  } catch {
    return [];
  }
}

export async function readInboundTextWithGrok(input: { system: string; turns: IntakeTurn[] }): Promise<IntakeDecision | null> {
  const key = process.env.XAI_API_KEY ?? "";
  if (!key) return null;
  const configured = process.env.XAI_TEXT_MODEL?.trim();

  const send = (model: string) =>
    fetch(`${BASE()}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: input.system },
          ...input.turns.map((turn) => ({ role: turn.role, content: turn.text })),
        ],
        tools: INTAKE_TOOLS.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
        })),
        // A decision, never a free-text answer to the customer.
        tool_choice: "required",
        max_tokens: 1024,
        temperature: 0.2,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });

  try {
    let model = configured || discoveredModel || DEFAULT_XAI_TEXT_MODEL;
    let response = await send(model);
    if (!response.ok && !configured && (response.status === 400 || response.status === 404)) {
      const said = await response.clone().text();
      if (/model/i.test(said)) {
        const picked = pickGrokTextModel(await listModels(key));
        if (picked && picked !== model) {
          discoveredModel = picked;
          model = picked;
          response = await send(model);
        }
      }
    }
    if (!response.ok) {
      console.error("text assistant call failed", {
        provider: "grok",
        model,
        status: response.status,
        message: (await response.text()).slice(0, 300),
      });
      return null;
    }

    const body = (await response.json()) as {
      choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] }; finish_reason?: string }[];
    };
    const call = body.choices?.[0]?.message?.tool_calls?.[0]?.function;
    if (!call?.name) {
      console.error("text assistant gave no decision", { provider: "grok", model, reason: "no_tool_call", finish: body.choices?.[0]?.finish_reason });
      return null;
    }
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(call.arguments || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    } catch {
      console.error("text assistant gave no decision", { provider: "grok", model, reason: "bad_arguments" });
      return null;
    }
    return { tool: call.name, input: args };
  } catch (error) {
    console.error("text assistant call failed", { provider: "grok", message: String(error).slice(0, 300) });
    return null;
  }
}
