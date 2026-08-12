/**
 * What the chat is allowed to do, and which of it needs a human tap first.
 *
 * The dividing line is not "dangerous" versus "safe". It is whether an action
 * is visible to somebody outside the business or changes a record. Reading is
 * free — a search that returns the wrong customer costs a second look. Sending
 * is not: a misheard instruction becomes a real bill in a real customer's inbox,
 * and there is no undo for that.
 *
 * So every tool declares `confirm`. Tools that confirm never execute from the
 * model's word alone; they produce a proposal describing exactly what would
 * happen, and the person reads it and taps. That is one extra tap and it is the
 * difference between a mistake caught and a mistake the customer catches.
 *
 * Import-free, so the boundary can be tested without a model.
 */

export type ToolName =
  | "search_jobs"
  | "search_customers"
  | "check_stock"
  | "list_invoices"
  | "list_technicians"
  | "lookup_code"
  | "remember"
  | "forget"
  | "send_invoice"
  | "send_text"
  | "schedule_job"
  | "assign_technician"
  | "set_invoice_amount"
  | "draft_contract";

export type ToolSpec = {
  name: ToolName;
  description: string;
  /** True when a person must approve before anything happens. */
  confirm: boolean;
  /** Whether this reaches somebody outside the business. */
  outbound: boolean;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
};

const str = (description: string) => ({ type: "string", description });

