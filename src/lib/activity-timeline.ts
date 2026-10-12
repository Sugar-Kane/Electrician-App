/**
 * What has happened to this customer, in the order it happened.
 *
 * `activity_events` is the record; this is the reading of it. The two are
 * deliberately separate: the database stores an event type and whatever the
 * writer happened to phrase at the time, and a label written in August by the
 * booking function is not a sentence anybody wants to still be reading in
 * December. The wording lives here, keyed on the event type, so it can be fixed
 * without rewriting history — and so the same event reads the same way whether
 * it was written by a Postgres function, a webhook or a server action.
 *
 * Import-free. The grouping is date arithmetic in the business's timezone, and
 * date arithmetic in the server's timezone is how a job completed at nine in
 * the evening turns up under tomorrow.
 */

import { notServiceLabel } from "./booking-duplicates.ts";
import { calendarDate } from "./schedule-labels.ts";

/** A row as it comes out of `activity_events`. */
export type ActivityRow = {
  id: string;
  eventType: string;
  /** What the writer said. Used only for event types this file does not know. */
  label: string;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
  jobId?: string | null;
};

/** What the entry is about, which is all the UI needs to choose an icon. */
export type ActivityKind =
  | "inquiry"
  | "appointment"
  | "money"
  | "job"
  | "safety"
  | "other";

export type TimelineEntry = {
  id: string;
  /** ISO instant, kept for the time shown beside the entry. */
  at: string;
  kind: ActivityKind;
  title: string;
  /** A second line, when the metadata carries something worth reading. */
  detail: string;
  jobId?: string;
  /** A send that did not reach the customer. */
  failed?: boolean;
  /** Where to try a failed send again. */
  retry?: { label: string; href: string };
};

export type TimelineDay = {
  /** YYYY-MM-DD where the business is. */
  date: string;
  /** "Today", "Yesterday", or "Wednesday, 19 August". */
  label: string;
  entries: TimelineEntry[];
};

/*
 * The vocabulary.
 *
 * One entry per thing that can happen to a customer, phrased as somebody would
 * say it out loud rather than as the system names it. Anything missing falls
 * back to the writer's own label, so an event type added tomorrow appears on
 * the timeline tomorrow instead of disappearing until this file catches up.
 */
const WORDS: Record<string, { kind: ActivityKind; title: string }> = {
  "booking.requested": { kind: "inquiry", title: "Asked for an electrician" },
  "booking.callback_requested": { kind: "inquiry", title: "Asked for a callback" },
  "booking.transfer_started": { kind: "inquiry", title: "Live transfer started" },
  "booking.transfer_connected": { kind: "inquiry", title: "Connected to the electrician" },
  "booking.transfer_missed": { kind: "inquiry", title: "Live transfer was missed" },
  "call.recording_ready": { kind: "inquiry", title: "Call recording saved" },
  "booking.fee_accepted": { kind: "money", title: "Agreed to the diagnostic fee" },
  "booking.hold_placed": { kind: "appointment", title: "Appointment held" },
  "booking.payment_confirmed": { kind: "money", title: "Diagnostic fee paid" },
  "booking.payment_setup_failed": { kind: "money", title: "Payment link needs attention" },
  "booking.scheduled_from_text": { kind: "appointment", title: "Appointment scheduled" },
  // Not a customer review. This is the booking asking for a person to look at
  // it — the wording it shipped with reads the other way round entirely.
  "booking.review_requested": { kind: "inquiry", title: "Booking held for Nick to review" },
  "booking.expired": { kind: "appointment", title: "Held appointment expired" },
  "safety.escalated": { kind: "safety", title: "Safety concern flagged" },
  // One per workflow state, named as `job.<state>` so the writer never has to
  // translate — the states are in `job-workflow.ts` and this list follows them.
  "job.scheduled": { kind: "appointment", title: "Appointment booked" },
  "job.en_route": { kind: "job", title: "On the way" },
  "job.arrived": { kind: "job", title: "Arrived" },
  "job.working": { kind: "job", title: "Work started" },
  "job.review": { kind: "job", title: "Work done, waiting to be signed off" },
  "job.completed": { kind: "job", title: "Job completed" },
  "job.canceled": { kind: "appointment", title: "Appointment canceled" },
  "job.no_show": { kind: "appointment", title: "Nobody home" },
  "estimate.sent": { kind: "money", title: "Estimate sent" },
  "estimate.approved": { kind: "money", title: "Estimate approved" },
  "invoice.sent": { kind: "money", title: "Invoice sent" },
  "invoice.paid": { kind: "money", title: "Invoice paid" },
  // Sends that did not reach the customer are written down too, so a failed
  // or repeated send shows on the job rather than only in a toast that is gone
  // by the time anybody asks "did they get it?".
  "estimate.send_failed": { kind: "money", title: "Approval text not sent" },
  "invoice.send_failed": { kind: "money", title: "Invoice not sent" },
  "customer.notified": { kind: "appointment", title: "Customer told about the change" },
  "customer.notify_failed": { kind: "appointment", title: "Customer not told about the change" },
  // Written by the support console's Fix recipient, with the number it replaced
  // so the business can see exactly what changed and change it back.
  "customer.phone_corrected": { kind: "other", title: "Phone number corrected by Volteira support" },
  "booking.not_service": { kind: "inquiry", title: "Hidden: not a service request" },
  "booking.duplicate_hidden": { kind: "inquiry", title: "Hidden as a duplicate request" },
  "booking.restored": { kind: "inquiry", title: "Request brought back from hidden" },
};

