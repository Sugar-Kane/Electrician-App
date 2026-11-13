/**
 * What a customer has already said to the business on the other channel, for
 * whichever assistant they reach next.
 *
 * Somebody who texted and then rings should not be asked the same questions
 * over again by Maya, and somebody who called and then texts should not be
 * asked them again by the texting assistant. Each assistant gets a short,
 * dated note of the other channel: the recent texts word for word, and the
 * calls by what came of them (a visit booked, a call back asked for).
 *
 * Import-free, so what is shared, how far back and how much, is tested here.
 */

/** Only the recent past: an old thread is a different job. */
export const EARLIER_CONTACT_DAYS = 30;
/** Enough to pick a conversation back up; the newest are the ones kept. */
export const EARLIER_TEXTS = 12;
export const EARLIER_CALLS = 3;
const TEXT_CHARS = 300;

export type EarlierText = { direction: "inbound" | "outbound"; body: string; at: string };

export type EarlierCall = {
  at: string;
  /** "visit" or "callback", as the booking request records it. */
  intent: string;
  status: string;
  description: string;
  windowStart: string | null;
  windowEnd: string | null;
  address: string;
};

function recent(at: string, now: Date): boolean {
  const time = Date.parse(at);
  return Number.isFinite(time) && time <= now.getTime() && time >= now.getTime() - EARLIER_CONTACT_DAYS * 86_400_000;
}

function when(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** The recent texts, oldest first, newest kept. */
export function earlierTexts(rows: EarlierText[], now: Date): EarlierText[] {
  return rows
    .filter((row) => row.body.trim() && recent(row.at, now))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-EARLIER_TEXTS);
}

/** The recent calls that left a request behind, oldest first, newest kept. */
export function earlierCalls(rows: EarlierCall[], now: Date): EarlierCall[] {
  return rows
    .filter((row) => recent(row.at, now))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-EARLIER_CALLS);
}

function callLine(call: EarlierCall, timeZone: string): string {
  const about = call.description ? `about: ${oneLine(call.description, TEXT_CHARS)}` : "about electrical work";
  const outcome =
    call.status === "cancelled" || call.status === "canceled"
      ? "The request was later cancelled."
      : call.intent === "visit" && call.windowStart
        ? `A visit was booked for ${when(call.windowStart, timeZone)}${call.address ? ` at ${call.address}` : ""}.`
        : "They asked for someone to call them back.";
  return `- ${when(call.at, timeZone)}: they called ${about}. ${outcome}`;
}

/**
 * The note for the phone assistant: the texts and the earlier calls. Empty
 * when there is nothing recent, so a first-time caller is greeted as one.
 */
export function earlierContactForCall(input: { texts: EarlierText[]; calls: EarlierCall[]; timeZone: string; now: Date }): string {
  const texts = earlierTexts(input.texts, input.now);
  const calls = earlierCalls(input.calls, input.now);
  if (texts.length === 0 && calls.length === 0) return "";
  return [
    "This caller has been in touch with the business recently. Pick up from there rather than starting over: don't ask again for anything already answered below, confirm it instead, and carry on from where it was left. Don't read any of this back word for word, and never mention that you looked it up.",
    ...(texts.length
      ? [
          "Their recent texts with the business, oldest first:",
          ...texts.map((text) => `- ${when(text.at, input.timeZone)}, ${text.direction === "inbound" ? "customer" : "business"}: ${oneLine(text.body, TEXT_CHARS)}`),
        ]
      : []),
    ...(calls.length ? ["Their recent calls:", ...calls.map((call) => callLine(call, input.timeZone))] : []),
  ].join("\n");
}

/**
 * The note for the texting assistant: the earlier calls (the texts are
 * already its own conversation). Empty when there were none.
 */
