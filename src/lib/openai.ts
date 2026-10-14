import "server-only";

import { describeKeyRefusal } from "@/lib/ai-key-rules";

/**
 * Talking to OpenAI on a business's own key. Plain HTTPS rather than a client
 * library: two calls, the model list and a streamed chat.
 *
 * `OPENAI_BASE_URL` points it elsewhere for a local test, like
 * `ANTHROPIC_BASE_URL` does for Claude. It is never set in production.
 */

const BASE = () => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");

export class OpenAiRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function refusal(response: Response): Promise<OpenAiRefusal> {
  let said = "";
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    said = body?.error?.message ?? "";
  } catch {
    // An answer with no JSON says nothing more than its status.
  }
  return new OpenAiRefusal(response.status, describeKeyRefusal(response.status, said));
}

/** The models this key may use. Doubles as the check that the key works. */
export async function listOpenAiModels(key: string): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(`${BASE()}/models`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new OpenAiRefusal(0, describeKeyRefusal(0, ""));
  }
  if (!response.ok) throw await refusal(response);
  const body = (await response.json()) as { data?: { id?: unknown }[] };
  return (body.data ?? []).map((model) => (typeof model.id === "string" ? model.id : "")).filter(Boolean);
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * A chat reply, as it is written. Yields text as it arrives; throws an
 * `OpenAiRefusal` when OpenAI says no before anything was written.
 */
export async function* streamOpenAiChat(input: {
  key: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    stream: true,
    max_completion_tokens: input.maxTokens,
  };
  // Reasoning models think before writing; a materials list needs little of
  // it, and the person is watching a spinner.
  if (/^(gpt-5|o\d)/.test(input.model)) body.reasoning_effort = "low";

  const send = (payload: Record<string, unknown>) =>
    fetch(`${BASE()}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${input.key}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: input.signal,
      cache: "no-store",
    });

  let response: Response;
  try {
    response = await send(body);
    // A model that does not take a reasoning setting says so; ask again without it.
    if (response.status === 400 && "reasoning_effort" in body) {
      const retry = { ...body };
      delete retry.reasoning_effort;
      const said = await response.clone().text();
      if (/reasoning/i.test(said)) response = await send(retry);
    }
  } catch (error) {
    if (input.signal?.aborted) throw error;
    throw new OpenAiRefusal(0, describeKeyRefusal(0, ""));
  }
  if (!response.ok || !response.body) throw await refusal(response);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[] };
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield text;
      } catch {
        // A keep-alive or a partial line; the next one carries on.
      }
    }
  }
}
