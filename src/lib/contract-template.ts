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

export type ContractMoney = {
  /** The agreed price. Zero when the job has none yet, which stays a blank. */
  totalCents: number;
  depositCents: number;
  /** Paid at booking, so the deposit line says so rather than asking again. */
  depositPaid: boolean;
  /**
   * Where the total came from. "diagnostic" means this contract is for the
   * visit alone, and its scope has to say so: a $180 total under a paragraph
   * describing a panel replacement reads as $180 for the panel.
   */
  source: "invoices" | "diagnostic" | "none";
};

/**
 * The two money lines on a contract, from what the job has been priced at.
 *
 * Invoices first: they are what the customer is actually being charged. Their
 * totals already have a prepaid diagnostic taken off, which is added back here
 * because the deposit line now reports it as paid — leaving it off would make
 * $1,540 of work read as a $1,360 total with $180 paid on top.
 *
 * Without invoices, a diagnostic visit has a price after all: its fee. That is
 * the whole agreement for a job booked and paid for online and not yet looked
 * at. Anything else with nothing priced stays blank, and so does a diagnostic
 * job whose work has been itemised but not billed — falling back to the fee
 * there would put $180 on a contract for work the electrician has priced at
 * far more.
 */
export function contractMoney(input: {
  category: string;
  diagnosticFeeCents: number;
  diagnosticPaid: boolean;
  invoices: { totalCents: number; diagnosticCreditCents: number }[];
  /** Work-and-parts lines that come to more than nothing. */
  pricedLineCount: number;
}): ContractMoney {
  const cents = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
  const fee = cents(input.diagnosticFeeCents);
  const deposit = { depositCents: fee, depositPaid: input.diagnosticPaid && fee > 0 };

  if (input.invoices.length > 0) {
    const totalCents = input.invoices.reduce(
      (sum, invoice) => sum + cents(invoice.totalCents) + cents(invoice.diagnosticCreditCents),
      0,
    );
    return { totalCents, ...deposit, source: totalCents > 0 ? "invoices" : "none" };
  }

  if (input.category === "diagnostic" && input.pricedLineCount === 0 && fee > 0) {
    return { totalCents: fee, ...deposit, source: "diagnostic" };
  }

  return { totalCents: 0, ...deposit, source: "none" };
}

/**
 * A starting template, for a business that has not pasted its own yet.
 *
 * Written to sit inside the generated document rather than to be one. It used to
 * open with the business name and phone, restate the customer and the address,
 * and close with two signature lines — all of which the PDF now prints around
 * it, as a letterhead, a pair of labelled blocks and a signature block. Left as
 * it was, every contract said everything twice and offered two places to sign.
 *
 * A pasted template that still does all of that is not touched: it is their
 * contract. The document notices the signing lines and leaves its own out.
 */
export const STARTER_TEMPLATE = `WORK AGREEMENT

This agreement is made on {{today}} between {{business_name}} ("the Contractor")
and {{customer_name}} ("the Customer") for {{work_type}} work at
{{service_address}}, booked as job {{job_number}} and scheduled for {{job_date}}.

SCOPE OF WORK
{{scope}}

PRICE
Total: {{total}}
Deposit due before work begins: {{deposit}}

The price above covers the scope of work described. Work found to be necessary
beyond that scope will be quoted separately and will not begin without your
approval.

PAYMENT
The balance is due on completion of the work described above.

ACCESS AND CONDITIONS
The Customer agrees to provide access to the working area and to the electrical
service on the scheduled date. Concealed conditions found once work has begun —
existing wiring that does not meet code, undisclosed alterations, damage behind
finished surfaces — will be reported before any additional work is carried out.
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
