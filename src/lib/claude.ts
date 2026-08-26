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

export type PriceLookup = {
  /** What was found, in the model's words. */
  answer: string;
  /** The domains it came from, so a figure can be traced rather than trusted. */
  sources: string[];
  /**
   * Whether a search actually ran and returned results.
   *
   * False is the important case. If the search fails the model will happily
   * answer from memory, and a remembered price handed to an electrician about
   * to quote a job is worse than no answer — it looks identical to a real one.
   * The caller refuses to pass it on.
   */
  searched: boolean;
};

/*
 * The search tool, and the reason for this exact version.
 *
 * `web_search_20260209` is the variant with dynamic filtering, for Opus 4.6 and
 * later. `web_search_20250305` is the older basic one; the SDK's type union
 * lists it first and it is the easy thing to reach for by mistake.
 *
 * Deliberately no `code_execution` beside it — this version runs code under the
 * hood, and declaring a second execution environment confuses the model.
 */
const PRICE_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
  // Three is enough to check a couple of suppliers and stop. Without a cap a
  // single question can run up a search bill on somebody's behalf.
  max_uses: 3,
} as const;

/**
 * What a part costs, from the public web.
 *
 * The question that comes just before every estimate — "what does a 200A panel
 * run these days" — and the one thing the assistant could not answer. It knew
 * what was on the van and what it had been bought for, and nothing about what
 * the next one would cost.
 *
 * What comes back is a **public list price**, and the caller is careful to say
 * so. It is not this business's price: it has no trade discount in it, no
 * markup, and no idea what this electrician's supply house charges them. A
 * figure presented as anything firmer would end up in a quote.
 *
 * Located to the business, because a price in Santa Maria is not a price in
 * Boston, and because sales tax and availability both move by state.
 */
export async function lookUpListPrice(input: {
  part: string;
  city: string;
  state: string;
  timeZone: string;
}): Promise<PriceLookup | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const part = input.part.trim().slice(0, 200);
  if (!part) return null;

  try {
    const response = await anthropic.messages.create(
      {
        model: "claude-opus-5",
        max_tokens: 1200,
        system: [
          "You are pricing electrical parts for a residential electrical contractor in the United States.",
          "Search for what the part currently sells for at ordinary suppliers, and report a figure or a range with the date it was seen.",
          "This is a public list price. Say so. It carries no trade discount and is not what this business pays.",
          "If the searches do not turn up a price for the part asked about, say that plainly. Never fall back on a remembered figure — a made-up price ends up in somebody's quote.",
          "Two or three sentences. The person reading is holding a phone.",
        ].join("\n"),
        /*
         * Typed against the SDK rather than cast through `any`.
         *
         * This request cannot be exercised without a key, so the compiler
         * checking the tool declaration is the only proof available that the
         * shape is right — and a misdeclared server tool fails at runtime in
         * production, where nobody is watching.
         */
        tools: [
          {
            ...PRICE_SEARCH_TOOL,
            user_location: {
              type: "approximate",
              country: "US",
              ...(input.city ? { city: input.city } : {}),
              ...(input.state ? { region: input.state } : {}),
              ...(input.timeZone ? { timezone: input.timeZone } : {}),
            },
          } satisfies Anthropic.WebSearchTool20260209,
        ],
        messages: [{ role: "user", content: `What does this cost: ${part}` }],
      },
      { timeout: 45_000 },
    );

    const sources = new Set<string>();
    let searched = false;

    for (const block of response.content) {
      if (block.type !== "web_search_tool_result") continue;

      /*
       * A failed search does not throw.
       *
       * It comes back as a perfectly ordinary 200 whose `content` is a single
       * error object rather than the usual array — `{ error_code:
       * "max_uses_exceeded" }` and friends. Indexing it blind reads properties
       * off an error and calls the lookup a success.
       */
      const content = (block as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;

      searched = true;
      for (const result of content) {
        const url = (result as { url?: unknown })?.url;
        if (typeof url !== "string") continue;
        try {
          sources.add(new URL(url).hostname.replace(/^www\./, ""));
        } catch {
          // A result without a parseable URL still counts as a search that
          // ran; it just cannot be credited to a domain.
        }
      }
    }

    const answer = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n")
      .trim();

    if (!answer) return null;
    return { answer, sources: [...sources].slice(0, 5), searched };
  } catch (error) {
    console.error("price lookup failed", error);
    return null;
  }
}

/* ---------------------------------------------------------------- journals */

/**
 * How long one attempt at a post may take.
 *
 * Both journal calls retry once, so the budget that matters is twice this. The
 * routes that call them allow 120 seconds, which leaves room for the database
 * reads either side. Raising this without raising those `maxDuration` values
 * puts the write back to being killed on the retry.
 */
const ATTEMPT_TIMEOUT_MS = 50_000;

