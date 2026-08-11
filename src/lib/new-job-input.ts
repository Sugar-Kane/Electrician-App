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
 * "Dana Harper, 994 Red Gum Lane, panel work Tuesday, $1,280."
 *
 * Import-free, so the rules can be tested without a database.
 */

import { toE164 } from "./phone-format.ts";

export const JOB_CATEGORIES = [
  { value: "diagnostic", label: "Diagnostic" },
  { value: "panel_breaker", label: "Panel or breaker" },
  { value: "ev_charger", label: "EV charger" },
  { value: "lighting", label: "Lighting" },
  { value: "outlet_switch", label: "Outlet or switch" },
  { value: "power_loss", label: "Power loss" },
] as const;

export type JobCategory = (typeof JOB_CATEGORIES)[number]["value"];

const CATEGORY_VALUES = new Set<string>(JOB_CATEGORIES.map((entry) => entry.value));

export function isJobCategory(value: string): value is JobCategory {
  return CATEGORY_VALUES.has(value);
}

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
};

export type ParseResult =
  | { ok: true; value: NewJobParsed }
  | { ok: false; error: string };

/** The default visit length, when nobody says otherwise. */
const DEFAULT_DURATION_MINUTES = 120;
const MAX_DURATION_MINUTES = 12 * 60;

/**
 * Money as an electrician types it, in cents.
 *
 * Returns null rather than 0 for something unreadable, because 0 is a real
 * answer — "no invoice" — and a typo silently becoming a free job is the
 * expensive kind of quiet failure.
 */
export function parseCostToCents(input: string): number | null {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return 0;

  // Currency symbols and thousands separators are how people write money, not
  // errors to reject.
  const cleaned = trimmed.replace(/[$,\s]/g, "");
  if (!/^\d*(\.\d{1,2})?$/.test(cleaned)) return null;
  if (cleaned === "" || cleaned === ".") return null;

  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return null;

  // Round rather than truncate: 0.1 + 0.2 arithmetic on a price should not
  // quietly lose a cent.
  return Math.round(amount * 100);
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

export function parseNewJob(raw: NewJobRaw): ParseResult {
  const customerName = clean(raw.customerName);
  if (!customerName) {
    return { ok: false, error: "A customer name is needed." };
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
  // sends notifications.
  if (!phone && !email) {
    return { ok: false, error: "A phone number or an email address is needed to reach them." };
  }

  const line1 = clean(raw.addressLine1);
  const city = clean(raw.city);
  const state = clean(raw.state);
  const postalCode = clean(raw.postalCode);
  const addressParts = [line1, city, state, postalCode];
  const givenParts = addressParts.filter(Boolean);

  // The properties table requires all four. A part-filled address would be
  // rejected by the database with a message nobody in a van can act on.
  if (givenParts.length > 0 && givenParts.length < addressParts.length) {
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

  const costCents = parseCostToCents(raw.cost);
  if (costCents === null) {
    return { ok: false, error: "That cost could not be read. Try a figure like 1280 or 1280.50." };
  }

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
      costCents,
    },
  };
}
