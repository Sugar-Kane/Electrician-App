import "server-only";

import { createClient } from "@/lib/supabase/server";
import { duplicateGroups, type HideableBooking } from "@/lib/booking-duplicates";
import { isOpenRequest, splitQueue } from "@/lib/booking-queue";
import { currentContext, currentUser } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { zonedWallClockToIso } from "@/lib/schedule-labels";
import { DEFAULT_TIMEZONE } from "@/lib/timezones";

/**
 * Booking requests that arrived as text messages and still need a person.
 *
 * A visit the customer accepted is already a job by the time it lands here;
 * what is left is callbacks, safety escalations, and anything the intake could
 * not finish — the work that used to sit in a table with no screen.
 */

export type BookingSource = "sms" | "voice" | "web" | "owner";

export type BookingRequest = {
  id: string;
  /** "website" when it came from the request form on the business's own site. */
  origin?: "website" | "";
  /** When the customer said suits them, in their words, from the website form. */
  preferredTimes?: string;
  /** How the customer asked to be contacted on the website form. */
  contactPreference?: "phone" | "email" | "text" | "";
  /** Whether they ticked the box agreeing to texts. */
  smsConsent?: boolean;
  /** How Maya's call back went, for a website request that asked for a call. */
  callbackOutcome?: string;
  /** How the customer asked. One table, categorised rather than duplicated. */
  source: BookingSource;
  status:
    | "new"
    | "needs_review"
    | "awaiting_payment"
    | "safety_escalated"
    | "confirmed"
    | "scheduled"
    | "dismissed"
    | "canceled"
    | "expired";
  intent: "callback" | "visit" | "emergency";
  phone: string;
  contactName: string;
  description: string;
  address: string;
  urgency: "routine" | "urgent";
  safetyFlags: string[];
  arrivalWindow: string;
  receivedLabel: string;
  /**
   * The raw instant, alongside the formatted one.
   *
   * The label is written in the business's timezone for a person to read; the
   * week rule that ages handled requests out needs something to subtract from.
   */
  receivedAt: string;
  conversationId: string | null;
  jobId: string | null;
  organizationId: string;
  email: string;
  depositPaidAt: string;
  paymentIntentId: string;
  paymentCount: number;
  /** Hidden as not a service request: sales, spam, test or other. */
  classification: string;
  archivedAt: string;
  archivedLabel: string;
  /** The request this one was hidden as a duplicate of. */
  duplicateOf: string;
  duplicateReviewedAt: string;
};

/** The fields the hiding rules read, from a request as the screens hold it. */
export function hideable(request: BookingRequest): HideableBooking {
  return {
    id: request.id,
    organizationId: request.organizationId,
    status: request.status,
    phone: request.phone,
    email: request.email,
    createdAt: request.receivedAt,
    jobId: request.jobId ?? "",
    depositPaidAt: request.depositPaidAt,
    paymentIntentId: request.paymentIntentId,
    paymentCount: request.paymentCount,
    archivedAt: request.archivedAt,
    duplicateReviewedAt: request.duplicateReviewedAt,
  };
}

export type BookingRequestQueue = {
  requiresLogin: boolean;
  /**
   * The queue, already split.
   *
   * Split here rather than in the page because it needs the clock, and reading
   * the clock while a component renders is a thing React forbids — a render
   * that runs twice would sort the same rows two different ways.
   */
  open: BookingRequest[];
  handled: BookingRequest[];
  /** Handled and older than a week: counted, not listed. */
  agedOut: number;
  timezone: string;
  requests: BookingRequest[];
  /** Requests that look like one person asking twice, with at least one still waiting. */
  duplicates: BookingRequest[][];
};

const COLUMNS =
  "id, organization_id, source, status, intent, phone, email, contact_name, description, address_line_1, city, postal_code, urgency, safety_flags, arrival_window_start, arrival_window_end, created_at, conversation_id, created_job_id, deposit_paid_at, stripe_payment_intent_id, classification, archived_at, duplicate_of, duplicate_reviewed_at, origin, preferred_times, contact_preference, sms_consent, callback_outcome";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatWhen(iso: string, timeZone: string, withTime = true): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(new Date(iso));
}

