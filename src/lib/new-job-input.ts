/**
 * Reading a job somebody typed in.
 *
 * Until now the only way a job existed was for a customer to phone the voice
 * assistant or text the number. That covers the customers who call; it does not
 * cover the neighbour who stopped the van, the landlord who emailed, or the job
 * the owner is entering on Monday for work booked on Saturday. Those all get
 * written down somewhere else and never make it into the app, which is why the
 * schedule is not the whole business.
 *
 * One form creates up to four things — a customer, a property, a job, and
 * optionally an invoice — because from the owner's side that is one action:
 * "the Websters on Oak Road, panel work Tuesday, $1,280."
 *
 * Import-free, so the rules can be tested without a database.
 */

import { toE164 } from "./phone-format.ts";

/**
 * The two things a visit can be.
 *
 * It used to be a list of electrical problems — panel, EV charger, lighting —
 * which is a description of the fault, not of the appointment. The owner
 * booking work already knows what is broken; what they are deciding here is
 * whether somebody is going out to find out, or going out to do a known job.
 * Those two have different lengths, different prices and different paperwork,
 * and nothing else on this list did.
 *
 * The fault is still recorded — it is what the customer said, in the
 * description, and it is still what the text and phone assistants classify.
 */
export const JOB_CATEGORIES = [
  {
    value: "diagnostic",
    label: "Diagnostic",
    description: "Two hours to find the fault. The fee is credited against the repair.",
  },
  {
    value: "work_order",
    label: "Work order",
    description: "Work already agreed. Add the lines and the hours below.",
  },
] as const;

export type JobCategory = (typeof JOB_CATEGORIES)[number]["value"];

const CATEGORY_VALUES = new Set<string>(JOB_CATEGORIES.map((entry) => entry.value));

export function isJobCategory(value: string): value is JobCategory {
  return CATEGORY_VALUES.has(value);
}

/**
 * The kind of work, as a person reads it.
 *
 * Jobs booked before this list changed still carry `panel_breaker` and the rest,
 * and jobs booked by text still carry whatever the assistant classified the
 * fault as. Both are real records and neither is being rewritten, so this reads
 * every value the column has ever held rather than only the two it offers now.
 */
const CATEGORY_LABELS: Record<string, string> = {
  diagnostic: "Diagnostic",
  work_order: "Work order",
  panel_breaker: "Panel or breaker",
  ev_charger: "EV charger",
  lighting: "Lighting",
  outlet_switch: "Outlet or switch",
  power_loss: "Power loss",
};

export function jobCategoryLabel(value: string): string {
  const key = (value ?? "").trim();
  if (!key) return "Service";
  return CATEGORY_LABELS[key] ?? key.replace(/_/g, " ");
}

/**
 * Which button was pressed.
 *
 * A draft is a job the owner has not finished writing — half an address, no
 * email yet, a price still being worked out. It is saved anyway, because the
 * alternative is that they keep it on a piece of paper. Only the rules that
 * would produce a *wrong* record are enforced on a draft; the rules that only
 * say "you have not finished" are not, because the button already said that.
 */
export type SaveMode = "save" | "draft";

export function isSaveMode(value: string): value is SaveMode {
  return value === "save" || value === "draft";
}

/** A line on a work order: an hour of somebody's time, or a part. */
export type WorkOrderLine = {
  kind: "labour" | "material";
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
};

/**
 * Long enough for a real job, short enough that a runaway paste is refused.
 *
 * Every line is a row, and the form posts them in one field.
 */
export const MAX_WORK_ORDER_LINES = 40;

/** `job_line_items.description` is capped at this in the database. */
const MAX_LINE_DESCRIPTION = 300;
const MAX_LINE_UNIT = 24;

export type NewJobRaw = {
  customerName: string;
  phone: string;
  email: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  category: string;
  description: string;
  /** Wall clock in the business's zone, from a datetime-local input. */
  startLocal: string;
  /** Hours. Blank means the default. */
  durationHours: string;
  /** What the work costs, as typed: "1280", "$1,280.00", "1280.5". */
  cost: string;
  /** "save" or "draft". Anything else is read as a save. */
  mode: string;
  /** The work order's lines, as JSON, or empty for a diagnostic. */
  workOrderLines: string;
};

export type NewJobParsed = {
  customerName: string;
  /** E.164, or empty. Never the raw string — a carrier will not take it. */
  phone: string;
  email: string;
  address: { line1: string; city: string; state: string; postalCode: string } | null;
  category: JobCategory;
  description: string;
  startLocal: string;
  durationMinutes: number;
  /** Cents. Zero means no invoice is to be raised. */
  costCents: number;
  mode: SaveMode;
  /** Empty for a diagnostic, and for a work order nobody itemised. */
  lines: WorkOrderLine[];
};

