/**
 * Reading a customer's text well enough to schedule from it.
 *
 * The model decides *what the customer is asking for*. It never decides whether
 * the slot is real or what goes back over SMS — those are settled here,
 * deterministically, and the caller writes to the database only through the
 * paths this module approves.
 *
 * Import-free so the rules can be tested directly, like messaging-rules.
 */

/** Field names the model may say it still needs. */
export const INTAKE_FIELDS = [
  "contact_name",
  "description",
  "address",
  "preferred_time",
] as const;

export type IntakeField = (typeof INTAKE_FIELDS)[number];

/**
 * What the customer is asked before anybody drives out.
 *
 * These lived only in the MCP tools, which is the voice path — so a booking
 * taken over the phone arrived with the scope, the breaker state and the access
 * notes, and the identical booking taken by text arrived with none of them. The
 * electrician could not tell which kind of booking he was looking at, only that
 * some of them were thin.
 *
 * Defined here, at the layer both paths already share, so there is one list
 * rather than two that drift.
 */
export const INTAKE_QUESTIONS = [
  { key: "scope", question: "Is this affecting the whole house, one room, or a single outlet or fixture?" },
  { key: "onset", question: "When did it start, and did anything change just before — a new appliance, a storm, or work done?" },
  { key: "breaker", question: "Have you looked at the breaker panel? Is anything tripped, and does it reset?" },
  { key: "property", question: "Is this a house, a condo, or a commercial space, and roughly how old is the building?" },
  { key: "access", question: "Is there anything the electrician needs to get in — a gate code, a dog, parking, or someone home?" },
] as const;

export const MINIMUM_INTAKE_ANSWERS = 3;

export type IntakeAnswer = { question: string; answer: string };

export type DeliveryPreference = "text" | "email" | "both";

export type OfferedSlot = { start: string; end: string; label: string };

export type IntakeContext = {
  businessName: string;
  businessPhone: string;
  /** Windows the business actually has open, straight from the scheduler. */
  offeredSlots: OfferedSlot[];
  diagnosticFee: string;
  /** The same fee in cents, for anything that has to charge it. */
  diagnosticFeeCents: number;
  serviceArea: string;
  /** The business's own clock, so nobody has to guess what "today" means. */
  nowLabel: string;
  /** Appended to the first reply in a thread only. */
  isFirstReply: boolean;
};

/**
 * What the model is allowed to ask for.
 *
 * One tool per outcome, so the classification and the extraction come out of
 * the same call: which tool it picks *is* the decision. `strict: true` means a
 * malformed argument set is rejected by the API rather than by us at 2am.
 */
export const INTAKE_TOOLS = [
  {
    name: "request_callback",
    description:
      "The customer wants the electrician to call them back, or they need work that cannot be booked from a text (no address given, outside the service area, a quote for a large job, or they simply asked for a call). Use this whenever a visit cannot be scheduled but the customer wants to be contacted.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        contact_name: { type: "string", description: "The customer's name, or an empty string if they have not said it." },
        description: { type: "string", description: "What the customer needs, in their own words, one or two sentences." },
        urgency: { type: "string", enum: ["routine", "urgent"], description: "urgent only if they say today, now, or no power." },
      },
      required: ["contact_name", "description", "urgency"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_visit",
    description:
      "The customer has described the problem and given an address, and one of the offered arrival windows suits the request. This only offers the window to the customer — it does not book anything. Use confirm_visit once they accept.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        contact_name: { type: "string" },
        description: { type: "string", description: "The electrical problem, one or two sentences." },
        address_line_1: { type: "string" },
        city: { type: "string" },
        postal_code: { type: "string", description: "Five digits, or an empty string if not given." },
        slot_start: { type: "string", description: "The exact slot_start value of one of the offered windows. Never invent a time." },
        urgency: { type: "string", enum: ["routine", "urgent"] },
      },
      required: ["contact_name", "description", "address_line_1", "city", "postal_code", "slot_start", "urgency"],
      additionalProperties: false,
    },
  },
  {
    name: "confirm_visit",
    description:
      "The customer has accepted a window that was already offered to them in this conversation. Use only after they agree — never on their first message. Include whatever intake questions they have answered so far and how they want their confirmation sent.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        contact_name: { type: "string" },
        description: { type: "string" },
        address_line_1: { type: "string" },
        city: { type: "string" },
        postal_code: { type: "string" },
        slot_start: { type: "string", description: "The exact slot_start of the window they accepted." },
        urgency: { type: "string", enum: ["routine", "urgent"] },
        answer_scope: { type: "string", description: "What the customer said about how much of the property is affected. Empty string if not asked yet." },
        answer_onset: { type: "string", description: "What the customer said about when it started. Empty string if not asked yet." },
        answer_breaker: { type: "string", description: "What the customer said about the breaker panel. Empty string if not asked yet." },
        answer_property: { type: "string", description: "What the customer said about the kind and age of building. Empty string if not asked yet." },
        answer_access: { type: "string", description: "What the customer said about gate codes, dogs, parking, or being home. Empty string if not asked yet." },
        delivery_preference: {
          type: "string",
          enum: ["text", "email", "both", ""],
          description: "How the customer asked for their confirmation. Empty string if they have not been asked.",
        },
      },
      required: [
        "contact_name", "description", "address_line_1", "city", "postal_code", "slot_start", "urgency",
        "answer_scope", "answer_onset", "answer_breaker", "answer_property", "answer_access",
        "delivery_preference",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "ask_for",
    description:
      "Something needed to go further is missing. Ask for it in one short question. Ask for at most two things at a time.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        missing: {
          type: "array",
          items: { type: "string", enum: [...INTAKE_FIELDS] },
          description: "What is still needed.",
        },
        question: { type: "string", description: "One question, under 200 characters, no links." },
      },
      required: ["missing", "question"],
      additionalProperties: false,
    },
  },
] as const;

