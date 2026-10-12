/**
 * What an electrician needs when they open the app during the working day.
 *
 * The dashboard showed seven sections — schedule, live route, profit, invoices,
 * low stock, recent activity, AI — and none of them was the next job. Four were
 * things an owner reads monthly. The single most useful fact on the screen,
 * "where am I going next", was not on it at all.
 *
 * This picks that out. Import-free, so choosing the next job can be tested at
 * every awkward hour without a database.
 */

import type { PilotJob } from "./pilot-data.ts";

/**
 * A twelve-hour label as minutes past midnight.
 *
 * The job carries its time as the string somebody reads — "8:00 AM" — and
 * sorting those as text puts 11:00 AM before 2:00 PM before 8:00 AM. On a
 * dashboard that means the afternoon job at the top of the day and the wrong
 * one named as next.
 *
 * Unparseable times sort last rather than to midnight, so a malformed value
 * cannot claim to be the first job of the morning.
 */
export function minutesFromLabel(label: string): number {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((label ?? "").trim());
  if (!match) return Number.MAX_SAFE_INTEGER;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return Number.MAX_SAFE_INTEGER;

  const afternoon = match[3]!.toUpperCase() === "PM";
  // 12 AM is midnight and 12 PM is noon; both break a naive +12.
  const hours = hour === 12 ? (afternoon ? 12 : 0) : afternoon ? hour + 12 : hour;

  return hours * 60 + minute;
}

function byTime(a: { time: string }, b: { time: string }): number {
  return minutesFromLabel(a.time) - minutesFromLabel(b.time);
}

/** Work that is not happening is not work. */
export function isActive(job: { status: string }): boolean {
  return job.status !== "Canceled" && job.status !== "Completed";
}

/**
 * Whether this job still needs somebody sent to it.
 *
 * The dashboard counted every job today with no technician on it, including the
 * ones that were already finished. So a job somebody did themselves without
 * ever filling in the technician field sat in Needs attention in amber, marked
 * urgent, for the rest of the day — and nothing could clear it, because the work
 * was over. An alert that cannot be cleared is an alert people stop reading,
 * which costs the real one that arrives later.
 *
 * "Pending" is out for the same reason `openBookingRequests` leaves
 * `awaiting_payment` out: it covers drafts and bookings the customer has not
 * paid for yet, which are not commitments anybody needs dispatching to. What is
 * left is work that is going to happen or is happening now.
 */
export function needsTechnician(job: { status: string; technician: string }): boolean {
  if (job.status !== "Scheduled" && job.status !== "In progress") return false;
  const assigned = (job.technician ?? "").trim();
  return assigned === "" || assigned === UNASSIGNED;
}

/** What `mapJob` writes when a job has no technician on it. */
export const UNASSIGNED = "Unassigned";

/** Today's jobs that still need somebody sent to them. */
export function unassignedToday(
  jobs: { date: string; status: string; technician: string }[],
  today: string,
): number {
  return jobs.filter((job) => job.date === today && needsTechnician(job)).length;
}

/**
 * Today's jobs, in the order they happen.
 *
 * Canceled work is excluded rather than struck through, because a count that
 * includes it makes a day look full when it is not — and the driver treats the
 * list as the route.
 */
export function todaysJobs(jobs: PilotJob[], today: string): PilotJob[] {
  return jobs
    .filter((job) => job.date === today && job.status !== "Canceled")
    .sort(byTime);
}

export function canceledToday(jobs: PilotJob[], today: string): PilotJob[] {
  return jobs.filter((job) => job.date === today && job.status === "Canceled");
}

/**
 * The one job to put at the top.
 *
 * In progress beats everything: if somebody is on a job, that is the job. After
 * that it is the next one that has not been done, today first, and then the
 * soonest future day — an electrician opening the app at six in the evening
 * with nothing left today wants tomorrow's first call, not an empty screen.
 *
 * Completed jobs are never chosen. Being shown "next: the job you finished two
 * hours ago" is worse than being shown nothing.
 */
export function nextJob(jobs: PilotJob[], today: string): PilotJob | undefined {
  const active = jobs.filter(isActive);

  const working = active.find((job) => job.date === today && job.status === "In progress");
  if (working) return working;

  const remainingToday = active
    .filter((job) => job.date === today)
    .sort(byTime);
  if (remainingToday.length > 0) return remainingToday[0];

  return active
    .filter((job) => job.date > today)
    .sort((a, b) => (a.date === b.date ? byTime(a, b) : a.date.localeCompare(b.date)))[0];
}