export type ParseResult =
  | { ok: true; value: NewJobParsed }
  | { ok: false; error: string };

/** The default visit length, when nobody says otherwise. */
const DEFAULT_DURATION_MINUTES = 120;
const MAX_DURATION_MINUTES = 12 * 60;

/**
 * A diagnostic is two hours. Not a default — a fact about the product.
 *
 * The price is quoted for a two-hour visit on the booking page, in the text
 * assistant and on the phone. A diagnostic booked by hand for forty minutes
 * would be the same money for a third of the time, and the schedule would
 * quietly disagree with what the customer was told.
 */
export const DIAGNOSTIC_MINUTES = 120;

/**
 * The largest figure the money columns can hold.
 *
 * `invoices.subtotal_cents` and its siblings are `integer`, which stops at
 * 2,147,483,647 cents. A job priced above that does not fail politely — it gets
 * as far as Postgres and comes back as an overflow, which is a raw database
 * error on a screen belonging to somebody holding a phone in a crawlspace.
 */
export const MAX_COST_CENTS = 99_999_999_99;

export type CostReading =
  | { ok: true; cents: number }
  | { ok: false; because: "unreadable" | "too_large" };

/**
 * Money as an electrician types it, in cents, with the reason it could not be.
 *
 * Forgiving about how the figure is written, and deliberately so. A million
 * dollar job typed as `1,000,000.` — the decimal point tapped before the cents
 * were — used to be rejected outright, which is how somebody lost a whole form
 * to a trailing full stop. A figure that is unambiguous to a person is
 * unambiguous here: symbols, separators, a trailing point and more decimals
 * than money has all read as the number they plainly mean.
 *
 * Nothing readable comes back as zero by accident: an empty box is "no
 * invoice", and everything else either parses or says why not. A typo quietly
 * becoming a free job is the expensive kind of failure.
 */
export function readCost(input: string): CostReading {
  // Non-breaking and narrow spaces come from phone keyboards and from anything
  // pasted out of a spreadsheet, and are spaces by any reading.
  const trimmed = (input ?? "").replace(/[\u00a0\u202f\u2007]/g, " ").trim();
  if (!trimmed) return { ok: true, cents: 0 };

  // Currency symbols and thousands separators are how people write money, not
  // errors to reject.
  let cleaned = trimmed.replace(/[$,\s]/g, "");

  // A trailing point is a figure somebody is still typing, not a broken one.
  if (cleaned.endsWith(".")) cleaned = cleaned.slice(0, -1);

  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { ok: false, because: "unreadable" };

  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, because: "unreadable" };

  // Round rather than truncate: 0.1 + 0.2 arithmetic on a price should not
  // quietly lose a cent, and a third decimal is rounded to the nearest one the
  // invoice can actually charge.
  const cents = Math.round(amount * 100);
  if (cents > MAX_COST_CENTS) return { ok: false, because: "too_large" };

  return { ok: true, cents };
}

/** The same reading, for the callers that only need the number. */
export function parseCostToCents(input: string): number | null {
  const reading = readCost(input);
  return reading.ok ? reading.cents : null;
}

function clean(value: string): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 6 || trimmed.length > 254) return false;
  if (/\s/.test(trimmed)) return false;
  return /^[^@]+@[^@.]+\.[^@]{2,}$/.test(trimmed);
}

/**
 * Split a typed name into the two columns the customer table has.
 *
 * "Dana Harper" is two fields in the database and one field to a human, and
 * asking for them separately is how a form starts feeling like paperwork. A
 * single word is a first name; anything after the first word is the surname,
 * so "Mary Jo Van Der Berg" keeps its surname intact.
 */
