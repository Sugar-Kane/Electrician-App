/**
 * Reading a customer's text well enough to schedule from it.
 *
 * The model decides *what the customer is asking for*. It never decides whether
 * that is safe, whether the slot is real, or what goes back over SMS — those
 * are settled here, deterministically, and the caller writes to the database
 * only through the paths this module approves.
 *
 * Import-free so the safety rules can be tested directly, like messaging-rules.
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
 * Hazards that stop a booking outright.
 *
 * These mirror the safety screen the web booking form enforces
 * (`create_public_booking_intake` refuses the same four), because a customer
 * describing a fire should get 911 whether they typed it into a form or texted
 * it at 11pm.
 */
export const HAZARDS = [
  "active_fire_or_smoke",
  "shock_injury",
  "downed_power_line",
  "water_touching_electrical",
] as const;

export type Hazard = (typeof HAZARDS)[number];

const HAZARD_PATTERNS: [Hazard, RegExp][] = [
  ["active_fire_or_smoke", /\b(fire|flames?|burning|smoke|smoking|smells? like burning|scorch)/i],
  ["shock_injury", /\b(shocked?|shocking|electrocut\w*|got zapped|burned my)/i],
  ["downed_power_line", /\b(down(ed)? (power )?line|wire (is )?down|line (is )?down|pole fell)/i],
  ["water_touching_electrical", /\b(flood\w*|submerged|standing water)/i],
  // Water only matters here when it is near something electrical, in either
  // order — "water in the breaker box" and "the panel has water in it". A water
  // heater on its own is a normal service call, not an emergency.
  [
    "water_touching_electrical",
    /\bwater\b[^.!?]{0,40}\b(panel|breaker|outlet|receptacle|wir\w*|electric\w*|meter|fuse|junction box)\b/i,
  ],
  [
    "water_touching_electrical",
    /\b(panel|breaker|outlet|receptacle|wir\w*|electric\w*|meter|fuse box|junction box)\b[^.!?]{0,40}\bwater\b/i,
  ],
];

/**
 * Hazards named in the customer's own words.
 *
 * Deliberately independent of the model: a regex cannot be talked out of
 * spotting "sparks and smoke", and this runs whether or not the model agrees.
 */
export function detectHazards(text: string): Hazard[] {
  const found = new Set<Hazard>();
  for (const [hazard, pattern] of HAZARD_PATTERNS) {
    if (pattern.test(text)) found.add(hazard);
  }
  return [...found];
}

export type OfferedSlot = { start: string; end: string; label: string };

export type IntakeContext = {
  businessName: string;
  businessPhone: string;
  /** Windows the business actually has open, straight from the scheduler. */
  offeredSlots: OfferedSlot[];
  diagnosticFee: string;
  serviceArea: string;
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
      "The customer has accepted a window that was already offered to them in this conversation. Use only after they agree — never on their first message.",
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
      },
      required: ["contact_name", "description", "address_line_1", "city", "postal_code", "slot_start", "urgency"],
      additionalProperties: false,
    },
  },
  {
    name: "escalate_emergency",
    description:
      "The customer describes fire, smoke, someone shocked or injured, a downed power line, or water touching electrical equipment. Nothing is booked; they are told to call emergency services.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        hazard: { type: "string", enum: [...HAZARDS] },
        description: { type: "string" },
      },
      required: ["hazard", "description"],
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
 * checked against the hazards and the real schedule.
 */
export type IntakeAction =
  | { kind: "escalate"; hazards: Hazard[]; reply: string }
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
    };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstAndLast(name: string): { first: string; last: string } {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
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
 * Turn the model's suggestion into something safe to execute.
 *
 * Every branch that would write to the database is gated on evidence the
 * caller supplied: hazards found in the customer's own text, and the exact
 * list of windows the scheduler says are open.
 */
export function decideIntakeAction(input: {
  decision: IntakeDecision | null;
  customerText: string;
  context: IntakeContext;
}): IntakeAction {
  const { context } = input;
  const hazards = detectHazards(input.customerText);
  const claimedHazard = text(input.decision?.input?.hazard);

  // Safety outranks everything, including the model's own read. If either the
  // text or the model names a hazard, nothing gets booked.
  if (hazards.length > 0 || input.decision?.tool === "escalate_emergency") {
    const named = hazards.length > 0 ? hazards : ([claimedHazard] as Hazard[]);
    return {
      kind: "escalate",
      hazards: named.filter((hazard): hazard is Hazard => HAZARDS.includes(hazard as Hazard)),
      reply: composeReply(
        `${context.businessName}: that sounds like an emergency. Please call 911 now, and your utility if a line is down. Do not touch the panel. Call ${context.businessPhone} once you are safe.`,
        context,
      ),
    };
  }

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

    return {
      kind: "book",
      slot,
      contactName,
      description,
      address,
      urgency,
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
    "Rules:",
    "- Call exactly one tool. Never answer in plain text.",
    "- Only ever use a slot_start copied exactly from the list above. Never invent or adjust a time.",
    "- Do not call confirm_visit on a customer's first message. Propose a window first and wait for them to accept.",
    "- Anything involving fire, smoke, a shock, a downed line, or water on electrical equipment is escalate_emergency, whatever else they ask for.",
    "- No address, or an address outside the service area, means request_callback rather than a visit.",
    "- Never quote a price other than the diagnostic fee above, and never promise a repair cost.",
    "- Never include a link, and never ask for card details.",
  ].join("\n");
}