export function earlierCallsForText(input: { calls: EarlierCall[]; timeZone: string; now: Date }): string {
  const calls = earlierCalls(input.calls, input.now);
  if (calls.length === 0) return "";
  return [
    "[Before this text, the customer phoned the business. Carry on from there: don't ask again for anything they already gave on the call.]",
    ...calls.map((call) => callLine(call, input.timeZone)),
  ].join("\n");
}

/** Who the customer is, from their record, for the phone assistant. */
export type CustomerProfile = {
  firstName: string;
  lastName: string;
  email: string;
  address: string;
};

export type ProfileJob = {
  jobNumber: string;
  status: string;
  kind: string;
  description: string;
  start: string | null;
  end: string | null;
};

/** The customer's latest booking, and whether its link reached them. */
export type LinkDelivery = {
  windowStart: string | null;
  status: string;
  attempts: { channel: string; ok: boolean; at: string; audience: string; detail: string }[];
};

/** How many jobs are worth telling Maya about: the next ones and the latest done. */
export const PROFILE_JOBS = 4;

function deliveryLine(delivery: LinkDelivery, timeZone: string): string {
  const mine = delivery.attempts.filter((attempt) => attempt.audience === "customer");
  if (mine.length === 0) return "- Their booking link: no record of it being sent.";
  const latest = [...mine].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-3);
  const said = latest.map((attempt) => {
    const how = attempt.channel === "sms" ? "text" : "email";
    const at = Number.isFinite(Date.parse(attempt.at)) ? ` ${when(attempt.at, timeZone)}` : "";
    return attempt.ok ? `sent by ${how}${at}` : `${how} failed${at} (${oneLine(attempt.detail, 80)})`;
  });
  const anyOk = latest.some((attempt) => attempt.ok);
  return `- Their booking link: ${said.join("; ")}.${anyOk ? "" : " It never reached them: offer to resend it with resend_booking_link."}`;
}

/**
 * The note on a returning customer: their name and address on file, their
 * upcoming and recent jobs, and whether their last booking link reached them.
 * Empty when there is nothing on record, so a stranger is greeted as one.
 */
export function customerProfileForCall(input: {
  profile: CustomerProfile | null;
  jobs: ProfileJob[];
  delivery: LinkDelivery | null;
  timeZone: string;
  now: Date;
}): string {
  const { profile } = input;
  const name = profile ? [profile.firstName, profile.lastName].filter(Boolean).join(" ") : "";
  const open = new Set(["canceled", "cancelled", "completed", "no_show"]);
  const upcoming = input.jobs
    .filter((job) => !open.has(job.status) && job.start && Date.parse(job.start) >= input.now.getTime() - 12 * 3_600_000)
    .sort((a, b) => Date.parse(a.start ?? "") - Date.parse(b.start ?? ""));
  const past = input.jobs.filter((job) => !upcoming.includes(job));
  const shown = [...upcoming, ...past].slice(0, PROFILE_JOBS);
  const lines = [
    ...(name ? [`- Name on file: ${name}. Greet them by first name.`] : []),
    ...(profile?.address ? [`- Address on file: ${profile.address}. Confirm it rather than asking again.`] : []),
    ...(profile?.email ? [`- Email on file: ${profile.email}.`] : []),
    ...shown.map((job) => {
      const window = job.start ? ` for ${when(job.start, input.timeZone)}` : "";
      const what = job.kind || "electrical work";
      const about = job.description ? ` (${oneLine(job.description, 120)})` : "";
      return `- Job #${job.jobNumber}: ${what}${about}, ${job.status.replace(/_/g, " ")}${window}.`;
    }),
    ...(input.delivery ? [deliveryLine(input.delivery, input.timeZone)] : []),
  ];
  if (lines.length === 0) return "";
  return [
    "This is a returning customer. What is on their record:",
    ...lines,
    upcoming.length
      ? "They have a visit coming up: if they don't say why they called, ask whether it's about that visit. Help with that visit rather than booking a second one."
      : "Greet them as someone the business knows, and ask how you can help today.",
  ].join("\n");
}