/**
 * Booking requests still waiting on somebody.
 *
 * The dashboard counted every request the business had ever received, whatever
 * had become of it. A text booking accepted on Monday — turned into a job, with
 * the request marked `scheduled` — still read as "1 booking request" in Needs
 * attention on Friday, in amber, marked urgent, with no way to clear it: the
 * requests page correctly showed a "Scheduled" badge rather than buttons, so
 * there was nothing left to press.
 *
 * An alert that cannot be cleared is an alert people stop reading, which costs
 * the real one that arrives later.
 */
export function openBookingRequests(requests: { status: string }[]): number {
  if (!Array.isArray(requests)) return 0;
  // Two words, because the sources use different ones for the same state. A
  // text booking arrives `new`; a web booking that fell outside the service
  // area arrives `needs_review`. Both are somebody waiting on an answer.
  //
  // `awaiting_payment` is deliberately not here: that is the customer's move,
  // not the business's, and a card being typed in is not a task.
  return requests.filter(
    (request) => request?.status === "new" || request?.status === "needs_review",
  ).length;
}

export type AttentionKey =
  | "booking_requests"
  | "past_visits"
  | "overdue_invoices"
  | "unassigned_today"
  | "draft_invoices"
  | "to_invoice"
  | "awaiting_approval"
  | "quotes_to_price"
  | "buy_list"
  | "out_of_stock";

export type AttentionItem = {
  key: AttentionKey;
  /** What to do, with how many: "Confirm 7 past visits". */
  label: string;
  /** Why it is here, in one line. */
  reason: string;
  /**
   * The list that holds exactly these, so the count and what opens agree.
   * Absent when the only list is the one Today shows under it.
   */
  href?: string;
  /** Marks the ones that cost money or a customer if left. */
  urgent?: boolean;
};

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * What needs somebody, as things to do.
 *
 * The page used to list what had happened — seven "Not started" rows above the
 * overdue invoices — and leave the reader to work out why each was there and
 * what to do about it. Each of these is one task with a count, the reason it
 * is here, and a link to the list of exactly those, most urgent first.
 *
 * And — the part that matters — nothing at all for a task with nothing in it.
 * A card that exists only to say "no low-stock items yet" trains people to
 * skim past the place real warnings appear.
 */