export type IntakeToolName = (typeof INTAKE_TOOLS)[number]["name"];

export type IntakeDecision = {
  tool: string;
  input: Record<string, unknown>;
};

/**
 * What the caller is cleared to do, after the model's suggestion has been
 * checked against the real schedule.
 */
export type IntakeAction =
  | { kind: "ask"; missing: IntakeField[]; reply: string }
  | { kind: "callback"; contactName: string; description: string; urgency: "routine" | "urgent"; reply: string }
  | { kind: "propose"; slot: OfferedSlot; contactName: string; description: string; reply: string }
  | {
      kind: "book";
      slot: OfferedSlot;
      contactName: string;
      description: string;
      address: { line1: string; city: string; postalCode: string };
      urgency: "routine" | "urgent";
      reply: string;
      /** What the customer was asked in the thread, and what they said. */
      intakeAnswers: IntakeAnswer[];
      deliveryPreference: DeliveryPreference;
    };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstAndLast(name: string): { first: string; last: string } {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

/**
 * The intake answers a tool call actually carries, empty ones dropped.
 *
 * A question with no answer is not evidence of an interview — it is the shape
 * of one, and only pairs where the customer said something count.
 */
export function collectIntakeAnswers(args: Record<string, unknown>): IntakeAnswer[] {
  return INTAKE_QUESTIONS.map(({ key, question }) => ({
    question,
    answer: text(args[`answer_${key}`]),
  })).filter((entry) => entry.answer.length > 0);
}

export function readDeliveryPreference(args: Record<string, unknown>): DeliveryPreference | "" {
  const value = text(args.delivery_preference);
  return value === "text" || value === "email" || value === "both" ? value : "";
}

/**
 * The next thing the customer still has to be asked before this is booked.
 *
 * Returns the question itself rather than a complaint, because over SMS the
 * remedy and the message to send are the same string. One question at a time:
 * a text that asks three things gets one answer, and it is rarely obvious which
 * one it was for.
 *
 * Null means there is nothing outstanding and the booking may proceed.
 */
export function nextIntakeQuestion(args: Record<string, unknown>): string | null {
  const answered = new Set(
    INTAKE_QUESTIONS.filter(({ key }) => text(args[`answer_${key}`]).length > 0).map(
      ({ key }) => key as string,
    ),
  );

  if (answered.size < MINIMUM_INTAKE_ANSWERS) {
    const unanswered = INTAKE_QUESTIONS.find(({ key }) => !answered.has(key));
    if (unanswered) return unanswered.question;
  }

  if (!readDeliveryPreference(args)) {
    return "Would you like your confirmation by text, email, or both?";
  }

  return null;
}

export function splitName(name: string) {
  return firstAndLast(name);
}

/** Two SMS segments. Past this a reply arrives split and looks broken. */
const REPLY_LIMIT = 300;

export function composeReply(body: string, context: IntakeContext): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  // Every message this system sends carries the opt-out, but repeating it on
  // every turn of a live conversation reads as spam — the first reply is where
  // it belongs, and it is what the campaign was registered with.
  const suffix = context.isFirstReply ? " Reply STOP to opt out." : "";
  const room = REPLY_LIMIT - suffix.length;
  return `${trimmed.length > room ? `${trimmed.slice(0, room - 1).trimEnd()}…` : trimmed}${suffix}`;
}

/**
 * Turn the model's suggestion into something the caller may execute.
 *
 * The model decides what the customer is asking for; this decides whether that
 * is something the business can actually do. The remaining gate is the
 * schedule: a booking is only ever approved for a window the scheduler itself
 * offered, so the model cannot promise a time nobody has.
 */
