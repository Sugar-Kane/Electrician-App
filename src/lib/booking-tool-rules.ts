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
    name: "book_visit",
    title: "Book a diagnostic visit",
    description:
      "Book a visit into one of the open windows, after the customer has described the problem, given a service address, and accepted a window you offered them. Fails if the window is not open or the address is incomplete — read the result back before telling the customer anything is booked.",
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
      },
      required: [
        "contact_name",
        "description",
        "address_line_1",
        "city",
        "postal_code",
        "slot_start",
        "urgency",
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
      return {
        text: `Booked: ${action.slot.label} at ${action.address.line1}, ${action.address.city}. Confirm the window and the address back to the customer, tell them the diagnostic visit is ${context.diagnosticFee}, and that ${context.businessName} will call if anything changes.`,
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
