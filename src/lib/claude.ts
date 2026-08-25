import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { scopePrompt } from "@/lib/contract-template";
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

export type AssistantTurn = { role: "user" | "assistant"; text: string };

/**
 * Answer a question about the business.
 *
 * No tools and no database access. The brief is assembled by the caller from
 * rows already scoped to the session's organization and passed in as text, so
 * there is nothing here for a prompt injection to reach — the other tenants'
 * rows were never fetched.
 *
 * Returns null rather than throwing, like every other call in this file: a
 * model outage should render as "could not answer", not as a crashed page.
 */
export async function askAboutBusiness(input: {
  system: string;
  brief: string;
  turns: AssistantTurn[];
}): Promise<string | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 700,
      system: [
        { type: "text" as const, text: input.system },
        // Separate block, and named as data. The snapshot contains text
        // customers wrote.
        { type: "text" as const, text: `<business_snapshot>\n${input.brief}\n</business_snapshot>` },
      ],
      messages: input.turns.map((turn) => ({
        role: turn.role,
        content: turn.text,
      })),
    });

    const text = response.content
      .filter((block): block is { type: "text"; text: string; citations: never } =>
        block.type === "text",
      )
      .map((block) => block.text)
      .join("\n")
      .trim();

    return text || null;
  } catch {
    return null;
  }
}

/**
 * Draft the scope-of-work paragraph for a contract.
 *
 * The only thing a model is asked to write in a contract, and deliberately so:
 * names, addresses, dates and money are substituted deterministically by
 * `fillTemplate`. A model-written price contradicting the price section two
 * lines below it is the worst thing this feature could produce.
 *
 * Returns null on any failure, and the caller leaves {{scope}} unfilled rather
 * than shipping a contract with a made-up paragraph in it.
 */
export async function draftScope(input: {
  description: string;
  workType: string;
}): Promise<string | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const described = input.description.trim();
  if (!described) return null;

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 400,
      system: scopePrompt(),
      messages: [
        {
          role: "user",
          content: [
            `Kind of work booked: ${input.workType}`,
            "",
            "What the customer described:",
            described.slice(0, 2000),
          ].join("\n"),
        },
      ],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return text || null;
  } catch {
    return null;
  }
}

export type DraftedLine = {
  kind: "labor" | "material";
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
};

const WORK_ORDER_TOOL = {
  name: "propose_work_order",
  description:
    "Break a described job into the labour and materials it needs, with a quantity and a unit price for each.",
  input_schema: {
    type: "object",
    properties: {
      lines: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["labor", "material"] },
            description: {
              type: "string",
              description: "What the line is, as it would read on an invoice.",
            },
            quantity: { type: "number", description: "Hours for labour, count for materials." },
            unit: { type: "string", description: "hour, each, ft, box." },
            unitPriceCents: {
              type: "integer",
              description: "Price for one unit, in cents. 0 when there is no sensible figure.",
            },
          },
          required: ["kind", "description", "quantity", "unit", "unitPriceCents"],
          additionalProperties: false,
        },
      },
    },
    required: ["lines"],
    additionalProperties: false,
  },
} as const;

/**
 * A first draft of a work order, for the owner to correct.
 *
 * Deliberately a draft and nothing more. The lines land in an editable table
 * with the prices in ordinary inputs, nothing is written until Save, and the
 * screen says out loud that the figures are a starting point. A model that
 * quietly set the price of somebody's work would be the worst feature in this
 * app.
 *
 * Returns null rather than throwing: the button beside it goes back to saying
 * "Ask for a draft" and the owner types the lines themselves, which is what
 * they were going to do anyway.
 */
