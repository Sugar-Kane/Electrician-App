/**
 * What was actually said before the van was booked.
 *
 * A job that arrived by phone shows one line on the job card — what the
 * customer described — and everything else the receptionist collected sits in
 * the booking request nobody opens. That is the wrong way round: the five
 * intake answers are what tell an electrician whether to bring a ladder, and
 * they were being thrown away at the point of most use.
 *
 * Said plainly, because it decides what this module is allowed to claim: there
 * is no recording and no word-for-word transcript. The receptionist runs on a
 * realtime model that holds the audio itself and sends back structured tool
 * calls, so what exists is what it wrote down — the customer's own words as it
 * heard them, the questions it asked, and the answers it got. This module shows
 * that and calls it that. A panel headed "transcript" over a summary would be a
 * lie an electrician might rely on.
 *
 * Import-free, so the shaping can be tested without a database.
 */

export type CallAnswer = { question: string; answer: string };

export type CallRecord = {
  /** How they got in touch, which decides what the panel calls itself. */
  channel: "phone" | "sms" | "web" | "manual";
  /** When the request came in. */
  takenAt: string;
  /** What the customer said was wrong, in their words. */
  said: string;
  /** The intake questions, with only the ones they answered. */
  answers: CallAnswer[];
  urgency: "routine" | "urgent";
  /** The window agreed at the time, which may not be the window it is on now. */
  window: { start: string; end: string } | null;
  /** The fee quoted, in cents, frozen at the moment they agreed to it. */
  feeCents: number;
  /** Whether the receptionist took it, or somebody in the office typed it in. */
  byReceptionist: boolean;
};

const CHANNELS = new Set(["phone", "sms", "web", "manual"]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The booking request behind a job, as something worth opening.
 *
 * Returns null when there is nothing in it — a job somebody typed in by hand
 * has no call to read, and a disclosure that opens onto an empty box is worse
 * than no disclosure. The test for "worth opening" is deliberately the answers
 * rather than the description: the description is already on the card, so a
 * record that adds nothing to it should not offer to.
 */
export function readCallRecord(row: unknown): CallRecord | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;

  const answers = readAnswers(record.intake_answers);
  const said = text(record.description);
  if (answers.length === 0 && !said) return null;

  const channelRaw = text(record.communication_channel);
  const channel = (CHANNELS.has(channelRaw) ? channelRaw : "manual") as CallRecord["channel"];

  const start = text(record.arrival_window_start);
  const end = text(record.arrival_window_end);

  return {
    channel,
    takenAt: text(record.created_at),
    said,
    answers,
    urgency: text(record.urgency) === "urgent" ? "urgent" : "routine",
    window: start && end ? { start, end } : null,
    feeCents: typeof record.deposit_cents === "number" ? record.deposit_cents : 0,
    // `created_by` is who put it there, which is not the same as which channel
    // it came in on: an owner can type up a phone call they took themselves.
    byReceptionist: text(record.created_by) === "ai",
  };
}

/**
 * The pairs the receptionist actually collected.
 *
 * An unanswered question is dropped rather than shown blank. A list of five
 * questions with three answers reads as three questions never asked, and the
 * one thing this panel is for is telling somebody what is known.
 */
function readAnswers(value: unknown): CallAnswer[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const pair = entry as Record<string, unknown>;
      const question = text(pair.question);
      const answer = text(pair.answer);
      return question && answer ? { question, answer } : null;
    })
    .filter((entry): entry is CallAnswer => entry !== null)
    .slice(0, 12);
}

/** What to call the panel, given how they got in touch. */
export function callRecordTitle(record: CallRecord): string {
  if (record.channel === "phone") {
    return record.byReceptionist ? "What was said on the call" : "What was taken down";
  }
  if (record.channel === "sms") return "What was said over text";
  if (record.channel === "web") return "What they filled in";
  return "What was taken down";
}

/**
 * The one line under the title, saying where this came from and how firm it is.
 *
 * Names the receptionist as the source rather than implying a recording,
 * because that difference matters to somebody deciding how much to trust it.
 */
export function callRecordProvenance(record: CallRecord): string {
  if (record.channel === "phone" && record.byReceptionist) {
    return "Written down by the receptionist during the call. There is no recording.";
  }
  if (record.channel === "sms") return "Taken from the text conversation.";
  if (record.channel === "web") return "Filled in by the customer on the booking page.";
  return "Entered by hand.";
}