type Database = ReturnType<typeof asFlexibleClient>;

/** How many payments each request has, of any status. */
async function paymentCounts(database: Database, ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const { data } = await database.from("payments").select("booking_request_id").in("booking_request_id", ids);
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const id = text(row.booking_request_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function toRequest(row: Record<string, unknown>, timezone: string, payments: Map<string, number>): BookingRequest {
  const start = text(row.arrival_window_start);
  const end = text(row.arrival_window_end);
  const archivedAt = text(row.archived_at);
  return {
    id: text(row.id),
    source: (text(row.source) || "sms") as BookingSource,
    status: (text(row.status) || "new") as BookingRequest["status"],
    intent: (text(row.intent) || "callback") as BookingRequest["intent"],
    phone: text(row.phone),
    contactName: text(row.contact_name),
    description: text(row.description),
    address: [text(row.address_line_1), text(row.city), text(row.postal_code)]
      .filter(Boolean)
      .join(", "),
    urgency: text(row.urgency) === "urgent" ? "urgent" : "routine",
    safetyFlags: Array.isArray(row.safety_flags) ? (row.safety_flags as string[]) : [],
    arrivalWindow: start
      ? `${formatWhen(start, timezone)}${end ? `–${new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(end))}` : ""}`
      : "",
    receivedLabel: formatWhen(text(row.created_at), timezone),
    receivedAt: text(row.created_at),
    conversationId: text(row.conversation_id) || null,
    jobId: text(row.created_job_id) || null,
    organizationId: text(row.organization_id),
    email: text(row.email),
    depositPaidAt: text(row.deposit_paid_at),
    paymentIntentId: text(row.stripe_payment_intent_id),
    paymentCount: payments.get(text(row.id)) ?? 0,
    classification: text(row.classification),
    archivedAt,
    archivedLabel: archivedAt ? formatWhen(archivedAt, timezone) : "",
    duplicateOf: text(row.duplicate_of),
    duplicateReviewedAt: text(row.duplicate_reviewed_at),
    origin: text(row.origin) === "website" ? "website" : "",
    preferredTimes: text(row.preferred_times),
    contactPreference: (["phone", "email", "text"].includes(text(row.contact_preference)) ? text(row.contact_preference) : "") as BookingRequest["contactPreference"],
    smsConsent: row.sms_consent === true,
    callbackOutcome: text(row.callback_outcome),
  };
}

const EMPTY = { requests: [], open: [], handled: [], agedOut: 0, duplicates: [] };

export async function getBookingRequests(): Promise<BookingRequestQueue> {
  /*
   * Both memoised for the length of the request. This module used to verify the
   * session and look up the membership itself, and so did the dashboard, and so
   * did `request-context` — three round trips to the auth server before the
   * home page fetched a single row.
   *
   * Two calls rather than one because signed out and signed in with no business
   * are different answers on this screen.
   */
  const user = await currentUser();
  if (!user) return { requiresLogin: true, timezone: DEFAULT_TIMEZONE, ...EMPTY };

  const context = await currentContext();
  if (!context) return { requiresLogin: false, timezone: DEFAULT_TIMEZONE, ...EMPTY };

  const supabase = await createClient();
  const database = asFlexibleClient(supabase);
  const organizationId = context.organizationId;
  const timezone = context.timeZone || DEFAULT_TIMEZONE;

  // Hidden requests live in History, not here.
  const { data } = await database
    .from("booking_requests")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as Record<string, unknown>[];
  const payments = await paymentCounts(database, rows.map((row) => text(row.id)));
  const requests = rows.map((row) => toRequest(row, timezone, payments));

  // Split here, where reading the clock is allowed. The page renders what it
  // is handed.
  const { open, handled, agedOut } = splitQueue(requests, Date.now());

  const byId = new Map(requests.map((request) => [request.id, request]));
  const duplicates = duplicateGroups(requests.map(hideable))
    .map((group) => group.map((entry) => byId.get(entry.id)!))
    .filter((group) => group.some((request) => isOpenRequest(request.status)));

  return { requiresLogin: false, timezone, requests, open, handled, agedOut, duplicates };
}

export type HistoryFilter = {
  q: string;
  /** "waiting", "handled", "hidden", or "" for all. */
  state: string;
  source: string;
  /** Business-local days, YYYY-MM-DD. */
  from: string;
  to: string;
  /** Show requests older than this instant: the next page. */
  before: string;
};

export type BookingHistory = {
  requiresLogin: boolean;
  timezone: string;
  requests: BookingRequest[];
  /** The instant to ask for the next page from, or "" when there is no more. */
  next: string;
};

const PAGE = 40;
const OPEN = ["new", "needs_review", "awaiting_payment", "safety_escalated"];

/**
 * What somebody typed, safe to put inside a quoted PostgREST filter value:
 * no quote or backslash to break out of it, and no wildcards of its own.
 */
function plainSearch(value: string): string {
  return value.replace(/["\\%_*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/**
 * Every request the business ever had, searchable, newest first, with no week
 * cut-off. Hidden ones are here too, marked, so nothing is ever only gone.
 */
export async function getBookingHistory(filter: HistoryFilter): Promise<BookingHistory> {
  const user = await currentUser();
  if (!user) return { requiresLogin: true, timezone: DEFAULT_TIMEZONE, requests: [], next: "" };
  const context = await currentContext();
  if (!context) return { requiresLogin: false, timezone: DEFAULT_TIMEZONE, requests: [], next: "" };

  const timezone = context.timeZone || DEFAULT_TIMEZONE;
  const database = asFlexibleClient(await createClient());
  let query = database
    .from("booking_requests")
    .select(COLUMNS)
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: false })
    .limit(PAGE + 1);

  const words = plainSearch(filter.q);
  if (words) {
    const digits = words.replace(/\D+/g, "");
    // Quoted, so commas, dots and brackets in what was typed stay part of it.
    const like = `"%${words}%"`;
    const clauses = [
      `contact_name.ilike.${like}`,
      `first_name.ilike.${like}`,
      `last_name.ilike.${like}`,
      `description.ilike.${like}`,
      `email.ilike.${like}`,
      `address_line_1.ilike.${like}`,
    ];
    // Digits in order, whatever sits between them: phones are stored both as
    // +18055550142 and as (805) 555-0142.
    if (digits.length >= 3) clauses.push(`phone.match."${digits.slice(0, 15).split("").join("[^0-9]*")}"`);
    query = query.or(clauses.join(","));
  }
  if (filter.state === "hidden") query = query.not("archived_at", "is", null);
  else if (filter.state === "waiting") query = query.is("archived_at", null).in("status", OPEN);
  else if (filter.state === "handled") query = query.is("archived_at", null).not("status", "in", `(${OPEN.join(",")})`);
  if (["sms", "voice", "web", "owner"].includes(filter.source)) query = query.eq("source", filter.source);
  if (/^\d{4}-\d{2}-\d{2}$/.test(filter.from)) {
    const from = zonedWallClockToIso(`${filter.from}T00:00`, timezone);
    if (from) query = query.gte("created_at", from);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(filter.to)) {
    const day = new Date(`${filter.to}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1);
    const to = zonedWallClockToIso(`${day.toISOString().slice(0, 10)}T00:00`, timezone);
    if (to) query = query.lt("created_at", to);
  }
  if (filter.before && Number.isFinite(Date.parse(filter.before))) query = query.lt("created_at", filter.before);

  const { data } = await query;
  const rows = (data ?? []) as Record<string, unknown>[];
  const page = rows.slice(0, PAGE);
  const payments = await paymentCounts(database, page.map((row) => text(row.id)));
  return {
    requiresLogin: false,
    timezone,
    requests: page.map((row) => toRequest(row, timezone, payments)),
    next: rows.length > PAGE ? text(page[page.length - 1]?.created_at) : "",
  };
}
