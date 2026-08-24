/**
 * Whether an accepted time becomes a booking or a hold.
 *
 * The web booking page has always done this correctly: it reserves the slot,
 * takes the diagnostic fee, and only then writes a job. A booking taken by text
 * or over the phone skipped straight to a confirmed job with no payment at all
 * — the same appointment, the same fee quoted, and nothing collected.
 *
 * The rule is one decision with three ways of coming out, and it lives here
 * rather than inside the intake because the wrong answer is expensive in both
 * directions: hold a booking the business cannot collect on and the appointment
 * evaporates; skip the hold and the electrician drives out unpaid.
 *
 * Import-free, so the decision can be tested without a database, a model or a
 * payment provider.
 */

export type HoldDecision =
  /** Write the job now, the way it has always worked. */
  | { kind: "schedule"; because: string }
  /** Reserve the slot and ask for the fee first. */
  | { kind: "hold"; feeCents: number; holdMinutes: number };

/** Long enough to find a card, short enough not to lose the slot for a day. */
export const HOLD_MINUTES = 30;

export function decideHold(input: {
  /** Only a booked visit can be held. A callback owes nothing. */
  intent: "book" | "callback";
  /** What the customer was quoted, frozen at the moment they agreed. */
  depositCents: number | null | undefined;
  /** Whether this deployment can actually produce a payment link. */
  paymentsAvailable: boolean;
}): HoldDecision {
  if (input.intent !== "book") {
    return { kind: "schedule", because: "a callback owes nothing" };
  }

  const fee = input.depositCents ?? 0;
  if (!Number.isFinite(fee) || fee <= 0) {
    return { kind: "schedule", because: "no diagnostic fee is charged" };
  }

  /*
   * The fallback, and the reason this cannot make things worse than they are.
   *
   * With no payment provider configured there is no link to send, and a hold
   * nobody can pay is an appointment that quietly never happens. Booking it the
   * way it books today is the current behaviour exactly — so the worst outcome
   * of this whole change is the behaviour it replaced.
   */
  if (!input.paymentsAvailable) {
    return { kind: "schedule", because: "payments are not configured" };
  }

  return { kind: "hold", feeCents: fee, holdMinutes: HOLD_MINUTES };
}

/** The page that turns a booking token into a checkout. Empty without an origin. */
export function payLinkFor(origin: string, token: string): string {
  const base = origin.trim().replace(/\/+$/, "");
  if (!base || !token) return "";
  if (!/^https?:\/\//i.test(base)) return "";

  return `${base}/booking/${encodeURIComponent(token)}/pay`;
}

/** "$180" from 18000. Whole dollars, the way a fee is said out loud. */
export function feeLabel(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/**
 * What gets added to the assistant's reply when a time is being held.
 *
 * Written here, not by the model. The amount and the link are the two things in
 * the whole conversation that must be exactly right, and a sentence generated
 * per message is a sentence that can quote the wrong number once in a hundred
 * — which, for money, is once too often.
 */
export function holdSentence(input: {
  feeCents: number;
  payUrl: string;
  holdMinutes: number;
}): string {
  if (!input.payUrl || input.feeCents <= 0) return "";

  return (
    `To confirm this time, pay the ${feeLabel(input.feeCents)} diagnostic fee here: ${input.payUrl} — ` +
    `we are holding it for ${input.holdMinutes} minutes.`
  );
}

/**
 * The whole text a held booking gets, rather than a sentence bolted onto one.
 *
 * The reply the intake composes says "booked for Thursday 8–10am". Once the
 * time is only held, that sentence is false, and appending "pay to confirm"
 * after it produces a message that contradicts itself in two lines. So a held
 * booking gets its own words.
 */
export function heldReply(input: {
  businessName: string;
  slotLabel: string;
  feeCents: number;
  payUrl: string;
  holdMinutes: number;
  businessPhone: string;
}): string {
  const ask = holdSentence(input);
  if (!ask) return "";

  return `${input.businessName}: holding ${input.slotLabel} for you. ${ask} Questions? ${input.businessPhone}`;
}

/**
 * The same thing said out loud, where a link is useless.
 *
 * A URL read down a phone line is not a link, it is a spelling test. The caller
 * is told what is about to arrive and why, and the link goes by text.
 */
export function holdSpoken(input: { feeCents: number }): string {
  if (input.feeCents <= 0) return "";

  return (
    `I will text you a link to pay the ${feeLabel(input.feeCents)} diagnostic fee, ` +
    `and paying it confirms the appointment.`
  );
}
