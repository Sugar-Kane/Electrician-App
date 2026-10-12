/**
 * The phone assistant's log, read as phone calls.
 *
 * Each row is one protocol message. A call is the rows that share a session
 * key (one signed URL per phone call), split where the line went quiet for a
 * long while: a ChatGPT connection keeps one URL for months, and a quiet half
 * hour is a new conversation. Rows from before the key was logged are grouped
 * by time alone, and say so.
 *
 * For every tool call that claims to have saved something, the chain is
 * checked link by link: was a booking saved, was the owner told, was the
 * customer sent a confirmation. A claim with no booking behind it is the
 * failure that matters most — the caller was told one thing and the business
 * has another.
 *
 * Import-free, so it can run anywhere and be reasoned about alone.
 */

export type AssistantRow = {
  id: string;
  createdAt: string;
  method: string;
  toolName: string;
  resultText: string;
  isError: boolean;
  durationMs: number;
  sessionKey: string;
  bookingRequestId: string;
  jobId: string;
  bookingStatus: string;
  bookingArchived: boolean;
  bookingNotifications: { audience: string; channel: string; ok: boolean }[];
  jobNumber: string;
};

export type Said = "booked" | "held" | "review" | "callback" | "transfer" | "refused" | "failed" | "other";

export type LinkState = "ok" | "missing" | "failed" | "waiting" | "unknown";

export type ChainLink = { label: string; state: LinkState; detail: string };

export type AssistantAction = {
  row: AssistantRow;
  said: Said;
  /** What the assistant claimed, in words. */
  claim: string;
  links: ChainLink[];
};

export type AssistantCall = {
  key: string;
  /** "time" when the rows predate session keys and were grouped by time alone. */
  grouped: "session" | "time";
  startedAt: string;
  endedAt: string;
  /** initialize, tools/list and the like: folded away. */
  protocol: AssistantRow[];
  /** Every tool call, in order. */
  steps: AssistantRow[];
  /** The tool calls that book or log something, with their chains. */
  actions: AssistantAction[];
  problems: string[];
  outcome: { text: string; tone: "good" | "problem" | "waiting" | "neutral" };
};

/** Tools that save something for a person to act on. */
const ACTIONS = new Set(["book_visit", "request_callback"]);

/** A quiet gap this long starts a new call, even on the same URL. */
const SAME_CALL_GAP_MS = 30 * 60 * 1000;
/** For rows with no key, a shorter gap: nothing else ties them together. */
const LEGACY_GAP_MS = 10 * 60 * 1000;
/** Alerts go out just after the tool answers; give them this long before calling them missing. */
const ALERT_GRACE_MS = 5 * 60 * 1000;

const CLAIMS: Record<Said, string> = {
  booked: "said it booked a visit",
  held: "said it held a time until the fee is paid",
  review: "said it saved the request for an electrician to review",
  callback: "said it logged a callback",
  transfer: "said it started a live transfer",
  refused: "didn't book: it was told to ask the caller something first",
  failed: "a tool failed outright; the caller was told someone would call back",
  other: "answered without saying what it saved",
};

/** What the assistant was told it had done, from the words the tool gave it. */
export function saidFrom(row: Pick<AssistantRow, "resultText" | "isError">): Said {
  const text = row.resultText.trim();
  if (text.startsWith("NOT BOOKED")) return "refused";
  if (text.startsWith("Booked:")) return "booked";
  if (text.startsWith("Held, not yet confirmed")) return "held";
  if (text.startsWith("No appointment was booked automatically")) return "review";
  if (text.startsWith("Live transfer started")) return "transfer";
  if (text.startsWith("Callback logged") || text.startsWith("The live transfer was unavailable")) return "callback";
  if (row.isError || text.startsWith("That did not go through")) return "failed";
  return "other";
}

const SAVES: ReadonlySet<Said> = new Set(["booked", "held", "review", "callback", "transfer"]);

function told(row: AssistantRow, audience: string, now: number, grouped: AssistantCall["grouped"]): ChainLink {
  const label = audience === "owner" ? "Owner told" : "Customer sent a confirmation";
  if (!row.bookingRequestId) return { label, state: grouped === "time" ? "unknown" : "missing", detail: "No booking to tell anyone about." };
  const attempts = row.bookingNotifications.filter((attempt) => attempt.audience === audience);
  const delivered = attempts.filter((attempt) => attempt.ok);
  if (delivered.length > 0) return { label, state: "ok", detail: `Sent by ${[...new Set(delivered.map((attempt) => attempt.channel))].join(" and ")}.` };
  if (attempts.length > 0) return { label, state: "failed", detail: `Tried by ${[...new Set(attempts.map((attempt) => attempt.channel))].join(" and ")}; it didn't go.` };
  if (now - Date.parse(row.createdAt) < ALERT_GRACE_MS) return { label, state: "waiting", detail: "Just now; it may still be sending." };
  return { label, state: "missing", detail: "Nothing recorded." };
}

