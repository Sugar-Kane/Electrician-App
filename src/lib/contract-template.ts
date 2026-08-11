/**
 * Filling the business's own contract from a job.
 *
 * An electrician already has a contract. It is a Word document, and the job
 * details are typed into it by hand every time, which is where the wrong
 * address and last month's price come from. The document stays theirs; only the
 * typing moves here.
 *
 * The substitution is deterministic and the model never touches it. Names,
 * addresses, dates and money come from the job's own rows — a language model is
 * good at prose and has no business deciding what somebody is being charged. It
 * gets one job, the scope paragraph, and even that is offered for review before
 * anything is sent.
 *
 * Import-free, so the filling can be tested without a database.
 */

export type ContractFacts = {
  business_name: string;
  business_phone: string;
  customer_name: string;
  service_address: string;
  job_number: string;
  job_date: string;
  work_type: string;
  /** Formatted, e.g. "$1,280.00". Empty when the job has no price yet. */
  total: string;
  deposit: string;
  /** Drafted from the customer's description. Empty when nothing was written. */
  scope: string;
  today: string;
};

export const CONTRACT_PLACEHOLDERS: { key: keyof ContractFacts; describes: string }[] = [
  { key: "business_name", describes: "Your business name" },
  { key: "business_phone", describes: "Your phone number" },
  { key: "customer_name", describes: "The customer's name" },
  { key: "service_address", describes: "Where the work happens" },
  { key: "job_number", describes: "The job number in this app" },
  { key: "job_date", describes: "The scheduled date" },
  { key: "work_type", describes: "The kind of work" },
  { key: "total", describes: "The agreed price" },
  { key: "deposit", describes: "The deposit or diagnostic fee" },
  { key: "scope", describes: "A paragraph describing the work" },
  { key: "today", describes: "Today's date" },
];

const PLACEHOLDER_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Every placeholder a template asks for, in the order it first asks. */
export function placeholdersUsed(template: string): string[] {
  const found: string[] = [];
  for (const match of (template ?? "").matchAll(PLACEHOLDER_PATTERN)) {
    const key = match[1]!;
    if (!found.includes(key)) found.push(key);
  }
  return found;
}

/** Placeholders in a template that this app has no value for. */
export function unknownPlaceholders(template: string): string[] {
  const known = new Set<string>(CONTRACT_PLACEHOLDERS.map((entry) => entry.key));
  return placeholdersUsed(template).filter((key) => !known.has(key));
}

export type FilledContract = {
  body: string;
  /**
   * Placeholders the template asked for that the job could not answer.
   *
   * Reported rather than silently blanked. A contract with a missing price is a
   * document somebody has to look at, and leaving an empty space where the
   * figure goes is how an unpriced contract gets emailed to a customer.
   */
  unfilled: string[];
};

/**
 * The template, with the job's details in it.
 *
 * Unknown placeholders are left exactly as written. A template containing
 * `{{permit_number}}` is a business asking for something this app does not
 * track, and quietly deleting it would hide that — the placeholder staying
 * visible in the draft is the point.
 */
export function fillTemplate(template: string, facts: Partial<ContractFacts>): FilledContract {
  const unfilled: string[] = [];
  const known = new Set<string>(CONTRACT_PLACEHOLDERS.map((entry) => entry.key));

  const body = (template ?? "").replace(PLACEHOLDER_PATTERN, (whole, rawKey: string) => {
    const key = rawKey as keyof ContractFacts;

    if (!known.has(key)) {
      if (!unfilled.includes(rawKey)) unfilled.push(rawKey);
      return whole;
    }

    const value = facts[key];
    if (typeof value !== "string" || value.trim() === "") {
      if (!unfilled.includes(rawKey)) unfilled.push(rawKey);
      return whole;
    }

    return value;
  });

  return { body, unfilled };
}

/** A starting template, for a business that has not pasted its own yet. */
export const STARTER_TEMPLATE = `{{business_name}}
{{business_phone}}

WORK AGREEMENT — Job {{job_number}}
Date: {{today}}

Customer: {{customer_name}}
Service address: {{service_address}}
Scheduled: {{job_date}}

SCOPE OF WORK
{{scope}}

PRICE
Total: {{total}}
Deposit due before work begins: {{deposit}}

The price above covers the scope of work described. Work found to be necessary
beyond that scope will be quoted separately and will not begin without your
approval.

Customer signature: ______________________  Date: ____________

{{business_name}} representative: ______________________  Date: ____________
`;

/**
 * The instructions for drafting the scope paragraph.
 *
 * Narrow on purpose. The model is given what the customer said and asked to
 * turn it into a scope of work — not to price it, not to promise a timescale,
 * and not to add terms. Everything it could get expensively wrong is filled in
 * around it by `fillTemplate`.
 */
export function scopePrompt(): string {
  return [
    "You write the scope-of-work paragraph of an electrical contracting agreement.",
    "",
    "You are given what the customer described and the kind of work booked. Write one short paragraph, three sentences at most, stating the work to be performed.",
    "",
    "Rules:",
    "- Never state a price, a discount, or a payment term. Those are filled in elsewhere and yours would contradict them.",
    "- Never promise a completion date or a duration.",
    "- Never invent work that was not described. If the description is vague, say the work will be determined by on-site diagnosis.",
    "- No warranty language, no legal terms, no headings. One plain paragraph.",
    "- Write it for the customer to read, not for another electrician.",
  ].join("\n");
}