export function decideIntakeAction(input: {
  decision: IntakeDecision | null;
  customerText: string;
  context: IntakeContext;
}): IntakeAction {
  const { context } = input;
  const decision = input.decision;
  if (!decision) {
    return {
      kind: "ask",
      missing: ["description"],
      reply: composeReply(
        `${context.businessName}: thanks for reaching out. What is the electrical problem, and what is the service address?`,
        context,
      ),
    };
  }

  const contactName = text(decision.input.contact_name);
  const description = text(decision.input.description);
  const urgency = decision.input.urgency === "urgent" ? "urgent" : "routine";

  if (decision.tool === "ask_for") {
    const missing = Array.isArray(decision.input.missing)
      ? decision.input.missing.filter((field): field is IntakeField =>
          INTAKE_FIELDS.includes(field as IntakeField),
        )
      : [];
    const question = text(decision.input.question);
    return {
      kind: "ask",
      missing,
      reply: composeReply(
        question || `${context.businessName}: what is the electrical problem, and what is the service address?`,
        context,
      ),
    };
  }

  if (decision.tool === "request_callback") {
    return {
      kind: "callback",
      contactName,
      description,
      urgency,
      reply: composeReply(
        `${context.businessName}: got it${contactName ? `, ${firstAndLast(contactName).first}` : ""}. We have your number and will call you back${urgency === "urgent" ? " as soon as we can" : " to get you scheduled"}.`,
        context,
      ),
    };
  }

  if (decision.tool === "propose_visit" || decision.tool === "confirm_visit") {
    // The model may only pick from windows the scheduler handed it. A time it
    // invented would be a promise the business cannot keep.
    const slot = context.offeredSlots.find((option) => option.start === text(decision.input.slot_start));
    if (!slot) {
      return {
        kind: "ask",
        missing: ["preferred_time"],
        reply: composeReply(
          context.offeredSlots.length > 0
            ? `${context.businessName}: we have ${context.offeredSlots[0]!.label}. Does that work?`
            : `${context.businessName}: we do not have an opening to offer yet. We will call you back to schedule.`,
          context,
        ),
      };
    }

    if (decision.tool === "propose_visit") {
      return {
        kind: "propose",
        slot,
        contactName,
        description,
        reply: composeReply(
          `${context.businessName}: we can come ${slot.label}. The diagnostic visit is ${context.diagnosticFee}. Reply YES to book it.`,
          context,
        ),
      };
    }

    const address = {
      line1: text(decision.input.address_line_1),
      city: text(decision.input.city),
      postalCode: text(decision.input.postal_code),
    };
    if (!address.line1 || !address.city) {
      return {
        kind: "ask",
        missing: ["address"],
        reply: composeReply(
          `${context.businessName}: what is the service address, including the city?`,
          context,
        ),
      };
    }

    // Booked over the phone, a customer is asked what is actually wrong and how
    // they want their confirmation. Booked by text they were not, and the job
    // arrived with an address and a sentence. The model has been told to ask;
    // this is where it is required to have done so, because a booking is the
    // point after which nobody asks anything.
    const outstanding = nextIntakeQuestion(decision.input);
    if (outstanding) {
      return {
        kind: "ask",
        missing: ["description"],
        reply: composeReply(`${context.businessName}: ${outstanding}`, context),
      };
    }

    const preference = readDeliveryPreference(decision.input);

    return {
      kind: "book",
      slot,
      contactName,
      description,
      address,
      urgency,
      intakeAnswers: collectIntakeAnswers(decision.input),
      // nextIntakeQuestion has already refused to get here without one.
      deliveryPreference: preference || "text",
      reply: composeReply(
        `${context.businessName}: booked for ${slot.label}. We will text when the technician is on the way. Questions? ${context.businessPhone}`,
        context,
      ),
    };
  }

  // An unknown tool name means the model and this code disagree about what
  // exists. Falling through to a human is the only honest outcome.
  return {
    kind: "callback",
    contactName,
    description: description || input.customerText.slice(0, 400),
    urgency: "routine",
    reply: composeReply(
      `${context.businessName}: thanks — we have your message and will call you back.`,
      context,
    ),
  };
}

/** The instructions the model runs under. Built per conversation. */
export function buildIntakeSystemPrompt(context: IntakeContext): string {
  const slots = context.offeredSlots.length
    ? context.offeredSlots.map((slot) => `- ${slot.label} (slot_start: ${slot.start})`).join("\n")
    : "- none available";

  return [
    `You are handling text messages for ${context.businessName}, an electrical contractor serving ${context.serviceArea}.`,
    `A customer has texted the business number. Your job is to work out what they need and call exactly one tool.`,
    "",
    "Open arrival windows:",
    slots,
    "",
    `The diagnostic visit costs ${context.diagnosticFee}.`,
    "",
    "Before a visit is booked, ask these — one per message, and carry the answers",
    `into confirm_visit as answer_<key>. At least ${MINIMUM_INTAKE_ANSWERS} must be answered:`,
    ...INTAKE_QUESTIONS.map(({ key, question }) => `- ${key}: ${question}`),
    "",
    "Also ask how they want their confirmation — text, email, or both — and pass it as delivery_preference.",
    "",
    "Rules:",
    "- Call exactly one tool. Never answer in plain text.",
    "- Only ever use a slot_start copied exactly from the list above. Never invent or adjust a time.",
    "- Do not call confirm_visit on a customer's first message. Propose a window first and wait for them to accept.",
    "- Ask one question per message. A text that asks three things gets one answer.",
    "- No address, or an address outside the service area, means request_callback rather than a visit.",
    "- Never quote a price other than the diagnostic fee above, and never promise a repair cost.",
    "- Never include a link, and never ask for card details.",
  ].join("\n");
}
