/**
 * Reading a customer's text well enough to schedule from it.
 *
 * The model decides *what the customer is asking for*. It never decides whether
 * the slot is real or what goes back over SMS — those are settled here,
 * deterministically, and the caller writes to the database only through the
 * paths this module approves.
 *
 * Import-free apart from the language rules, so the rest can be tested
 * directly, like messaging-rules.
 */

import {
  readLanguage,
  resolveLanguage,
  type LanguageCode,
  type LanguageSource,
} from "./customer-language.ts";
import { phrasesFor } from "./intake-phrases.ts";

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

export type OfferedSlot = {
  start: string;
  end: string;
  /** English, and the version the model is shown in its prompt. */
  label: string;
  /**
   * The same window worded in each language the app speaks, keyed by code.
   *
   * Built where the timezone lives rather than here, and optional so every
   * existing construction still compiles. Falls back to `label`, which is a
   * readable date in any language even when it is the wrong one.
   */
  labels?: Record<string, string>;
};

/** The window as this customer should read it. */
function slotLabelIn(slot: OfferedSlot, language: LanguageCode): string {
  return slot.labels?.[language] ?? slot.label;
}

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
  /** What this customer's record currently says they read. */
  language: LanguageCode;
  /**
   * Who decided that, which is what makes the owner's choice stick.
   *
   * With `owner` here, a Spanish message from a customer the owner pinned to
   * English is answered in English. That is the point of the setting: an owner
   * who corrects a bad guess and watches the next text undo it stops trusting
   * the control entirely.
   */
  languageSource: LanguageSource;
};

/**
 * The language the customer is writing in, on every tool.
 *
 * An argument rather than something inferred from the reply text afterwards.
 * Reading the language back out of what the model wrote would only ever work
 * for `ask_for` — the other three replies are composed here, in whichever
 * language this says, so there would be nothing to read.
 *
 * `und` is a real answer and the reason this is not a two-value enum. "ok",
 * "yes", "👍" and an address are not evidence of anything, and a model forced to
 * choose between "en" and "es" for them will pick one, which is how a Spanish
 * customer gets flipped back to English by the word "ok". `und` changes
 * nothing — `resolveLanguage` refuses anything it does not recognise.
 */
const LANGUAGE_ARGUMENT = {
  type: "string",
  enum: ["en", "es", "und"],
  description:
    "The language the customer's most recent message is written in. Use 'und' when the message is too short or too neutral to tell — a name, an address, 'ok', a single emoji. Never guess from an earlier message.",
} as const;

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
        language: LANGUAGE_ARGUMENT,
      },
      required: ["contact_name", "description", "urgency", "language"],
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
        language: LANGUAGE_ARGUMENT,
      },
      required: ["contact_name", "description", "address_line_1", "city", "postal_code", "slot_start", "urgency", "language"],
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
        language: LANGUAGE_ARGUMENT,
      },
      required: [
        "contact_name", "description", "address_line_1", "city", "postal_code", "slot_start", "urgency",
        "answer_scope", "answer_onset", "answer_breaker", "answer_property", "answer_access",
        "delivery_preference", "language",
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
        language: LANGUAGE_ARGUMENT,
      },
      required: ["missing", "question", "language"],
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
 * Carried on every outcome, and the only place the language is settled.
 *
 * The reply below is already written in this language, and the caller stores it
 * on the customer. Both from one decision rather than two: a runner that
 * re-derived the language would be a second copy of the owner-override rule,
 * and the two would disagree the first time either changed.
 */
type SpokenIn = { language: LanguageCode; languageChanged: boolean };

/**
 * What the caller is cleared to do, after the model's suggestion has been
 * checked against the real schedule.
 */
export type IntakeAction = SpokenIn &
  (
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
      }
  );

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
 *
 * Asked in the customer's language, because this is one of the few questions
 * the model does not write — it comes from the fixed list, and a Spanish
 * conversation that suddenly asks about the breaker panel in English reads as
 * two different people answering the phone.
 */
export function nextIntakeQuestion(
  args: Record<string, unknown>,
  language: LanguageCode = "en",
): string | null {
  const phrases = phrasesFor(language);
  const answered = new Set(
    INTAKE_QUESTIONS.filter(({ key }) => text(args[`answer_${key}`]).length > 0).map(
      ({ key }) => key as string,
    ),
  );

  if (answered.size < MINIMUM_INTAKE_ANSWERS) {
    const unanswered = INTAKE_QUESTIONS.find(({ key }) => !answered.has(key));
    // The English wording is the fallback rather than a missing question: a
    // translation nobody added is a worse question, not no question at all.
    if (unanswered) return phrases.questions[unanswered.key] ?? unanswered.question;
  }

  if (!readDeliveryPreference(args)) return phrases.deliveryQuestion;

  return null;
}

export function splitName(name: string) {
  return firstAndLast(name);
}

/** Two SMS segments. Past this a reply arrives split and looks broken. */
const REPLY_LIMIT = 300;