export function attentionItems(input: {
  bookingRequests: number;
  overdueInvoices: number;
  overdueCents?: number;
  unsentInvoices: number;
  unsentCents?: number;
  /** Parts with nothing left on hand. */
  lowStock: number;
  unassignedToday: number;
  /** Visits whose time went by without being started, finished or signed off. */
  pastVisits?: number;
  /** Finished jobs with recorded work and no invoice. */
  toInvoice?: number;
  toInvoiceCents?: number;
  awaitingApproval?: number;
  awaitingApprovalCents?: number;
  quotesToPrice?: number;
  /** Buy-list lines not yet picked up, by status. */
  buyList?: { toBuy: number; ordered: number; ready: number };
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const plural = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;

  if (input.bookingRequests > 0) {
    items.push({
      key: "booking_requests",
      label: `Answer ${plural(input.bookingRequests, "booking request", "booking requests")}`,
      reason: "Customers asked for a visit and are waiting to hear back.",
      href: "/booking-requests",
      urgent: true,
    });
  }
  const pastVisits = input.pastVisits ?? 0;
  if (pastVisits > 0) {
    items.push({
      key: "past_visits",
      label: `Confirm ${plural(pastVisits, "past visit", "past visits")}`,
      reason: "Their time has gone by and the job doesn't say what happened. Start, reschedule or complete each one.",
      href: "/jobs?stage=time_passed",
      urgent: true,
    });
  }
  if (input.overdueInvoices > 0) {
    const owed = (input.overdueCents ?? 0) > 0 ? `: ${money(input.overdueCents ?? 0)} still owed` : "";
    items.push({
      key: "overdue_invoices",
      label: `Review ${plural(input.overdueInvoices, "overdue invoice", "overdue invoices")}`,
      reason: `Sent and past the due date${owed}.`,
      href: "/invoices?status=overdue",
      urgent: true,
    });
  }
  if (input.unassignedToday > 0) {
    items.push({
      key: "unassigned_today",
      label: `Assign ${plural(input.unassignedToday, "job", "jobs")} today`,
      reason: "Booked for today with nobody on it.",
      href: "#visits",
      urgent: true,
    });
  }
  if (input.unsentInvoices > 0) {
    const worth = (input.unsentCents ?? 0) > 0 ? ` (${money(input.unsentCents ?? 0)})` : "";
    items.push({
      key: "draft_invoices",
      label: `Send ${plural(input.unsentInvoices, "draft invoice", "draft invoices")}`,
      reason: `Written but never sent, so nobody has been asked to pay${worth}.`,
      href: "/invoices?status=draft",
    });
  }
  const toInvoice = input.toInvoice ?? 0;
  if (toInvoice > 0) {
    items.push({
      key: "to_invoice",
      label: `Invoice ${plural(toInvoice, "finished job", "finished jobs")}`,
      reason: `${money(input.toInvoiceCents ?? 0)} of finished work has no invoice yet.`,
    });
  }
  const awaiting = input.awaitingApproval ?? 0;
  if (awaiting > 0) {
    // Agreements made before their figures were saved have no total to add.
    const worth = (input.awaitingApprovalCents ?? 0) > 0 ? ` · ${money(input.awaitingApprovalCents ?? 0)}` : "";
    items.push({
      key: "awaiting_approval",
      label: `${plural(awaiting, "estimate", "estimates")} awaiting approval`,
      reason: `Sent to the customer to sign, not signed yet${worth}. Follow up if it has been a while.`,
      href: "/jobs?stage=awaiting_approval",
    });
  }
  const quotes = input.quotesToPrice ?? 0;
  if (quotes > 0) {
    items.push({
      key: "quotes_to_price",
      label: `Price ${plural(quotes, "quote", "quotes")}`,
      reason: "Saved as a quote with no estimate sent yet.",
      href: "/jobs?stage=needs_estimate",
    });
  }
  const buy = input.buyList ?? { toBuy: 0, ordered: 0, ready: 0 };
  const buyTotal = buy.toBuy + buy.ordered + buy.ready;
  if (buyTotal > 0) {
    const parts = [
      buy.ready > 0 ? `${buy.ready} ready for pickup` : "",
      buy.toBuy > 0 ? `${buy.toBuy} to buy` : "",
      buy.ordered > 0 ? `${buy.ordered} ordered` : "",
    ].filter(Boolean);
    items.push({
      key: "buy_list",
      label: `Get ${plural(buyTotal, "item", "items")} on the buy list`,
      reason: `${parts.join(" · ")}.`,
      href: "/materials?tab=buy",
    });
  }
  if (input.lowStock > 0) {
    items.push({
      key: "out_of_stock",
      label: `Restock ${plural(input.lowStock, "part", "parts")}`,
      reason: "None left on hand.",
      href: "/materials?tab=stock",
    });
  }

  return items;
}

/** "Good morning" and so on, from the hour where the business is. */
export function greeting(hour: number): string {
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return "Hello";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * The best real name among everywhere one might be stored, or nothing.
 *
 * There are four places a name can come from and they are not equally
 * trustworthy. `user_profiles.display_name` is NOT NULL, so signing up fills it
 * with whatever is to hand — on this deployment it holds "adamkane13.ak",
 * the local part of an email. The technician record and the identity provider's
 * `full_name` are typed by a person, so they are worth more.
 *
 * Each candidate goes through `firstName`, which refuses anything carrying
 * digits or an @. The first one that survives wins; if none does, the header
 * says "Good afternoon" and nothing else, because a greeting is not worth
 * getting somebody's name wrong for.
 */
export function greetingName(candidates: (string | null | undefined)[], email = ""): string {
  for (const candidate of candidates) {
    const name = firstName(candidate ?? "");
    if (name) return name;
  }
  return firstName("", email);
}

/**
 * A name to greet somebody by.
 *
 * An email address is an identifier, not a name. Being greeted "Good morning,
 * adamkane13.ak@gmail.com" is the sort of thing that makes software feel like
 * software, so the local part is used only as a last resort and nothing is
 * shown rather than an address.
 */
export function firstName(fullName: string, email = ""): string {
  // Split on dots as well as spaces: a display name that was filled in from an
  // email arrives as "adamkane13.ak", one token by any space-based reckoning.
  const named = (fullName ?? "").trim().split(/[\s.]+/)[0] ?? "";

  // Digits are the tell. People are not called Adamkane13, so a name carrying
  // them was derived from an address or a handle, and greeting somebody by it
  // is the same failure as greeting them by the address itself — which is what
  // this function exists to prevent and was letting through.
  // Capitalised on the way out. A real display name already is, and one
  // recovered from an address is not — "Good morning, nick" reads like a bug
  // even though the name is right.
  if (named && !named.includes("@") && !/\d/.test(named)) {
    return named.charAt(0).toUpperCase() + named.slice(1);
  }

  const local = (email ?? "").split("@")[0] ?? "";
  const cleaned = local.replace(/[._-]+/g, " ").trim().split(" ")[0] ?? "";
  if (!cleaned || /\d/.test(cleaned)) return "";

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