export async function draftWorkOrderLines(input: {
  description: string;
  /** "Panel or breaker", "EV charger" — whatever the customer said it was about. */
  context?: string;
}): Promise<DraftedLine[] | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const described = input.description.trim();
  if (described.length < 10) return null;

  try {
    const response = await anthropic.messages.create(
      {
        model: "claude-opus-5",
        max_tokens: 1200,
        system: [
          "You are helping a residential electrician in California itemise a job they have already agreed to do.",
          "Break the work into the labour and the materials it plainly needs.",
          "Prices are a starting point the electrician will correct, so use ordinary trade figures and never invent a precise-looking number you have no basis for — 0 is a better answer than a confident guess.",
          "Do not include the diagnostic visit; this is the repair.",
          "Keep it to the lines the described work actually needs. A short job is a short list.",
        ].join("\n"),
        tools: [WORK_ORDER_TOOL] as unknown as Anthropic.Tool[],
        tool_choice: { type: "tool", name: WORK_ORDER_TOOL.name },
        messages: [{ role: "user", content: described.slice(0, 4000) }],
      },
      { timeout: 30_000 },
    );

    const call = response.content.find((block) => block.type === "tool_use");
    if (!call || call.type !== "tool_use") return null;

    const proposed = (call.input as { lines?: unknown })?.lines;
    if (!Array.isArray(proposed)) return null;

    const lines: DraftedLine[] = [];

    for (const entry of proposed) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const description = typeof row.description === "string" ? row.description.trim() : "";
      if (!description) continue;

      const quantity = Number(row.quantity);
      const price = Number(row.unitPriceCents);
      const kind = row.kind === "material" ? "material" : "labor";

      lines.push({
        kind,
        description: description.slice(0, 300),
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        unit:
          (typeof row.unit === "string" ? row.unit.trim().slice(0, 24) : "") ||
          (kind === "labor" ? "hour" : "each"),
        unitPriceCents: Number.isFinite(price) && price > 0 ? Math.round(price) : 0,
      });
    }

    return lines;
  } catch (error) {
    console.error("work order draft failed", error);
    return null;
  }
}

const RECEIPT_TOOL = {
  name: "record_receipt",
  description: "Everything printed on this supplier receipt, line by line.",
  input_schema: {
    type: "object",
    properties: {
      supplier: {
        type: "string",
        description: "The shop's name as printed. Empty string if it cannot be read.",
      },
      purchased_on: {
        type: "string",
        description: "The date printed on it, as YYYY-MM-DD. Empty string if it cannot be read.",
      },
      total_cents: {
        type: "integer",
        description:
          "The final total printed on the receipt, in cents, tax included. 0 if it cannot be read.",
      },
      lines: {
        type: "array",
        maxItems: 40,
        description: "One entry per item bought. Subtotal, tax and total lines are not items.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "The item as printed on the receipt." },
            quantity: { type: "number", description: "How many were bought. 1 if not printed." },
            unit: { type: "string", description: "each, ft, box, roll. 'each' if not printed." },
            unit_cost_cents: {
              type: "integer",
              description:
                "What ONE costs, in cents, before tax. 0 when the line shows only a total you cannot divide confidently.",
            },
            part_number: {
              type: "string",
              description: "The SKU or model printed beside it. Empty string if there is none.",
            },
          },
          required: ["name", "quantity", "unit", "unit_cost_cents", "part_number"],
          additionalProperties: false,
        },
      },
    },
    required: ["supplier", "purchased_on", "total_cents", "lines"],
    additionalProperties: false,
  },
} as const;

/** What comes back from a receipt, before any of it is believed. */
export type ReadReceipt = {
  supplier: string;
  purchasedOn: string;
  totalCents: number;
  lines: unknown[];
};

/**
 * Read a photographed receipt.
 *
 * Extraction and nothing else: the shape of the answer is forced, and what it
 * says lands in an editable review table rather than in the stock list. That
 * ordering is the whole design. A thermal receipt photographed on a van seat is
 * about the hardest thing there is to read, and a scanner that wrote its
 * reading straight into inventory would put a wrong count on the shelf with
 * nothing anywhere to say where it came from.
 *
 * Returns null rather than throwing, like everything else in this file. The
 * caller turns null into "that could not be read — type it in instead", which
 * is exactly what somebody would have been doing anyway.
 */
