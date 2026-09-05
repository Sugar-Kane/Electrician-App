import type { McpTool, ToolResult } from "@/lib/mcp-protocol";
import { toE164 } from "./phone-format.ts";
import {
  INTAKE_QUESTIONS,
  MINIMUM_INTAKE_ANSWERS,
  type IntakeAction,
  type IntakeContext,
  type IntakeDecision,
} from "./sms-intake.ts";

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
// The questions themselves live with the text intake, which is the layer both
// paths share. Two copies would drift, and a phone booking and a text booking
// asking different things is exactly the state this replaced.
export { INTAKE_QUESTIONS, MINIMUM_INTAKE_ANSWERS };

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
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_intake_questions",
    title: "The questions to ask before booking",
    description:
      "The questions this business wants asked before a visit is booked. Call this after the customer describes the problem, ask them conversationally — not as a list read aloud — and pass what you learn to book_visit.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "book_visit",
    title: "Book a diagnostic visit",
    description:
      'Book a visit. Only call this after all of: the customer described the problem, you asked the get_intake_questions questions, you took a service address, you offered a window and they accepted it, you asked "Would you like me to go ahead and book that?" and they said yes, you took a callback number, and you asked how they want their booking link. This refuses unless the intake answers and the caller\'s yes are both present. Read the result back before telling the customer anything is booked.',
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
        postal_code: {
          type: "string",
          description: "Five digits, or an empty string.",
        },
        slot_start: {
          type: "string",
          description:
            "The exact slot_start value of an open window, copied from list_open_slots.",
        },
        urgency: {
          ...URGENCY,
          description: "urgent only if they say today, now, or no power.",
        },
        caller_phone: CALLER_PHONE,
        caller_email: {
          type: "string",
          description:
            'The caller\'s email for a written confirmation. Ask every caller: "What is the best email for your confirmation?" Read it back before using it. Send an empty string only if they decline — an empty value never blocks the booking.',
        },
        answer_scope: {
          type: "string",
          description:
            "Their answer to: Is this affecting the whole house, one room, or a single outlet or fixture?  Empty string if you could not get one.",
        },
        answer_onset: {
          type: "string",
          description:
            "Their answer to: When did it start, and did anything change just before?  Empty string if you could not get one.",
        },
        answer_breaker: {
          type: "string",
          description:
            "Their answer to: Have you looked at the breaker panel? Is anything tripped, and does it reset?  Empty string if you could not get one.",
        },
        answer_property: {
          type: "string",
          description:
            "Their answer to: Is this a house, a condo, or a commercial space, and roughly how old is the building?  Empty string if you could not get one.",
        },
        answer_access: {
          type: "string",
          description:
            "Their answer to: Is there anything the electrician needs to get in — gate code, dog, parking, someone home?  Empty string if you could not get one.",
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
    title: "Transfer to a person or request a callback",
    description:
      "Hand the conversation to a person. Infer the customer's intent from what they already said: use transfer when they ask to speak, talk, connect, or be put through to a live person; use callback when they ask for someone to call, ring, or get back to them. Do not present a canned timing choice. Ask one natural clarifying question only when their words do not distinguish a live transfer from a returned call.",
    inputSchema: {
      type: "object",
      properties: {
        contact_name: { type: "string" },
        description: {
          type: "string",
          description: "What the customer needs, in their own words.",
        },
        urgency: URGENCY,
        caller_phone: CALLER_PHONE,
        handoff: {
          type: "string",
          enum: ["transfer", "callback"],
          description:
            'The intent expressed in the conversation. "transfer" means connect this live call to a person. "callback" means end this call and have a person return their call. Infer this from their words; only clarify if ambiguous.',
        },
      },
      required: [
        "contact_name",
        "description",
        "urgency",
        "caller_phone",
        "handoff",
      ],
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
/**
 * The number to reach the caller on, in the form a carrier accepts.
 *
 * Empty when what the model heard is not a number anybody could be reached on.
 * This returned the raw string once, and a call where speech-to-text rendered a
 * mobile as `613432210` — nine digits — booked a visit for somebody who then
 * received nothing at all. Twilio refused every send with `21211`, and the
 * customer's only record of the appointment was the memory of the phone call.
 *
 * `toE164` is the same function the settings form uses, so a number saved by
 * the owner and a number heard by the receptionist are held to one standard.
 */
export function callerPhone(args: Record<string, unknown>): string {
  return toE164(text(args.caller_phone));
}

/**
 * Why this caller cannot be booked yet, when the number is the problem.
 *
 * Written for the model to act on rather than for a person to read: it is still
 * on the phone with them, and asking again is free. Empty when there is nothing
 * wrong.
 */
export function unreachableCaller(
  name: string,
  args: Record<string, unknown>,
): string {
  const heard = text(args.caller_phone).trim();

  if (!heard) {
    return `NOT BOOKED. Ask the caller for the best phone number to reach them on, read it back to them to check, then call ${name} again with caller_phone set.`;
  }

  if (!toE164(heard)) {
    return `NOT BOOKED. "${heard}" is not a phone number anybody can be reached on, so nothing would ever reach this caller. Ask them to say their number again one digit at a time, read it back to them, then call ${name} again.`;
  }

  return "";
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

/**
 * Whether the caller wants somebody now, or a call back later.
 *
 * Empty when the model has not asked. That is a refusal below rather than a
 * default, because the two are a real choice a person makes and the wrong guess
 * is either a homeowner sitting in the dark waiting for a call that was filed
 * as routine, or the owner's phone ringing at ten at night for a dripping fan.
 */
export function callbackHandoff(
  args: Record<string, unknown>,
): "transfer" | "callback" | "" {
  const value = text(args.handoff).toLowerCase();
  return value === "transfer" || value === "callback" ? value : "";
}

/**
 * Why a callback cannot be logged yet.
 *
 * The same shape as `intakeShortfall`: a refusal the model can act on while it
 * is still talking to the customer. Empty when there is nothing missing.
 */
export function callbackShortfall(args: Record<string, unknown>): string {
  if (!callbackHandoff(args)) {
    return 'NOT BOOKED. Determine whether the customer asked to speak to a live person on this call or asked for someone to return their call. Use handoff "transfer" for a live connection and "callback" for a returned call. Do not present a canned timing choice; clarify naturally only if their words are ambiguous.';
  }

  return "";
}

export function deliveryPreference(
  args: Record<string, unknown>,
): "text" | "email" | "both" | "" {
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
        // Deliberately alongside `urgency` rather than folded into it. Urgency
        // describes the fault; this describes what the customer asked for. A
        // dripping extractor fan can still be somebody who wants a person now,
        // and no power at midnight can still be somebody happy to wait.
        // The shared stored decision predates live transfers. Keep its internal
        // values stable while the voice-facing contract uses human words.
        when: callbackHandoff(args) === "transfer" ? "now" : "later",
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
        // The interview goes with the proposal. These used to be dropped here,
        // so answers the caller had already given out loud never reached the
        // gate that decides whether enough was asked — the voice path checked
        // separately and the text path did not check at all. Now both go
        // through the same one.
        ...Object.fromEntries(
          INTAKE_QUESTIONS.map(({ key }) => [
            `answer_${key}`,
            text(args[`answer_${key}`]),
          ]),
        ),
        delivery_preference: text(args.delivery_preference),
      },
    };
  }

  return null;
}