const FAILED = new Set(["estimate.send_failed", "invoice.send_failed", "customer.notify_failed"]);

/**
 * What a send was of, so a later success can be matched to an earlier
 * failure: the job's approval, or one invoice.
 */
function sendKey(row: ActivityRow): string | null {
  if (row.eventType === "estimate.sent" || row.eventType === "estimate.send_failed") return "estimate";
  if (row.eventType === "invoice.sent" || row.eventType === "invoice.send_failed") {
    const id = row.metadata?.invoice_id;
    return typeof id === "string" && id ? `invoice:${id}` : null;
  }
  return null;
}

/**
 * Where a failed send can be tried again: the invoice itself, or the job's
 * contract card. On a customer's timeline the job is another page, so the link
 * goes there; on the job's own timeline it is a jump down the page.
 */
function retryOf(row: ActivityRow): TimelineEntry["retry"] {
  const metadata = row.metadata ?? {};
  if (row.eventType === "invoice.send_failed" && typeof metadata.invoice_id === "string" && metadata.invoice_id) {
    return { label: "Send again", href: `/invoices/${metadata.invoice_id}` };
  }
  if (row.eventType === "estimate.send_failed") {
    return { label: "Send again", href: `${row.jobId ? `/jobs/${row.jobId}` : ""}#contract` };
  }
  return undefined;
}

const CHANNELS: Record<string, string> = {
  sms: "by text",
  voice: "by phone",
  web: "on the booking page",
  email: "by email",
};

/** "$100.00" from 10000, because money is written the way it is charged. */
export function moneyLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** The second line, when the metadata says something worth reading. */
function detailOf(row: ActivityRow): string {
  const metadata = row.metadata ?? {};
  const parts: string[] = [];

  const amount = metadata.amount_cents;
  if (typeof amount === "number" && Number.isFinite(amount)) parts.push(moneyLabel(amount));

  // Known channels get said the way people say them; anything else is shown as
  // it was written. The alternative — wrapping every value in a preposition —
  // produced "on the text and email".
  const via = metadata.via;
  if (typeof via === "string" && via) parts.push(CHANNELS[via] ?? via);

  const note = metadata.note;
  if (typeof note === "string" && note.trim()) parts.push(note.trim());

  const previous = metadata.previous_phone;
  if (typeof previous === "string" && previous.trim()) parts.push(`was ${previous.trim()}`);

  const classification = metadata.classification;
  if (typeof classification === "string" && classification) parts.push(notServiceLabel(classification) || classification);
  if (metadata.by_support === true) parts.push("by Volteira support");

  // Why a send did not go, in the words the sender was given.
  const reason = metadata.reason;
  if (typeof reason === "string" && reason.trim()) parts.push(reason.trim());

  return parts.join(" · ");
}

/** "Wednesday, 19 August", or the two days that have their own names. */
function dayLabel(date: string, today: string, timeZone: string): string {
  if (date === today) return "Today";

  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (date === yesterday.toISOString().slice(0, 10)) return "Yesterday";

  // Noon, so the formatter cannot be pushed onto the day either side by an
  // offset — this is a date being named, not an instant being converted.
  const at = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return date;

  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(at);
}

/**
 * The customer's history, newest day first, newest event first within a day.
 *
 * Ties are broken by id rather than left to the sort's mercy: two events
 * written in the same transaction share a timestamp to the microsecond, and a
 * timeline that reorders itself between two reads of the same page is a
 * timeline nobody trusts.
 */
export function buildTimeline(
  rows: ActivityRow[],
  timeZone: string,
  today: string,
): TimelineDay[] {
  const days = new Map<string, TimelineEntry[]>();

  const ordered = [...rows].sort((a, b) => {
    const at = b.createdAt.localeCompare(a.createdAt);
    return at !== 0 ? at : b.id.localeCompare(a.id);
  });

  // Newest first, so by the time a failure is reached every later send of the
  // same thing has been seen. One that went through since needs no retry.
  const sentSince = new Set<string>();

  for (const row of ordered) {
    // Checked before formatting, because `calendarDate` throws on a date it
    // cannot read rather than returning nothing — and one unreadable row must
    // not take the customer's whole history down with it.
    if (Number.isNaN(Date.parse(row.createdAt))) continue;

    const date = calendarDate(row.createdAt, timeZone);
    if (!date) continue;

    const known = WORDS[row.eventType];
    const entry: TimelineEntry = {
      id: row.id,
      at: row.createdAt,
      kind: known?.kind ?? "other",
      title: known?.title ?? row.label,
      detail: detailOf(row),
    };
    if (row.jobId) entry.jobId = row.jobId;
    const key = sendKey(row);
    if (FAILED.has(row.eventType)) {
      entry.failed = true;
      const retry = key && sentSince.has(key) ? undefined : retryOf(row);
      if (retry) entry.retry = retry;
    } else if (key) {
      sentSince.add(key);
    }

    const list = days.get(date);
    if (list) list.push(entry);
    else days.set(date, [entry]);
  }

  return [...days.entries()].map(([date, entries]) => ({
    date,
    label: dayLabel(date, today, timeZone),
    entries,
  }));
}
