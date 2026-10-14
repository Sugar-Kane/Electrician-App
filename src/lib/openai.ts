import "server-only";

import { describeKeyRefusal } from "@/lib/ai-key-rules";
import { ReplyCutOff } from "@/lib/reply-cut-off";

/**
 * Talking to OpenAI on a business's own key. Plain HTTPS rather than a client
 * library: three calls, the model list, a streamed chat, and a web search.
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
 * `OpenAiRefusal` when OpenAI says no before anything was written, and a
 * `ReplyCutOff` when the reply stopped short of finishing.
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
  // Why the reply ended: "stop" when it finished, "length" when it ran out of
  // room, or nothing at all when the connection dropped first.
  let finish = "";
  reading: for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") break reading;
      try {
        const chunk = JSON.parse(data) as {
          choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
        };
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield text;
        const reason = chunk.choices?.[0]?.finish_reason;
        if (reason) finish = reason;
      } catch {
        // A keep-alive or a partial line; the next one carries on.
      }
    }
  }
  if (finish === "length") throw new ReplyCutOff();
  if (finish !== "stop") throw new Error(`the reply ended without finishing (${finish || "no finish reason"})`);
}

export type WebSearchAnswer = {
  /** What the model wrote once it had searched. */
  text: string;
  /** Whether it searched at all, rather than answering from memory. */
  searched: boolean;
  /** Every page the search returned or the answer cites. */
  sources: string[];
};

function collectSources(value: unknown, into: Set<string>) {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.url === "string") into.add(record.url);
  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) for (const each of nested) collectSources(each, into);
    else if (nested && typeof nested === "object") collectSources(nested, into);
  }
}

/**
 * One answer written after searching the web, only on the sites given.
 * Throws an `OpenAiRefusal` when OpenAI says no, and a `ReplyCutOff` when the
 * answer ran out of room before it finished.
 */
export async function searchOpenAiWeb(input: {
  key: string;
  model: string;
  instructions: string;
  prompt: string;
  allowedDomains: string[];
  place?: { city?: string; region?: string };
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<WebSearchAnswer> {
  const location: Record<string, string> = { type: "approximate", country: "US" };
  if (input.place?.city) location.city = input.place.city;
  if (input.place?.region) location.region = input.place.region;
  const body: Record<string, unknown> = {
    model: input.model,
    instructions: input.instructions,
    input: input.prompt,
    tools: [{ type: "web_search", filters: { allowed_domains: input.allowedDomains }, user_location: location }],
    // Searching is the point: left to choose, a model can answer from memory,
    // and an answer with no search behind it is thrown away.
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    max_output_tokens: input.maxTokens,
  };
  if (/^(gpt-5|o\d)/.test(input.model)) body.reasoning = { effort: "low" };

  const send = (payload: Record<string, unknown>) =>
    fetch(`${BASE()}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${input.key}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: input.signal,
      cache: "no-store",
    });

  let response: Response;
  try {
    response = await send(body);
    if (response.status === 400 && "reasoning" in body) {
      const said = await response.clone().text();
      if (/reasoning/i.test(said)) {
        const retry = { ...body };
        delete retry.reasoning;
        response = await send(retry);
      }
    }
  } catch (error) {
    if (input.signal?.aborted) throw error;
    throw new OpenAiRefusal(0, describeKeyRefusal(0, ""));
  }
  if (!response.ok) {
    if (response.status === 400) {
      const said = await response.clone().text();
      if (/web_search|tool/i.test(said)) {
        throw new OpenAiRefusal(400, "This ChatGPT key's model can't search the web, so store prices can't be looked up.");
      }
    }
    throw await refusal(response);
  }

  const answer = (await response.json()) as {
    status?: string;
    incomplete_details?: { reason?: string } | null;
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  };
  if (answer.status === "incomplete" && answer.incomplete_details?.reason === "max_output_tokens") throw new ReplyCutOff();
  if (answer.status && answer.status !== "completed") throw new Error(`the search ended without finishing (${answer.status})`);

  const output = Array.isArray(answer.output) ? answer.output : [];
  const sources = new Set<string>();
  let searched = false;
  const text: string[] = [];
  for (const item of output) {
    if (item?.type === "web_search_call") {
      searched = true;
      collectSources(item, sources);
    } else if (item?.type === "message") {
      for (const part of item.content ?? []) {
        if (part?.type === "output_text" && typeof part.text === "string") text.push(part.text);
        collectSources(part, sources);
      }
    }
  }
  return { text: text.join(""), searched, sources: [...sources] };
}