/**
 * Room for the thinking as well as the post.
 *
 * On Opus 5 thinking is on by default and its tokens count against
 * `max_tokens`, so a ceiling sized for the prose alone can be spent reasoning
 * before a single `tool_use` block is emitted. The turn then ends with
 * `stop_reason: "max_tokens"`, there is no tool call to read, and the whole
 * draft is discarded — which is what 3000 was inviting.
 *
 * 16000 is the documented default for a non-streaming request. It is a ceiling
 * rather than a target: a post is about 1100 tokens and costs nothing extra for
 * the headroom above it.
 */
const JOURNAL_MAX_TOKENS = 16_000;

/**
 * Less thinking than the default, on purpose.
 *
 * Default effort is `high`, which is the right setting for a problem that has
 * to be reasoned through. This is prose against a brief, with a deterministic
 * checker behind it and a retry that names what was wrong — the quality comes
 * from the check, not from the model deliberating longer. Medium keeps the
 * latency inside the route's budget, which matters because this runs where
 * nobody is watching a spinner.
 */
const JOURNAL_EFFORT = "medium" as const;

const JOURNAL_TOOLS = [
  {
    name: "publish_post",
    description: "Write the post. Use this when there is genuinely something for a homeowner to learn here.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "The question a homeowner would type into a search box, worded as they would word it. Not a headline about the business.",
        },
        dek: { type: "string", description: "One sentence under the title. Under 160 characters." },
        body: {
          type: "string",
          description:
            "The post. Plain prose in short paragraphs separated by a blank line. **bold** and - bullets are the only formatting.",
        },
        lesson: {
          type: "string",
          description:
            "Two or three sentences a reader can take away and use, written for somebody who is not an electrician.",
        },
        diagram: {
          type: "string",
          description: "The key of one diagram from the catalogue, or an empty string for none.",
        },
        diagram_labels: {
          type: "array",
          items: { type: "string" },
          description: "One short label per slot, in the order the catalogue lists them. Four words each at most.",
        },
        diagram_caption: { type: "string", description: "One line under the diagram. Empty string for none." },
      },
      required: ["title", "dek", "body", "lesson", "diagram", "diagram_labels", "diagram_caption"],
      additionalProperties: false,
    },
  },
  {
    name: "decline",
    description:
      "Refuse to write a post. Use this when the job description is not a real electrical complaint, when there is nothing a reader could learn, or when writing anything true would mean guessing.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "One sentence, for the owner to read." },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
] as const;

export type DraftedPost = {
  title: string;
  dek: string;
  body: string;
  lesson: string;
  diagram: string;
  diagramLabels: string[];
  diagramCaption: string;
};

export type JournalDraft =
  | { ok: true; post: DraftedPost }
  | { ok: false; reason: string };

function readDraft(input: Record<string, unknown>): DraftedPost {
  const read = (key: string) => (typeof input[key] === "string" ? (input[key] as string).trim() : "");
  return {
    title: read("title"),
    dek: read("dek"),
    body: read("body"),
    lesson: read("lesson"),
    diagram: read("diagram"),
    diagramLabels: Array.isArray(input.diagram_labels) ? (input.diagram_labels as string[]) : [],
    diagramCaption: read("diagram_caption"),
  };
}

/**
 * Write up a finished job as something a stranger can learn from.
 *
 * Refusing is a first-class answer, not a failure. Production holds a job whose
 * description is an offensive one-liner and whose notes are a dictation test;
 * `readJournalSource` catches that one before it reaches here, but the model is
 * the second line and it needs a way to say no that is not an exception.
 *
 * Two attempts at most. `houseStyle` repairs the em dashes and reports what it
 * cannot repair, and the second attempt is given that list by name — a model
 * told "do not sound like an AI" produces the same draft again, and a model told
 * "you used *delve into* and *a testament to*" does not.
 *
 * Returns null on any failure, like everything else in this file. No post is
 * written, the job says so, and nobody is shown a stack trace.
 */