export async function readReceipt(input: {
  block: { type: string; source: unknown };
}): Promise<ReadReceipt | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.create(
      {
        model: "claude-opus-5",
        max_tokens: 2000,
        system: [
          "You are reading a supplier receipt for an electrical contracting business, so its parts can be added to a stock list.",
          "Report only what is printed. Never infer a price, a quantity or a part number that is not on the paper — 0 and an empty string are correct answers and a plausible-looking invention is not.",
          "Prices are per unit and before tax. When a line shows only an extended total for several of something, divide it only if the quantity is printed clearly; otherwise report 0.",
          "Subtotal, tax, total, deposits, bag charges and delivery are not items. Leave them out of the lines and put the final total in total_cents.",
          "Expand abbreviations only where they are unambiguous trade shorthand. If a line is illegible, leave it out rather than guessing at it.",
        ].join("\n"),
        tools: [RECEIPT_TOOL] as unknown as Anthropic.Tool[],
        tool_choice: { type: "tool", name: RECEIPT_TOOL.name },
        messages: [
          {
            role: "user",
            content: [
              // The image first, which is what the API documentation asks for.
              input.block as unknown as Anthropic.ContentBlockParam,
              { type: "text", text: "Read this receipt." },
            ],
          },
        ],
      },
      { timeout: 60_000 },
    );

    const call = response.content.find((block) => block.type === "tool_use");
    if (!call || call.type !== "tool_use") return null;

    const read = (call.input ?? {}) as Record<string, unknown>;
    const total = Number(read.total_cents);

    return {
      supplier: typeof read.supplier === "string" ? read.supplier.trim().slice(0, 120) : "",
      purchasedOn: typeof read.purchased_on === "string" ? read.purchased_on.trim().slice(0, 10) : "",
      totalCents: Number.isFinite(total) && total > 0 ? Math.round(total) : 0,
      lines: Array.isArray(read.lines) ? read.lines : [],
    };
  } catch (error) {
    console.error("receipt read failed", error);
    return null;
  }
}

export type AgentToolCall = { id: string; name: string; input: Record<string, unknown> };
export type AgentReply = {
  text: string;
  calls: AgentToolCall[];
};

/**
 * One turn of the chat, with tools.
 *
 * Returns whatever the model said and whatever it asked to do. Deciding which
 * of those may actually run is not this function's job — that lives in
 * `assistant-tools`, so the boundary between reading and sending is one list
 * that can be read and tested rather than a branch buried in an API call.
 *
 * Returns null on failure rather than throwing, like everything else here.
 */
export async function runAssistantTurn(input: {
  system: string;
  brief: string;
  turns: { role: "user" | "assistant"; content: unknown }[];
  tools: { name: string; description: string; input_schema: unknown }[];
  /**
   * How long this one round may take.
   *
   * Without it a request that never comes back holds the whole turn open until
   * the platform kills the function, and a killed function never returns an
   * action — so the chat spins with no way out. A round that gives up returns
   * null, which the caller already knows how to say out loud.
   */
  timeoutMs?: number;
}): Promise<AgentReply | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.create(
      {
        model: "claude-opus-5",
        max_tokens: 1200,
        system: [
          { type: "text" as const, text: input.system },
          {
            type: "text" as const,
            text: `<business_snapshot>\n${input.brief}\n</business_snapshot>`,
          },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: input.tools as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: input.turns as any,
      },
      input.timeoutMs ? { timeout: input.timeoutMs } : undefined,
    );

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n")
      .trim();

    const calls: AgentToolCall[] = response.content
      .filter((block) => block.type === "tool_use")
      .map((block) => {
        const call = block as { id: string; name: string; input: unknown };
        return {
          id: call.id,
          name: call.name,
          input: (call.input ?? {}) as Record<string, unknown>,
        };
      });

    return { text, calls };
  } catch (error) {
    // Said out loud, because the caller turns null into one calm sentence for
    // the person asking and there would otherwise be nothing anywhere saying
    // whether it was a timeout, a bad key or an outage.
    console.error("assistant turn failed", error);
    return null;
  }
}
