import type { McpTool, ToolResult } from "@/lib/mcp-protocol";
import type { IntakeAction, IntakeContext, IntakeDecision } from "@/lib/sms-intake";

/**
 * Booking as four tools a model can call, and what each outcome means.
 *
 * The same rules the SMS and `<Gather>` intakes run under, shaped for MCP so a
 * realtime voice model can hold the conversation itself while the decision
 * about what actually gets written stays here.
 *
 * That split is the whole point. A tool call is a *proposal*: it is turned into
 * an `IntakeDecision` here and handed to `decideIntakeAction`, the same gate the
 * text intake goes through. The model cannot book a window the scheduler did
 * not offer, and it cannot book over a described hazard, because the hazard
 * screen re-reads the customer's own words rather than trusting the model's
 * read of them.
 *
 * What this does not gate is what the model *says*. When a realtime model owns
 * the audio, speech is between it and the customer; these tools govern the
 * database. The escalation results below are written as words to read aloud so
 * the safe outcome is also the easy one — but a model that talks past them is
 * not something a server-side rule can stop. That is the price of the better
 * voice, and it is worth naming rather than burying.
 *
 * Import-free, like sms-intake, so the whole chain can be tested directly.
 */

const URGENCY = { type: "string", enum: ["routine", "urgent"] } as const;

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
            "The electrical problem in the customer's own words, one or two sentences. Do not sanitise it: it is re-read for safety hazards.",
        },
        address_line_1: { type: "string", description: "Street address." },
        city: { type: "string" },
        postal_code: { type: "string", description: "Five digits, or an empty string." },
        slot_start: {
          type: "string",
          description: "The exact slot_start value of an open window, copied from list_open_slots.",
        },
        urgency: { ...URGENCY, description: "urgent only if they say today, now, or no power." },
      },
      required: [
        "contact_name",
        "description",
        "address_line_1",
        "city",
        "postal_code",
        "slot_start",
        "urgency",
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
      },
      required: ["contact_name", "description", "urgency"],
      additionalProperties: false,
    },
  },
  {
    name: "flag_emergency",
    title: "Flag a safety emergency",
    description:
      "The customer describes fire, smoke, someone shocked or injured, a downed power line, or water touching electrical equipment. Nothing is booked. Read the returned words back to them and end the call.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "What the customer described, in their own words.",
        },
      },
      required: ["description"],
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

/** The customer's own words, which is what the hazard screen reads. */
export function customerWords(args: Record<string, unknown>): string {
  return text(args.description);
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
  if (name === "flag_emergency") {
    return { tool: "escalate_emergency", input: { description: text(args.description) } };
  }

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

/** Spoken, not texted: no "reply STOP", no link, no character budget. */
export function emergencyScript(context: IntakeContext): string {
  return [
    "NOT BOOKED — this is a safety emergency and it has been logged.",
    `Say this to the customer, then end the call: "That sounds like an emergency. Please hang up and call 911 now, and call your utility if a power line is down. Do not touch the electrical panel. Once you are safe, call ${context.businessPhone} back."`,
  ].join(" ");
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

  // Safety outranks the tool that was called: a "call me back" about a burning
  // smell comes back from the rules as an escalation, and is answered as one.
  if (action.kind === "escalate") return { text: emergencyScript(context) };

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