function chain(row: AssistantRow, said: Said, now: number, grouped: AssistantCall["grouped"]): ChainLink[] {
  if (!SAVES.has(said)) return [];
  const saved: ChainLink = row.bookingRequestId
    ? {
        label: "Booking saved",
        state: "ok",
        detail: [
          row.bookingStatus ? `Now ${row.bookingStatus.replace(/_/g, " ")}` : "",
          row.bookingArchived ? "hidden by the business" : "",
          row.jobNumber ? `became job #${row.jobNumber}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      }
    : grouped === "time"
      ? { label: "Booking saved", state: "unknown", detail: "This call was logged before bookings were linked to it." }
      : { label: "Booking saved", state: "missing", detail: "No booking is linked to this call." };

  const links = [saved, told(row, "owner", now, grouped)];
  // A booking tells the customer too; a callback is the owner's to return.
  if (said === "booked" || said === "held") links.push(told(row, "customer", now, grouped));
  return links;
}

function split(rows: AssistantRow[], gap: number): AssistantRow[][] {
  const groups: AssistantRow[][] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && Date.parse(row.createdAt) - Date.parse(last[last.length - 1].createdAt) <= gap) last.push(row);
    else groups.push([row]);
  }
  return groups;
}

function describe(rows: AssistantRow[], grouped: AssistantCall["grouped"], now: number): AssistantCall {
  const protocol = rows.filter((row) => row.method !== "tools/call");
  const steps = rows.filter((row) => row.method === "tools/call");
  const actions: AssistantAction[] = steps
    .filter((row) => ACTIONS.has(row.toolName))
    .map((row) => {
      const said = saidFrom(row);
      return { row, said, claim: CLAIMS[said], links: chain(row, said, now, grouped) };
    });

  const problems: string[] = [];
  for (const action of actions) {
    if (action.said === "failed") problems.push(`${action.row.toolName} failed outright, and the caller was told someone would call back.`);
    const [saved, ...told] = action.links;
    if (saved?.state === "missing") {
      // Nobody could be told about a booking that isn't there; that is one problem, not three.
      problems.push(`The assistant ${action.claim}, but no booking was saved.`);
      continue;
    }
    for (const link of told) {
      if (link.state === "missing" || link.state === "failed")
        problems.push(`${link.label}: ${link.state === "failed" ? "it didn't go" : "nothing recorded"} (${action.row.toolName}).`);
    }
  }
  const toolErrors = steps.filter((row) => !ACTIONS.has(row.toolName) && row.isError);
  if (toolErrors.length > 0) problems.push(`${toolErrors.length} other tool call${toolErrors.length === 1 ? "" : "s"} came back with an error.`);

  const saved = actions.filter((action) => SAVES.has(action.said));
  const waiting = actions.some((action) => action.links.some((link) => link.state === "waiting"));
  const outcome: AssistantCall["outcome"] =
    problems.length > 0
      ? { text: problems.length === 1 ? "1 problem" : `${problems.length} problems`, tone: "problem" }
      : waiting
        ? { text: "Still sending", tone: "waiting" }
        : saved.length > 0
          ? { text: saved.map((action) => action.claim.replace(/^said it /, "")).join("; "), tone: "good" }
          : steps.length > 0
            ? { text: "Nothing saved", tone: "neutral" }
            : { text: "Connected, no tools used", tone: "neutral" };

  return {
    key: `${grouped}:${rows[0].sessionKey || "none"}:${rows[0].id}`,
    grouped,
    startedAt: rows[0].createdAt,
    endedAt: rows[rows.length - 1].createdAt,
    protocol,
    steps,
    actions,
    problems,
    outcome,
  };
}

/** Rows, in any order, as calls, newest first. */
export function assistantCalls(rows: AssistantRow[], now: Date = new Date()): AssistantCall[] {
  const at = (row: AssistantRow) => Date.parse(row.createdAt);
  const ordered = rows.filter((row) => Number.isFinite(at(row))).sort((a, b) => at(a) - at(b));

  const bySession = new Map<string, AssistantRow[]>();
  const legacy: AssistantRow[] = [];
  for (const row of ordered) {
    if (row.sessionKey) bySession.set(row.sessionKey, [...(bySession.get(row.sessionKey) ?? []), row]);
    else legacy.push(row);
  }

  const calls = [
    ...[...bySession.values()].flatMap((group) => split(group, SAME_CALL_GAP_MS).map((rows) => describe(rows, "session", now.getTime()))),
    ...split(legacy, LEGACY_GAP_MS).map((rows) => describe(rows, "time", now.getTime())),
  ];
  return calls.sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt));
}
