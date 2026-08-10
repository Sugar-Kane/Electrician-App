import type { McpTool, ToolResult } from "@/lib/mcp-protocol";
import type { IntakeAction, IntakeContext, IntakeDecision } from "@/lib/sms-intake";

/**
 * Booking as three tools a model can call, and what each outcome means.
 *
 * The same rules the SMS and `<Gather>` intakes run under, shaped for MCP so a
 * realtime voice model can hold the conversation itself while the decision
 * about what actually gets written stays here.
 *
 * That split is the whole point. A tool call is a *proposal*: it is turned into
 * an `IntakeDecision` here and handed to `decideIntakeAction`, the same gate the
 * text intake goes through. The model cannot book a window the scheduler did
 * not offer — the schedule is checked here rather than taken on the model's
 * word for it.
 *
 * Import-free, like sms-intake, so the whole chain can be tested directly.
 */

const URGENCY = { type: "string", enum: ["routine", "urgent"] } as const;

/**
 * What an electrician asks before agreeing to come out.
 *
 * The agent was booking on two sentences — "my washer is out" and an address —
 * which is not enough for anyone to load a van. These decide what the visit
 * actually is: whether it is one circuit or the service, whether a breaker has
 * already been tried, and whether the electrician can physically get to the
 * panel when they arrive.
 *
 * Kept here rather than in the spoken prompt because a prompt lives in a web
 * form somebody typed into, and this has already silently stopped being true
 * twice. The list is short on purpose: five questions is a phone call, ten is
 * an interrogation.
 */
export const INTAKE_QUESTIONS = [
  { key: "scope", question: "Is this affecting the whole house, one room, or a single outlet or fixture?" },
  { key: "onset", question: "When did it start, and did anything change just before — a new appliance, a storm, or work done?" },
  { key: "breaker", question: "Have you looked at the breaker panel? Is anything tripped, and does it reset?" },
  { key: "property", question: "Is this a house, a condo, or a commercial space, and roughly how old is the building?" },
  { key: "access", question: "Is there anything the electrician needs to get in — a gate code, a dog, parking, or someone home?" },
] as const;

export const MINIMUM_INTAKE_ANSWERS = 3;

/**
 * The caller's number, when the connection was not opened for a known caller.
 *
 * A console-configured MCP URL is the same for every call, so the server cannot
 * know who is on the line unless it is told. Asking for a callback number is
 * something a receptionist does anyway, and getting it wrong misdirects a
 * callback rather than crossing a tenant boundary — the organization is still
 * pinned in the URL. Ignored when the URL was minted for a specific caller.
 */
const CALLER_PHONE = {
  type: "string",
  description:
    "The caller's phone number, as they said it. Ask for it if you do not have it, and read it back before using it.",
} as const;