/** The questions, as the model should receive them. */
export function intakeQuestionList(): string {
  return [
    "Ask these before booking, conversationally — one at a time, not read as a list:",
    ...INTAKE_QUESTIONS.map(
      (entry, index) => `${index + 1}. ${entry.question}`,
    ),
    "",
    `Pass each answer to book_visit as answer_scope, answer_onset, answer_breaker, answer_property, and answer_access. At least ${MINIMUM_INTAKE_ANSWERS} must be answered or the booking will be refused. If a customer will not answer one, move on — do not invent an answer.`,
  ].join("\n");
}

export function slotList(context: IntakeContext): string {
  // The clock comes first. Without it the model cannot tell a caller whether a
  // window is tonight or next week, and it will guess.
  const clock = `Right now it is ${context.nowLabel} where the business is.`;

  if (context.offeredSlots.length === 0) {
    return [
      clock,
      "No arrival windows are open, so a visit cannot be booked on this call.",
      "Continue naturally from what the customer already asked for. If they asked to speak to a live person, call request_callback with handoff set to transfer. If they asked for someone to call them, use callback. Do not present a canned timing choice. Clarify only if their intent is ambiguous.",
    ].join(" ");
  }
  return [
    clock,
    "Open arrival windows, soonest first:",
    ...context.offeredSlots.map(
      (slot) => `- ${slot.label} (slot_start: ${slot.start})`,
    ),
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
  /** The slot is reserved and the fee is not paid yet. */
  held?: boolean;
  /** Whether they asked for a live connection or a returned call. */
  handoff?: "transfer" | "callback" | "";
  /** Whether Twilio has taken control of the live call for a human transfer. */
  transfer?: "started" | "unavailable";
}): ToolResult {
  const { action, context } = input;

  if (input.name === "request_callback") {
    /*
     * Two different promises, because the customer was asked which they wanted
     * and the words back to them have to match the answer. "Straight back" is
     * a commitment the owner's phone is about to make good on; "to get you
     * scheduled" is not, and saying the wrong one is how a person ends up
     * waiting by a phone all evening.
     */
    if (input.handoff === "transfer") {
      if (input.transfer === "started") {
        return {
          text: "Live transfer started. Twilio is now connecting the caller to the electrician. Stop speaking immediately; do not say goodbye or promise a callback.",
        };
      }
      return {
        text: `The live transfer was unavailable. A callback is logged for ${input.phone}. Tell the customer: "I'm sending your callback request to an electrician right away. Our response time is usually within 24 hours." Make clear that 24 hours is the usual response time, not a guarantee. Then close with a proper goodbye.`,
      };
    }

    const urgent = action.kind === "callback" && action.urgency === "urgent";
    return {
      text: `Callback logged for ${input.phone}. Tell the customer: "I'm sending your callback request to an electrician right away. Our response time is usually within 24 hours."${urgent ? " Add that the request was marked urgent." : ""} Make clear that 24 hours is the usual response time, not a guarantee. Then close with a proper goodbye.`,
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
          // "Booked" was already a stretch — the script promised a payment link
          // that nothing sent. Now the link is real, and so is the difference
          // between a time held and a time confirmed.
          input.held
            ? `Held, not yet confirmed: ${action.slot.label} at ${where}.`
            : `Booked: ${action.slot.label} at ${where}.`,
          "Say this back to the customer, in your own voice, all of it:",
          `1. The window and the address, so they can correct you.`,
          input.held
            ? `2. "I am holding that time. It is confirmed once the ${context.diagnosticFee} diagnostic fee is paid."`
            : `2. "There is a ${context.diagnosticFee} deposit to hold the appointment."`,
          `3. "An electrician will call you later today to go over a few more details."`,
          `4. "I am sending your booking and payment link ${delivery} now."`,
          "Then ask if there is anything else, and close with a proper goodbye before ending the call.",
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
      text: "NOT BOOKED. Use what the customer already said to determine whether they want a live transfer or a returned call, then use request_callback with handoff set to transfer or callback. Clarify naturally only if their intent is ambiguous.",
    };
  }

  return { isError: true, text: `NOT BOOKED. Unknown tool: ${input.name}` };
}