export function splitName(value: string): { firstName: string; lastName: string } {
  const parts = clean(value).split(" ").filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

/**
 * The lines of a work order, as the form posts them.
 *
 * JSON in one hidden field rather than thirty numbered inputs. Anything that is
 * not a usable line is dropped rather than refused — a half-typed row at the
 * bottom of the list is the normal state of a form somebody is still filling
 * in, and losing the other eight lines over it would be absurd.
 */
export function parseWorkOrderLines(raw: string): WorkOrderLine[] {
  const text = (raw ?? "").trim();
  if (!text) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const lines: WorkOrderLine[] = [];

  for (const entry of parsed.slice(0, MAX_WORK_ORDER_LINES)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;

    const description = clean(typeof row.description === "string" ? row.description : "").slice(
      0,
      MAX_LINE_DESCRIPTION,
    );
    if (!description) continue;

    const kind = row.kind === "material" ? "material" : "labour";

    const quantity = Number(row.quantity);
    // Quantity has a `> 0` check in the database, so a zero here would come
    // back as a constraint violation rather than as a line worth nothing.
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const unit =
      clean(typeof row.unit === "string" ? row.unit : "").slice(0, MAX_LINE_UNIT) ||
      (kind === "labour" ? "hour" : "each");

    const price = Number(row.unitPriceCents);
    const unitPriceCents =
      Number.isFinite(price) && price >= 0 ? Math.min(Math.round(price), MAX_COST_CENTS) : 0;

    lines.push({
      kind,
      description,
      // Three decimal places, matching `numeric(12, 3)` — wire by the foot and
      // time by the quarter hour both land inside that.
      quantity: Math.round(quantity * 1000) / 1000,
      unit,
      unitPriceCents,
    });
  }

  return lines;
}

/** What a work order's lines add up to, in cents. */
export function workOrderTotalCents(lines: WorkOrderLine[]): number {
  return lines.reduce((total, line) => total + Math.round(line.quantity * line.unitPriceCents), 0);
}

export function parseNewJob(raw: NewJobRaw): ParseResult {
  const mode: SaveMode = isSaveMode(raw.mode.trim()) ? (raw.mode.trim() as SaveMode) : "save";
  const draft = mode === "draft";

  const customerName = clean(raw.customerName);
  if (!customerName) {
    // Enforced even for a draft. A job filed under nobody cannot be found
    // again, which makes saving it the same as losing it.
    return { ok: false, error: "A customer name is needed, even to save a draft." };
  }

  const email = raw.email.trim();
  if (email && !looksLikeEmail(email)) {
    return { ok: false, error: "That email address does not look like one mail can reach." };
  }

  const phone = toE164(raw.phone);
  if (raw.phone.trim() && !phone) {
    return {
      ok: false,
      error: "That phone number could not be read. A 10-digit US number or +country code works.",
    };
  }

  // Not pedantry: with neither, nothing in the app can ever tell this customer
  // their appointment moved, and the job is a note in a system that thinks it
  // sends notifications. A draft is exempt — it is not going to notify anybody
  // yet, and the whole point of the button is to save what there is so far.
  if (!draft && !phone && !email) {
    return { ok: false, error: "A phone number or an email address is needed to reach them." };
  }

  const line1 = clean(raw.addressLine1);
  const city = clean(raw.city);
  const state = clean(raw.state);
  const postalCode = clean(raw.postalCode);
  const addressParts = [line1, city, state, postalCode];
  const givenParts = addressParts.filter(Boolean);

  // The properties table requires all four. A part-filled address would be
  // rejected by the database with a message nobody in a van can act on — so on
  // a real save it is asked for up front, and on a draft the gaps are kept as
  // gaps rather than throwing away what was typed.
  if (!draft && givenParts.length > 0 && givenParts.length < addressParts.length) {
    return {
      ok: false,
      error: "An address needs street, city, state, and ZIP — or leave all four blank.",
    };
  }

  const category = raw.category.trim() || "diagnostic";
  if (!isJobCategory(category)) {
    return { ok: false, error: "That is not a kind of work this app knows about." };
  }

  const durationRaw = raw.durationHours.trim();
  let durationMinutes = DEFAULT_DURATION_MINUTES;
  if (durationRaw) {
    const hours = Number(durationRaw);
    if (!Number.isFinite(hours) || hours <= 0) {
      return { ok: false, error: "How long the visit takes has to be a number of hours." };
    }
    durationMinutes = Math.round(hours * 60);
    if (durationMinutes > MAX_DURATION_MINUTES) {
      return { ok: false, error: "A single visit cannot be longer than 12 hours." };
    }
  }

  // Set here rather than trusted from the form. The field is locked on screen,
  // and a locked field is a courtesy, not a control.
  if (category === "diagnostic") durationMinutes = DIAGNOSTIC_MINUTES;

  const cost = readCost(raw.cost);
  if (!cost.ok) {
    return {
      ok: false,
      error:
        cost.because === "too_large"
          ? "That cost is larger than an invoice can hold. The most that fits is $99,999,999.99."
          : "That cost could not be read. Try a figure like 1280 or 1280.50.",
    };
  }

  const lines = category === "work_order" ? parseWorkOrderLines(raw.workOrderLines) : [];

  return {
    ok: true,
    value: {
      customerName,
      phone,
      email,
      address: line1 ? { line1, city, state, postalCode } : null,
      category,
      description: raw.description.trim(),
      startLocal: raw.startLocal.trim(),
      durationMinutes,
      costCents: cost.cents,
      mode,
      lines,
    },
  };
}