export function composeReply(
  body: string,
  context: IntakeContext,
  language: LanguageCode = "en",
): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  // Every message this system sends carries the opt-out, but repeating it on
  // every turn of a live conversation reads as spam — the first reply is where
  // it belongs, and it is what the campaign was registered with. The word STOP
  // itself is never translated; see `intake-phrases`.
  const suffix = context.isFirstReply ? phrasesFor(language).optOut : "";
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

  /*
   * Which language this reply is written in, decided once.
   *
   * The stored language is what we knew before this message arrived, so on the
   * very first Spanish text it still says English — answering in it would greet
   * a Spanish speaker in English and only switch on their second message. So
   * the detection is applied here, through the same `resolveLanguage` that
   * guards the database, which means the owner's pin is honoured in the reply
   * and in the row by one rule rather than two.
   *
   * `languageChanged` is what the caller writes. False for the overwhelming
   * majority of messages, which is the point: a write per inbound text is a
   * write per inbound text.
   */
  const stored = { language: context.language, source: context.languageSource };
  const detected = decision ? text(decision.input.language) : "";
  const resolved = resolveLanguage(stored, detected);
  const language = resolved?.language ?? readLanguage(context.language);
  const spokenIn: SpokenIn = { language, languageChanged: resolved !== null };
  const phrases = phrasesFor(language);

  if (!decision) {
    return {
      ...spokenIn,
      kind: "ask",
      missing: ["description"],
      reply: composeReply(phrases.opening(context.businessName), context, language),
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
    // The model's own words, which it was told to write in the customer's
    // language. This is the one reply it composes; every other one below is
    // written here.
    const question = text(decision.input.question);
    return {
      ...spokenIn,
      kind: "ask",
      missing,
      reply: composeReply(
        question || phrases.askProblemAndAddress(context.businessName),
        context,
        language,
      ),
    };
  }

  if (decision.tool === "request_callback") {
    return {
      ...spokenIn,
      kind: "callback",
      contactName,
      description,
      urgency,
      reply: composeReply(
        phrases.callback(
          context.businessName,
          contactName ? firstAndLast(contactName).first : "",
          urgency === "urgent",
        ),
        context,
        language,
      ),
    };
  }

  if (decision.tool === "propose_visit" || decision.tool === "confirm_visit") {
    // The model may only pick from windows the scheduler handed it. A time it
    // invented would be a promise the business cannot keep.
    const slot = context.offeredSlots.find((option) => option.start === text(decision.input.slot_start));
    if (!slot) {
      const first = context.offeredSlots[0];
      return {
        ...spokenIn,
        kind: "ask",
        missing: ["preferred_time"],
        reply: composeReply(
          first
            ? phrases.haveWindow(context.businessName, slotLabelIn(first, language))
            : phrases.noOpening(context.businessName),
          context,
          language,
        ),
      };
    }

    if (decision.tool === "propose_visit") {
      return {
        ...spokenIn,
        kind: "propose",
        slot,
        contactName,
        description,
        reply: composeReply(
          phrases.offer(context.businessName, slotLabelIn(slot, language), context.diagnosticFee),
          context,
          language,
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
        ...spokenIn,
        kind: "ask",
        missing: ["address"],
        reply: composeReply(phrases.askAddress(context.businessName), context, language),
      };
    }

    // Booked over the phone, a customer is asked what is actually wrong and how
    // they want their confirmation. Booked by text they were not, and the job
    // arrived with an address and a sentence. The model has been told to ask;
    // this is where it is required to have done so, because a booking is the
    // point after which nobody asks anything.
    const outstanding = nextIntakeQuestion(decision.input, language);
    if (outstanding) {
      return {
        ...spokenIn,
        kind: "ask",
        missing: ["description"],
        reply: composeReply(
          phrases.fromBusiness(context.businessName, outstanding),
          context,
          language,
        ),
      };
    }

    const preference = readDeliveryPreference(decision.input);

    return {
      ...spokenIn,
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
        phrases.booked(
          context.businessName,
          slotLabelIn(slot, language),
          context.businessPhone,
        ),
        context,
        language,
      ),
    };
  }

  // An unknown tool name means the model and this code disagree about what
  // exists. Falling through to a human is the only honest outcome.
  return {
    ...spokenIn,
    kind: "callback",
    contactName,
    description: description || input.customerText.slice(0, 400),
    urgency: "routine",
    reply: composeReply(phrases.messageTaken(context.businessName), context, language),
  };
}

/** How a language is named to the model, which does not read ISO codes well. */
function languageName(language: LanguageCode): string {
  return language === "es" ? "Spanish" : "English";
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
    /*
     * Two separate jobs, and they are told apart on purpose.
     *
     * Reporting the language is an observation about the message in front of
     * it. Writing the question is an instruction about output. A single rule
     * covering both invites the model to reconcile them — to report English
     * because it is about to be told this customer reads English — and the
     * report is the thing the database is going to believe.
     */
    "Language:",
    "- Report the language of the customer's most recent message in the tool's `language` argument: 'en', 'es', or 'und' when it is too short or too neutral to tell. Report what is in front of you, not what an earlier message was in. Report it even when you are not writing in it.",
    /*
     * The owner's pin binds the model too.
     *
     * `ask_for` is the one reply the model writes; every other one is composed
     * from `phrasesFor(language)`, which honours the pin. Left to follow the
     * customer, the model would answer a pinned customer's Spanish text in
     * Spanish and the next composed reply would arrive in English — the same
     * conversation switching languages between messages, which reads worse than
     * either language would on its own.
     */
    context.languageSource === "owner"
      ? `- Write your question in ${languageName(context.language)}. The business has set this customer's language, so use it even when they write in the other one.`
      : `- Write your question in the language the customer's latest message is in. When you cannot tell, use ${languageName(context.language)}.`,
    "- Never mix the two in one message.",
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
