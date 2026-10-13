/**
 * The support activity trail, in sentences.
 *
 * Each audit row is an action name and a bag of detail. The trail used to print
 * the bag as JSON, which answers "who looked, and why" only for whoever can
 * read JSON. This turns a row into one sentence and a few labelled facts.
 *
 * Import-free so it can be used anywhere.
 */

export type ActivityAction = { value: string; label: string };

/** The actions the filter offers, in the order support thinks about them. */
export const ACTIVITY_ACTIONS: readonly ActivityAction[] = [
  { value: "organization.viewed", label: "Opened a business" },
  { value: "search.run", label: "Searched" },
  { value: "record.revealed", label: "Showed private details" },
  { value: "operation.started", label: "Started a recovery tool" },
  { value: "operation.finished", label: "Finished a recovery tool" },
  { value: "impersonation.started", label: "Started making changes" },
  { value: "impersonation.ended", label: "Stopped making changes" },
  { value: "invitation.sent", label: "Sent an invitation" },
  { value: "case.opened", label: "Opened a case" },
  { value: "case.moved", label: "Moved a case" },
];

const CASE_STATE_WORDS: Record<string, string> = {
  open: "open",
  waiting: "waiting on someone",
  verifying: "fix ready to verify",
  closed: "closed",
};

const TOOL_WORDS: Record<string, string> = {
  check_delivery: "checked a text's delivery",
  retry_text: "sent a failed text again",
  fix_recipient: "corrected a customer's number",
  classify_booking: "hid a booking that wasn't a service request",
  merge_duplicates: "hid duplicate bookings",
  restore_booking: "brought a hidden booking back",
};

const ROLE_WORDS: Record<string, string> = {
  owner: "an owner",
  admin: "an administrator",
  dispatcher: "a dispatcher",
  technician: "a technician",
  accountant: "an accountant",
};

function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

/** "Opened Pacific Plains Electric", "Invited sam@example.com as a technician". */
export function activitySentence(action: string, business: string, detail: Record<string, unknown>): string {
  const where = business || "a business";
  switch (action) {
    case "organization.viewed":
      return str(detail.tab) ? `Opened ${where}: ${str(detail.tab)}` : `Opened ${where}`;
    case "invitation.sent": {
      const role = ROLE_WORDS[str(detail.role)] ?? "a member";
      return `Invited ${str(detail.email) || "somebody"} into ${where} as ${role}`;
    }
    case "search.run":
      return `Searched for “${str(detail.query)}”`;
    case "record.revealed":
      return `Showed private details in ${where}${str(detail.scope) ? `: ${str(detail.scope)}` : ""}`;
    case "operation.started": {
      const tool = TOOL_WORDS[str(detail.tool)] ?? str(detail.tool).replace(/_/g, " ");
      return `Started: ${tool} · ${where}`;
    }
    case "operation.finished": {
      const tool = TOOL_WORDS[str(detail.tool)] ?? str(detail.tool).replace(/_/g, " ");
      return `Finished (${str(detail.outcome)}): ${tool} · ${where}`;
    }
    case "case.opened":
      return `Opened case #${str(detail.number)} (${str(detail.severity)}) · ${business || "platform-wide"}`;
    case "case.moved":
      return `Moved case #${str(detail.number)} from ${CASE_STATE_WORDS[str(detail.from)] ?? str(detail.from)} to ${CASE_STATE_WORDS[str(detail.to)] ?? str(detail.to)} · ${business || "platform-wide"}`;
    case "impersonation.started":
      return `Started making changes as ${where}`;
    case "impersonation.ended":
      return `Stopped making changes as ${where}`;
    default: {
      const words = action.replace(/[._]+/g, " ").trim();
      return business ? `${words[0]?.toUpperCase() ?? ""}${words.slice(1)} · ${business}` : words;
    }
  }
}

/**
 * The facts worth showing under the sentence, labelled.
 *
 * What the sentence already says (email, role, tab) is left out, and ids are
 * shortened: they are for matching against a database row, not for reading.
 */
export function activityFacts(action: string, detail: Record<string, unknown>): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  const reason = str(detail.reason);
  if (reason) facts.push({ label: "Reason", value: reason });

  if (action === "impersonation.started" && typeof detail.granted_membership === "boolean") {
    facts.push({
      label: "Access",
      value: detail.granted_membership ? "A temporary membership, removed when it ends" : "Already a member; nothing granted",
    });
  }

  const known = new Set(["reason", "email", "role", "tab", "granted_membership", "query", "scope", "tool", "outcome"]);
  for (const [key, value] of Object.entries(detail)) {
    if (known.has(key)) continue;
    const text = typeof value === "object" && value !== null ? JSON.stringify(value) : str(value) || String(value);
    if (!text || text === "null" || text === "undefined") continue;
    const short = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(text) ? `${text.slice(0, 8)}…` : text;
    facts.push({ label: key.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase()), value: short });
  }
  return facts;
}