export const BOOKING_TOOLS: McpTool[] = [
  {
    name: "list_open_slots",
    title: "List open arrival windows",
    description:
      "The arrival windows this business actually has open, with the exact slot_start value each one must be booked with. Call this before offering the customer any time. Never invent or adjust a window.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "get_intake_questions",
    title: "The questions to ask before booking",
    description:
      "The questions this business wants asked before a visit is booked. Call this after the customer describes the problem, ask them conversationally — not as a list read aloud — and pass what you learn to book_visit.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "book_visit",
    title: "Book a diagnostic visit",
    description:
      "Book a visit. Only call this after all of: the customer described the problem, you asked the get_intake_questions questions, you took a service address, you offered a window and they accepted it, you asked \"Would you like me to go ahead and book that?\" and they said yes, you took a callback number, and you asked how they want their booking link. This refuses unless the intake answers and the caller's yes are both present. Read the result back before telling the customer anything is booked.",
    inputSchema: {
      type: "object",
      properties: {
        contact_name: { type: "string", description: "The customer's name." },
        description: {
          type: "string",
          description:
            "The electrical problem in the customer's own words, one or two sentences.",
        },
        address_line_1: { type: "string", description: "Street address." },
        city: { type: "string" },
        postal_code: { type: "string", description: "Five digits, or an empty string." },
        slot_start: {
          type: "string",
          description: "The exact slot_start value of an open window, copied from list_open_slots.",
        },
        urgency: { ...URGENCY, description: "urgent only if they say today, now, or no power." },
        caller_phone: CALLER_PHONE,
        caller_email: {
          type: "string",
          description:
            "The caller's email for a written confirmation. Ask every caller: \"What is the best email for your confirmation?\" Read it back before using it. Send an empty string only if they decline — an empty value never blocks the booking.",
        },
        answer_scope: {
          type: "string",
          description: "Their answer to: Is this affecting the whole house, one room, or a single outlet or fixture?  Empty string if you could not get one.",
        },
        answer_onset: {
          type: "string",
          description: "Their answer to: When did it start, and did anything change just before?  Empty string if you could not get one.",
        },
        answer_breaker: {
          type: "string",
          description: "Their answer to: Have you looked at the breaker panel? Is anything tripped, and does it reset?  Empty string if you could not get one.",
        },
        answer_property: {
          type: "string",
          description: "Their answer to: Is this a house, a condo, or a commercial space, and roughly how old is the building?  Empty string if you could not get one.",
        },
        answer_access: {
          type: "string",
          description: "Their answer to: Is there anything the electrician needs to get in — gate code, dog, parking, someone home?  Empty string if you could not get one.",
        },
        caller_confirmed: {
          type: "string",
          description:
            'Send "yes" only if you asked whether to go ahead and book and the customer said yes out loud. Send "no" otherwise. Never "yes" because they seemed willing.',
        },
        delivery_preference: {
          type: "string",
          enum: ["text", "email", "both"],
          description:
            "How they asked to receive the booking and payment link. Ask them: text, email, or both?",
        },
      },
      // Deliberately short. Everything the intake gate checks is optional here
      // and enforced in intakeShortfall instead: a refusal that says what is
      // missing teaches the model more than a schema rejection does, and a
      // smaller schema is a smaller thing for a tool API to choke on. The whole
      // connector went quiet once this list grew to ten entries.
      required: [
        "contact_name",
        "description",
        "address_line_1",
        "city",
        "slot_start",
        "caller_phone",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "request_callback",
    title: "Ask the electrician to call back",
    description:
      "Log that the customer wants a call back. Use whenever a visit cannot be booked from this call — no address, outside the service area, a quote for a large job, or they simply asked to speak to someone.",
    inputSchema: {
      type: "object",
      properties: {
        contact_name: { type: "string" },
        description: { type: "string", description: "What the customer needs, in their own words." },
        urgency: URGENCY,
        caller_phone: CALLER_PHONE,
      },
      required: ["contact_name", "description", "urgency", "caller_phone"],
      additionalProperties: false,
    },
  },
];

export const BOOKING_TOOL_NAMES = BOOKING_TOOLS.map((tool) => tool.name);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function urgency(value: unknown): "routine" | "urgent" {
  return value === "urgent" ? "urgent" : "routine";
}

/** The customer's own words, kept as the record of what they asked for. */
export function customerWords(args: Record<string, unknown>): string {
  return text(args.description);
}

/** The number the model says the caller gave, if it was asked to pass one. */
export function callerPhone(args: Record<string, unknown>): string {
  return text(args.caller_phone);
}

/** An email address the caller offered. Optional everywhere it appears. */
export function callerEmail(args: Record<string, unknown>): string {
  return text(args.caller_email);
}

export type IntakeAnswer = { question: string; answer: string };

/**
 * The answers the model says it collected, with the empty ones dropped.
 *
 * A question with no answer is not evidence of an interview — it is the shape
 * of one. Only pairs where the customer actually said something count toward
 * the minimum below.
 */
export function intakeAnswers(args: Record<string, unknown>): IntakeAnswer[] {
  return INTAKE_QUESTIONS.map(({ key, question }) => ({
    question,
    answer: text(args[`answer_${key}`]),
  })).filter((entry) => entry.answer.length > 0);
}

export function deliveryPreference(args: Record<string, unknown>): "text" | "email" | "both" | "" {
  const value = text(args.delivery_preference);
  return value === "text" || value === "email" || value === "both" ? value : "";
}

/**
 * Why this booking is not allowed to proceed yet, if it is not.
 *
 * Everything here is something the customer is owed before a job appears in
 * their name: being asked what is actually wrong, and being asked whether they
 * want it booked at all. The model has been told to do both in three separate
 * places and skipped them anyway, so it is enforced rather than requested.
 */
export function intakeShortfall(args: Record<string, unknown>): string {
  const confirmed = args.caller_confirmed;
  if (confirmed !== true && text(confirmed).toLowerCase() !== "yes") {
    return 'NOT BOOKED. You have not confirmed with the customer. Ask "Would you like me to go ahead and book that?" and call this again once they say yes.';
  }

  const answers = intakeAnswers(args);
  if (answers.length < MINIMUM_INTAKE_ANSWERS) {
    return `NOT BOOKED. Only ${answers.length} of the intake questions were answered and ${MINIMUM_INTAKE_ANSWERS} are needed. Call get_intake_questions, ask the ones you have not asked, and try again.`;
  }

  if (!deliveryPreference(args)) {
    return 'NOT BOOKED. Ask "Would you like the booking and payment link by text, email, or both?" and call this again with their answer.';
  }

  return "";
}

/**
 * A tool call, restated as the proposal the intake rules already understand.
 *
 * Returns null for tools that propose nothing — `list_open_slots` only reads.
 */
export function buildDecision(
  name: string,
  args: Record<string, unknown>,
): IntakeDecision | null {
  if (name === "request_callback") {
    return {
      tool: "request_callback",
      input: {
        contact_name: text(args.contact_name),
        description: text(args.description),
        urgency: urgency(args.urgency),
      },
    };
  }

  if (name === "book_visit") {
    return {
      // confirm_visit, not propose_visit: over the phone the customer has
      // already said yes out loud before the model reaches for this.
      tool: "confirm_visit",
      input: {
        contact_name: text(args.contact_name),
        description: text(args.description),
        address_line_1: text(args.address_line_1),
        city: text(args.city),
        postal_code: text(args.postal_code),
        slot_start: text(args.slot_start),
        urgency: urgency(args.urgency),
      },
    };
  }

  return null;
}

/** The questions, as the model should receive them. */
export function intakeQuestionList(): string {
  return [
    "Ask these before booking, conversationally — one at a time, not read as a list:",
    ...INTAKE_QUESTIONS.map((entry, index) => `${index + 1}. ${entry.question}`),
    "",
    `Pass each answer to book_visit as answer_scope, answer_onset, answer_breaker, answer_property, and answer_access. At least ${MINIMUM_INTAKE_ANSWERS} must be answered or the booking will be refused. If a customer will not answer one, move on — do not invent an answer.`,
  ].join("\n");
}

export function slotList(context: IntakeContext): string {
  if (context.offeredSlots.length === 0) {
    return "No arrival windows are open. Use request_callback — do not offer the customer a time.";
  }
  return [
    "Open arrival windows:",
    ...context.offeredSlots.map((slot) => `- ${slot.label} (slot_start: ${slot.start})`),
    `The diagnostic visit costs ${context.diagnosticFee}. Book with the exact slot_start value above.`,
  ].join("\n");
}

/**
 * What the model should be told, given what the rules allowed.
 *
 * Every path that did not write a booking says so in its first three words, so
 * a model skimming the result cannot mistake a refusal for a confirmation.
 */
export function describeOutcome(input: {
  name: string;
  action: IntakeAction;
  context: IntakeContext;
  phone: string;
  deliveryPreference?: "text" | "email" | "both" | "";
}): ToolResult {
  const { action, context } = input;

  if (input.name === "request_callback") {
    const urgent = action.kind === "callback" && action.urgency === "urgent";
    return {
      text: `Callback logged for ${input.phone}. Tell the customer ${context.businessName} will call them back${urgent ? " as soon as possible" : " to get them scheduled"}. Do not promise a specific time.`,
    };
  }

  if (input.name === "book_visit") {
    if (action.kind === "book") {
      // The words after a booking are the ones the customer will hold the
      // business to, so they are written here rather than left to the model:
      // what was booked, what it costs, and what happens next.
      const where = `${action.address.line1}, ${action.address.city}`;
      const delivery =
        input.deliveryPreference === "both"
          ? "by text and email"
          : input.deliveryPreference === "email"
            ? "by email"
            : "by text";

      return {
        text: [
          `Booked: ${action.slot.label} at ${where}.`,
          "Say this back to the customer, in your own voice, all of it:",
          `1. The window and the address, so they can correct you.`,
          `2. "There is a ${context.diagnosticFee} deposit to hold the appointment."`,
          `3. "An electrician will call you later today to go over a few more details."`,
          `4. "I am sending your booking and payment link ${delivery} now."`,
          "Do not promise a repair price, and do not take card details on this call.",
        ].join(" "),
      };
    }

    if (action.kind === "ask" && action.missing.includes("address")) {
      return {
        isError: true,
        text: "NOT BOOKED. Ask the customer for the street address and the city, then call book_visit again.",
      };
    }

    if (action.kind === "ask") {
      return {
        isError: true,
        text: `NOT BOOKED. That slot_start is not one of the open windows. ${slotList(context)}`,
      };
    }

    return {
      isError: true,
      text: "NOT BOOKED. Use request_callback and tell the customer someone will call them back.",
    };
  }

  return { isError: true, text: `NOT BOOKED. Unknown tool: ${input.name}` };
}