export const ASSISTANT_TOOLS: ToolSpec[] = [
  {
    name: "search_jobs",
    description:
      "Find jobs by customer name, city, status, or date. Use for any question about what is booked, who is scheduled, or what happened on a job.",
    confirm: false,
    outbound: false,
    input_schema: {
      type: "object",
      properties: { query: str("What to look for. Empty string returns recent jobs.") },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "search_customers",
    description: "Find a customer by name, phone number, email or address.",
    confirm: false,
    outbound: false,
    input_schema: {
      type: "object",
      properties: { query: str("Name, number, email or street.") },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "check_stock",
    description: "Check whether a part is in the business's inventory, and how many.",
    confirm: false,
    outbound: false,
    input_schema: {
      type: "object",
      properties: { part: str("The part, as the electrician would say it.") },
      required: ["part"],
      additionalProperties: false,
    },
  },
  {
    name: "list_invoices",
    description: "List invoices, optionally filtered to paid, unpaid or overdue.",
    confirm: false,
    outbound: false,
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["all", "paid", "unpaid", "overdue"],
          description: "Which invoices.",
        },
      },
      required: ["status"],
      additionalProperties: false,
    },
  },
  {
    name: "list_technicians",
    description:
      "List the technicians on this business's crew, with who is active. Use before assigning somebody, so the name is one that exists.",
    confirm: false,
    outbound: false,
    input_schema: {
      type: "object",
      properties: { query: str("Optional name to narrow to. Empty string lists everybody.") },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "lookup_code",
    description:
      "Look up California or federal electrical code, licensing, permit, inspection or safety requirements in the reference index. Always use this rather than answering from memory — a wrong code citation gets a permit pulled against it.",
    confirm: false,
    outbound: false,
    input_schema: {
      type: "object",
      properties: { question: str("The requirement being asked about.") },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    name: "remember",
    description:
      "Store a fact about how this business works, so it is available in later conversations. Only when the person asks you to remember something.",
    confirm: false,
    outbound: false,
    input_schema: {
      type: "object",
      properties: { fact: str("One sentence, in the business's own terms.") },
      required: ["fact"],
      additionalProperties: false,
    },
  },
  {
    name: "forget",
    description: "Remove a stored fact by its id.",
    confirm: false,
    outbound: false,
    input_schema: {
      type: "object",
      properties: { id: str("The memory id.") },
      required: ["id"],
      additionalProperties: false,
    },
  },

  // ---- Everything below reaches a customer or changes a record ---------------
  {
    name: "send_invoice",
    description:
      "Send an existing invoice to its customer by text, email or both. Proposes only — the person confirms before anything is sent.",
    confirm: true,
    outbound: true,
    input_schema: {
      type: "object",
      properties: {
        invoice_number: str("The invoice, e.g. INV-10024."),
        channel: {
          type: "string",
          enum: ["sms", "email", "both"],
          description: "How to send it.",
        },
      },
      required: ["invoice_number", "channel"],
      additionalProperties: false,
    },
  },
  {
    name: "send_text",
    description:
      "Send a text message to a customer. Proposes only — the person reads the exact message and confirms.",
    confirm: true,
    outbound: true,
    input_schema: {
      type: "object",
      properties: {
        customer: str("Who to text, by name or number."),
        message: str("The message, under 300 characters, no links."),
      },
      required: ["customer", "message"],
      additionalProperties: false,
    },
  },
  {
    name: "schedule_job",
    description: "Move or set a job's arrival window. Proposes only.",
    confirm: true,
    outbound: false,
    input_schema: {
      type: "object",
      properties: {
        job_number: str("The job number."),
        start_local: str("Wall-clock start in the business's timezone, YYYY-MM-DDTHH:MM."),
        duration_hours: str("How long, in hours. Empty for the default two."),
      },
      required: ["job_number", "start_local", "duration_hours"],
      additionalProperties: false,
    },
  },
  {
    name: "assign_technician",
    description:
      "Put a technician on a job, or take them off it. Proposes only — the person confirms before the schedule changes.",
    confirm: true,
    outbound: false,
    input_schema: {
      type: "object",
      properties: {
        job_number: str("The job number."),
        technician: str("The technician's name as the crew list shows it. Empty string unassigns."),
      },
      required: ["job_number", "technician"],
      additionalProperties: false,
    },
  },
  {
    name: "set_invoice_amount",
    description:
      "Raise an invoice against a job for an amount. Proposes only — the figure is read back before anything is created.",
    confirm: true,
    outbound: false,
    input_schema: {
      type: "object",
      properties: {
        job_number: str("The job number."),
        amount: str("The amount, e.g. 1280 or 1280.50."),
      },
      required: ["job_number", "amount"],
      additionalProperties: false,
    },
  },
  {
    name: "draft_contract",
    description: "Generate a draft contract for a job from the business's template. Proposes only.",
    confirm: true,
    outbound: false,
    input_schema: {
      type: "object",
      properties: { job_number: str("The job number.") },
      required: ["job_number"],
      additionalProperties: false,
    },
  },
];

const BY_NAME = new Map<string, ToolSpec>(ASSISTANT_TOOLS.map((tool) => [tool.name, tool]));

export function findTool(name: string): ToolSpec | undefined {
  return BY_NAME.get(name);
}

/**
 * Whether a tool call may run without asking.
 *
 * An unknown tool name is treated as needing confirmation. The model and this
 * list disagreeing is exactly the moment not to act on the model's word.
 */
export function requiresConfirmation(name: string): boolean {
  const tool = findTool(name);
  return tool ? tool.confirm : true;
}

export type Proposal = {
  tool: ToolName;
  input: Record<string, unknown>;
  /** What will happen, in words the person can check before tapping. */
  summary: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A proposed action, described so it can be checked rather than trusted.
 *
 * The summary names the recipient and quotes the payload, because "send the
 * invoice" is not something anybody can meaningfully approve — "text INV-10024
 * for $1,280.00 to Dana Harper" is.
 */
export function describeProposal(
  name: string,
  input: Record<string, unknown>,
): string {
  switch (name) {
    case "send_invoice": {
      const channel = text(input.channel);
      const how = channel === "both" ? "text and email" : channel === "sms" ? "text" : "email";
      return `Send invoice ${text(input.invoice_number) || "(unspecified)"} to the customer by ${how}.`;
    }
    case "send_text": {
      const message = text(input.message);
      return `Text ${text(input.customer) || "(unspecified)"}: “${message}”`;
    }
    case "schedule_job": {
      const hours = text(input.duration_hours) || "2";
      return `Move job #${text(input.job_number) || "(unspecified)"} to ${text(input.start_local) || "(no time)"} for ${hours} hours.`;
    }
    case "set_invoice_amount":
      return `Raise a draft invoice on job #${text(input.job_number) || "(unspecified)"} for ${text(input.amount) || "(no amount)"}.`;
    case "assign_technician": {
      const who = text(input.technician);
      const job = text(input.job_number) || "(unspecified)";
      return who
        ? `Put ${who} on job #${job}.`
        : `Take the assigned technician off job #${job}.`;
    }
    case "draft_contract":
      return `Draft a contract for job #${text(input.job_number) || "(unspecified)"} from your template.`;
    default:
      return `Run ${name}.`;
  }
}

/**
 * The instructions the chat runs under.
 *
 * The rule that matters most is the last one: it must not claim to have done
 * something it has only proposed. A model that says "sent" when a confirmation
 * is still sitting unread is worse than one that cannot send at all, because
 * nobody goes back to check.
 */
export function assistantToolPrompt(businessName: string): string {
  return [
    `You are the assistant inside Volteira, used by ${businessName}, an electrical contracting business.`,
    "",
    "Use tools rather than guessing. Searches, stock checks and code lookups run immediately.",
    "",
    "Sending an invoice or a text, scheduling, invoicing and drafting a contract are proposals: they are shown to the person and do not happen until they tap to confirm.",
    "",
    "Rules:",
    "- Never say you have sent, booked, invoiced or drafted something you have only proposed. Say you have prepared it and it is waiting for them.",
    "- Never invent a job number, invoice number, customer, amount or date. Look it up.",
    "- For anything about code, licensing, permits or inspections, call lookup_code. Never answer those from memory.",
    "- Only remember something when asked to.",
    "- Be brief. The person asking is usually holding a phone in a van.",
  ].join("\n");
}
