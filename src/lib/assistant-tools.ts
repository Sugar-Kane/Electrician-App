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
  | "search_stock"
  | "adjust_stock"
  | "add_stock_item"
  | "look_up_price"
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
  | "draft_contract"
  | "edit_contract_scope"
  | "edit_invoice_lines";

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
    name: "search_stock",
    description:
      "List everything in stock matching a search, with how many are on hand and where they are. Use this rather than check_stock when the electrician is asking what they have, not whether they have one specific thing.",
    confirm: false,
    outbound: false,
    input_schema: {
      type: "object",
      properties: {
        query: str(
          "Part of a name, a part number or a location. Pass an empty string to list everything.",
        ),
      },
      // Every property required, like every other tool here: strict tool use
      // wants it, and an argument the model may or may not send is an argument
      // whose absence has to be guessed at.
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "adjust_stock",
    description:
      "Change how many of a part are on hand, saying why. Use it when stock arrives, is damaged, comes back, or is recounted. Never for a part used on a job — adding the part to the job takes it off the shelf on its own.",
    confirm: true,
    outbound: false,
    input_schema: {
      type: "object",
      properties: {
        part: str("The part, as the electrician would say it."),
        quantity: {
          type: "number",
          description: "How many. Always positive; the reason decides the direction.",
        },
        reason: {
          type: "string",
          enum: ["received", "returned", "wastage", "stock_take"],
          description:
            "received: arrived from a supplier. returned: came back unused. wastage: damaged or lost. stock_take: this is the counted total, not a change.",
        },
        note: str("Where they went, who took them, what happened. Empty if not said."),
      },
      required: ["part", "quantity", "reason", "note"],
      additionalProperties: false,
    },
  },
  {
    name: "add_stock_item",
    description:
      "Add a part to the stock list that is not there yet, with what is on hand now. Check with search_stock first — a second row for a part already listed splits its count in half.",
    confirm: true,
    outbound: false,
    input_schema: {
      type: "object",
      properties: {
        name: str("What the part is called, as it would be said on the van."),
        quantity: { type: "number", description: "How many are on hand now. 0 is fine." },
        unit: str("each, ft, box. 'each' if not said."),
        part_number: str("Manufacturer or supplier number. Empty if not said."),
        unit_cost: str("What one costs, like 38 or 38.50. Empty if not said."),
        location: str("Van shelf 2, shop bin C. Empty if not said."),
      },
      required: ["name", "quantity", "unit", "part_number", "unit_cost", "location"],
      additionalProperties: false,
    },
  },
  {
    name: "look_up_price",
    description:
      "Look up what a part currently sells for, by searching the public web. Use it when somebody asks what something costs and it is not already in their stock list — check_stock and search_stock answer what they paid, this answers what the next one costs. The figure is a public list price with no trade discount in it, and must be described that way.",
    confirm: false,
    outbound: false,
    input_schema: {
      type: "object",
      properties: {
        // Only the part, deliberately. The query is assembled on the server
        // from this one field, so what leaves the building is the name of a
        // thing rather than whatever text happened to be in the conversation.
        part: str("The part alone, as it would appear in a supplier's catalogue."),
      },
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

  /*
   * Changing a document the app produced.
   *
   * Both rewrite a record and let the PDF be rebuilt from it, which is the only
   * sense in which a generated document is editable — the file is a picture of
   * the record, not a thing to be typed into.
   *
   * The contract tool can reach the scope of work and nothing else, and that is
   * a property of its shape rather than of its description: there is no
   * argument here that could name the payment terms or the warranty.
   */
  {
    name: "edit_contract_scope",
    description:
      "Rewrite the scope of work on a job's contract — what the job covers, what is and is not included. Only the scope: the payment terms, warranty and conditions cannot be changed this way. Proposes only, and the change is shown before and after.",
    confirm: true,
    outbound: false,
    input_schema: {
      type: "object",
      properties: {
        job_number: str("The job whose contract this is."),
        scope: str(
          "The replacement scope of work, complete and in full. It replaces the existing passage rather than being added to it.",
        ),
      },
      required: ["job_number", "scope"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_invoice_lines",
    description:
      "Replace the lines on a draft invoice — descriptions, quantities, units and prices. The totals are worked out from the lines, never set directly. Only works while the invoice is still a draft nobody has been sent.",
    confirm: true,
    outbound: false,
    input_schema: {
      type: "object",
      properties: {
        invoice_number: str("The invoice, e.g. INV-10024."),
        lines: {
          type: "array",
          maxItems: 40,
          description:
            "Every line the invoice should have afterwards, not just the changed ones. The list replaces what is there.",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["labor", "material"] },
              description: str("What the line says on the invoice."),
              quantity: { type: "number", description: "Hours for labour, count for materials." },
              unit: str("hour, each, ft, box."),
              unit_price_cents: {
                type: "integer",
                description: "Price for one unit, in cents.",
              },
            },
            required: ["kind", "description", "quantity", "unit", "unit_price_cents"],
            additionalProperties: false,
          },
        },
      },
      required: ["invoice_number", "lines"],
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

/** Cents as money, for a figure somebody checks before tapping. */
function dollars(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (Number.isFinite(cents) ? cents : 0) / 100,
  );
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
    case "adjust_stock": {
      const part = text(input.part) || "(unspecified)";
      const many = text(input.quantity) || "(no number)";
      const why = text(input.reason);
      if (why === "stock_take") return `Set the count of ${part} to ${many}.`;
      if (why === "received") return `Add ${many} ${part} — arrived from a supplier.`;
      if (why === "returned") return `Put ${many} ${part} back — came back unused.`;
      return `Take ${many} ${part} out — damaged or lost.`;
    }
    case "add_stock_item": {
      const name = text(input.name) || "(unnamed)";
      const many = text(input.quantity) || "0";
      return `Add ${name} to the stock list with ${many} on hand.`;
    }

    /*
     * These two quote the change itself rather than describing it.
     *
     * "Rewrite the scope of work" is not something anybody can approve — the
     * whole question is what it will say afterwards. The confirmation card is
     * the last point at which a person can see that, so it is where the words
     * go.
     */
    case "edit_contract_scope": {
      const job = text(input.job_number) || "(unspecified)";
      const scope = text(input.scope);
      return `Rewrite the scope of work on job #${job}'s contract to:\n\n“${scope}”\n\nThe payment terms, warranty and conditions are not touched.`;
    }

    case "edit_invoice_lines": {
      const number = text(input.invoice_number) || "(unspecified)";
      const lines = Array.isArray(input.lines) ? input.lines : [];

      const rows = lines
        .map((entry) => {
          const row = (entry ?? {}) as Record<string, unknown>;
          const quantity = Number(row.quantity);
          const price = Number(row.unit_price_cents);
          const amount =
            Number.isFinite(quantity) && Number.isFinite(price)
              ? ` — ${dollars(Math.round(quantity * price))}`
              : "";
          return `• ${text(row.description) || "(no description)"} ×${
            Number.isFinite(quantity) ? quantity : "?"
          } ${text(row.unit)}${amount}`;
        })
        .join("\n");

      const total = lines.reduce((sum, entry) => {
        const row = (entry ?? {}) as Record<string, unknown>;
        const quantity = Number(row.quantity);
        const price = Number(row.unit_price_cents);
        return Number.isFinite(quantity) && Number.isFinite(price)
          ? sum + Math.round(quantity * price)
          : sum;
      }, 0);

      return `Replace the lines on ${number} with:\n\n${rows}\n\nThat is ${dollars(total)} before any credit and tax, which are recalculated from it.`;
    }
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
    "Sending an invoice or a text, scheduling, invoicing, changing stock and drafting a contract are proposals: they are shown to the person and do not happen until they tap to confirm.",
    "",
    "Rules:",
    "- You can change stock. adjust_stock records parts arriving, coming back, being damaged, or being recounted; add_stock_item puts a new part on the list. Both are proposals. Never tell somebody to go and do it by hand.",
    "- Never adjust stock for a part used on a job. Adding the part to the job takes it off the shelf on its own.",
    "- A photographed receipt belongs in Stock → Scan a receipt, which reads every line at once and puts them on the shelf together. Say so rather than adding the lines one at a time.",
    "- look_up_price returns a public list price. Say that it is one. It has no trade discount in it, it is not what this business pays, and it must never be repeated to a customer as their price or written into stock without them tapping to confirm.",
    "- Never put a customer's name, address or phone number into a price lookup. It searches the public web.",
    "- You can change a document the app made, by changing what it is a picture of. edit_contract_scope rewrites what a job's contract says the work covers; edit_invoice_lines replaces the lines on a draft invoice and the totals follow from them. Both are proposals, and the PDF is rebuilt afterwards with the old version kept.",
    "- You cannot change a contract's payment terms, warranty or conditions, and you cannot change an invoice that has been sent or paid. If asked, say so and suggest the real remedy: a replacement contract, or a corrected invoice.",
    "- Never say you have sent, booked, invoiced or drafted something you have only proposed. Say you have prepared it and it is waiting for them.",
    "- Never invent a job number, invoice number, customer, amount or date. Look it up.",
    "- For anything about code, licensing, permits or inspections, call lookup_code. Never answer those from memory.",
    "- Only remember something when asked to.",
    /*
     * The electrician's own language, not the customer's.
     *
     * This is the in-app assistant, so whoever is typing is the person to
     * answer — a bilingual electrician asking "¿cuántos breakers de 20A me
     * quedan?" should not be answered in English because the business's
     * settings are. Nothing is stored: the question in front of it is the whole
     * of the evidence, and there is no record to get wrong.
     */
    "- Answer in whatever language the person just wrote to you in. Do not switch languages mid-answer.",
    "- Be brief. The person asking is usually holding a phone in a van.",
  ].join("\n");
}
