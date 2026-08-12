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

export type AttentionItem = {
  label: string;
  href: string;
  /** Marks the ones that cost money or a customer if left. */
  urgent?: boolean;
};

/**
 * The things that genuinely need somebody, consolidated.
 *
 * One list rather than alerts scattered through the page, and — the part that
 * matters — nothing at all when there is nothing wrong. A card that exists only
 * to say "no low-stock items yet" trains people to skim past the place real
 * warnings appear.
 */
export function attentionItems(input: {
  bookingRequests: number;
  overdueInvoices: number;
  unsentInvoices: number;
  lowStock: number;
  unassignedToday: number;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const plural = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;

  if (input.bookingRequests > 0) {
    items.push({
      label: plural(input.bookingRequests, "booking request", "booking requests"),
      href: "/booking-requests",
      urgent: true,
    });
  }
  if (input.overdueInvoices > 0) {
    items.push({
      label: plural(input.overdueInvoices, "overdue invoice", "overdue invoices"),
      href: "/invoices?status=overdue",
      urgent: true,
    });
  }
  if (input.unassignedToday > 0) {
    items.push({
      label: `${plural(input.unassignedToday, "job", "jobs")} today with nobody assigned`,
      href: "/schedule",
      urgent: true,
    });
  }
  if (input.unsentInvoices > 0) {
    items.push({
      label: `${plural(input.unsentInvoices, "invoice", "invoices")} never sent`,
      href: "/invoices?status=unpaid",
    });
  }
  if (input.lowStock > 0) {
    items.push({
      label: `${plural(input.lowStock, "part", "parts")} running low`,
      href: "/inventory",
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
 * A name to greet somebody by.
 *
 * An email address is an identifier, not a name. Being greeted "Good morning,
 * adamkane13.ak@gmail.com" is the sort of thing that makes software feel like
 * software, so the local part is used only as a last resort and nothing is
 * shown rather than an address.
 */
export function firstName(fullName: string, email = ""): string {
  const named = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (named && !named.includes("@")) return named;

  const local = (email ?? "").split("@")[0] ?? "";
  const cleaned = local.replace(/[._-]+/g, " ").trim().split(" ")[0] ?? "";
  if (!cleaned || /\d/.test(cleaned)) return "";

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