export async function writeJournalPost(input: {
  system: string;
  brief: string;
  kind: "story" | "lesson";
  forbidden: string[];
  /** Applied to a draft; returns the repaired text and what is still wrong. */
  check: (draft: DraftedPost) => { post: DraftedPost; problems: string };
}): Promise<JournalDraft | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const turns: Anthropic.MessageParam[] = [{ role: "user", content: input.brief }];

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await anthropic.messages.create(
        {
          model: "claude-opus-5",
          max_tokens: JOURNAL_MAX_TOKENS,
          output_config: { effort: JOURNAL_EFFORT },
          system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
          tools: JOURNAL_TOOLS as unknown as Anthropic.Tool[],
          tool_choice: { type: "any" },
          messages: turns,
        },
        // Two attempts have to fit inside the calling route's `maxDuration`
        // together, not one at a time: 90 seconds each would overrun a 120
        // second budget on the retry and be killed with nothing written.
        { timeout: ATTEMPT_TIMEOUT_MS },
      );

      if (response.stop_reason === "refusal") {
        return { ok: false, reason: "There was nothing here that could be written up." };
      }

      const call = response.content.find((block) => block.type === "tool_use");
      if (!call || call.type !== "tool_use") {
        // Almost always `max_tokens`, and invisible without this: the turn
        // succeeded, there is simply nothing in it to act on.
        console.error("journal draft returned no tool call", response.stop_reason);
        return null;
      }

      if (call.name === "decline") {
        const reason = (call.input as { reason?: unknown })?.reason;
        return {
          ok: false,
          reason: typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 300) : "Not enough to write about.",
        };
      }

      const { post, problems } = input.check(readDraft((call.input ?? {}) as Record<string, unknown>));
      if (!problems) return { ok: true, post };

      // Last attempt, and it still reads wrong. No post is better than one that
      // announces itself as machine-written on the business's own domain.
      if (attempt === 1) {
        console.error("journal draft rejected twice", problems);
        return { ok: false, reason: "The draft did not read well enough to publish." };
      }

      turns.push(
        { role: "assistant", content: response.content },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: call.id, content: "Not published. Fix these and call publish_post again:" },
            { type: "text", text: problems },
          ],
        } as Anthropic.MessageParam,
      );
    }

    return null;
  } catch (error) {
    console.error("journal draft failed", error);
    return null;
  }
}

const EDIT_TOOL = {
  name: "rewrite_post",
  description: "Return the post with the requested change made, and nothing else changed.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Unchanged unless the change asks for it." },
      dek: { type: "string" },
      body: { type: "string" },
      lesson: { type: "string" },
    },
    required: ["title", "dek", "body", "lesson"],
    additionalProperties: false,
  },
} as const;

/**
 * Change a published post, on the owner's instruction.
 *
 * The whole post goes out and the whole post comes back, rather than a splice.
 * That is the opposite of `spliceScope`, and for a reason: a contract has terms
 * a model must not be able to reach, so the edit is a substring replacement
 * that fails closed. A journal post is entirely the model's own prose with
 * nothing legally load-bearing in it, and asking for a fragment back produces
 * paragraphs that no longer join up with the ones around them.
 *
 * What keeps it honest is the caller: the returned text goes through the same
 * `houseStyle` the original was checked against, so an edit cannot reintroduce
 * an em dash, a tell, a customer's name, or an outcome claim on a lesson post.
 * The previous version is kept either way.
 */
export async function editJournalPost(input: {
  system: string;
  post: { title: string; dek: string; body: string; lesson: string };
  instruction: string;
  check: (draft: DraftedPost) => { post: DraftedPost; problems: string };
}): Promise<DraftedPost | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const instruction = input.instruction.trim().slice(0, 1000);
  if (!instruction) return null;

  const asText = [
    `TITLE: ${input.post.title}`,
    `DEK: ${input.post.dek}`,
    "",
    "BODY:",
    input.post.body,
    "",
    "LESSON:",
    input.post.lesson,
  ].join("\n");

  const turns: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        "Here is a post that is already published:",
        "",
        asText,
        "",
        `The change asked for: ${instruction}`,
        "",
        "Make that change and leave everything else alone. Return all four fields, including the ones you did not touch.",
      ].join("\n"),
    },
  ];

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await anthropic.messages.create(
        {
          model: "claude-opus-5",
          max_tokens: JOURNAL_MAX_TOKENS,
          output_config: { effort: JOURNAL_EFFORT },
          system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
          tools: [EDIT_TOOL] as unknown as Anthropic.Tool[],
          tool_choice: { type: "tool", name: EDIT_TOOL.name },
          messages: turns,
        },
        { timeout: ATTEMPT_TIMEOUT_MS },
      );

      const call = response.content.find((block) => block.type === "tool_use");
      if (!call || call.type !== "tool_use") {
        console.error("journal edit returned no tool call", response.stop_reason);
        return null;
      }

      const raw = (call.input ?? {}) as Record<string, unknown>;
      const read = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string).trim() : "");

      const { post, problems } = input.check({
        title: read("title"),
        dek: read("dek"),
        body: read("body"),
        lesson: read("lesson"),
        // An edit never changes the drawing. The owner asked about the words.
        diagram: "",
        diagramLabels: [],
        diagramCaption: "",
      });

      if (!problems) return post;
      if (attempt === 1) {
        console.error("journal edit rejected twice", problems);
        return null;
      }

      turns.push(
        { role: "assistant", content: response.content },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: call.id, content: "Not saved. Fix these and return it again:" },
            { type: "text", text: problems },
          ],
        } as Anthropic.MessageParam,
      );
    }

    return null;
  } catch (error) {
    console.error("journal edit failed", error);
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
