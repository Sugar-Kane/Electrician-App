/**
 * Volteira's release notes: what changed, in which version, on which day.
 *
 * One list, newest first, kept in the repository so every entry is reviewed
 * and merged with the code it describes, and what the page says is always
 * what is deployed. It feeds the public "What's new" page (/changelog), the
 * version shown in the account menu, and the ChatGPT tool
 * `list_feature_updates`, so all three say the same thing.
 *
 * To post an update: add a release at the top (or add to the newest one
 * before it ships), bump `version` in package.json to match, and merge.
 * Signed-in people see a one-time pop-up for the newest release
 * (whats-new-gate.tsx): its first three new or improved changes, each with
 * its `brief`, and a count of fixes. Put the most important changes first.
 * Versions are major.minor.patch: minor for new features, patch for fixes.
 *
 * Import-free, so the page, the menu and the ChatGPT tool can all read it.
 */

export type ChangeKind = "new" | "improved" | "fixed";

export type Change = {
  kind: ChangeKind;
  title: string;
  /** One short line for the sign-in pop-up. Without it, the pop-up shows the title alone. */
  brief?: string;
  detail: string;
};

export type Release = {
  version: string;
  /** YYYY-MM-DD, or null for the starting point whose day is not recorded. */
  date: string | null;
  title: string;
  summary: string;
  changes: Change[];
};

export const RELEASES: Release[] = [
  {
    version: "1.2.0",
    date: "2026-11-15",
    title: "Supervised AI automation",
    summary:
      "AI can now suggest work and carry out what you approve: customer texts, notes and follow-ups, each checked and recorded. Nothing reaches a customer or touches money until a person approves the exact wording.",
    changes: [
      {
        kind: "new",
        title: "AI approval inbox",
        brief: "Review and approve what the AI suggests, word for word.",
        detail:
          "AI operations shows every AI proposal with its exact wording, recipient, amount and history. Approve or reject it there; done, failed and rejected items have their own tabs.",
      },
      {
        kind: "new",
        title: "Decide from ChatGPT",
        brief: "Approve or reject proposals right in ChatGPT.",
        detail:
          "ChatGPT can propose actions and list, review, approve or reject proposals (propose_action, list_proposals, get_proposal, approve_proposal, reject_proposal). Contracts, estimates, purchases, refunds, price changes and cancellations are approved in Volteira only.",
      },
      {
        kind: "new",
        title: "Automatic follow-ups",
        brief: "Leads, signed contracts and unbilled jobs get follow-ups on their own.",
        detail:
          "New website requests, signed contracts and finished jobs with no invoice add a follow-up to the job or customer. Overdue invoices and low stock put a proposal in the inbox.",
      },
      {
        kind: "new",
        title: "Approved customer texts go out on their own",
        brief: "Texts you approve are sent and tracked automatically.",
        detail:
          "Once approved, a text is sent within seconds, checked first for the customer's texting consent, an unchanged number and quiet hours. Delivery shows in Messages.",
      },
      {
        kind: "improved",
        title: "Invoice reminders stay accurate",
        detail:
          "An approved overdue-invoice reminder is checked against the invoice right before sending. If it has been paid, voided or changed, nothing is sent.",
      },
      {
        kind: "improved",
        title: "Clearer approval confirmations",
        detail: "Approving opens a Volteira dialog showing exactly who it goes to and what it says, instead of the browser's grey pop-up.",
      },
      {
        kind: "new",
        title: "What's new",
        detail: "This page, and a ChatGPT tool (list_feature_updates) so your assistant can tell you what changed.",
      },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-11-14",
    title: "Payments, refunds and delivery tracking",
    summary: "Online diagnostic payments now land where you expect them, refunds are tracked end to end, and you can see whether contract and refund texts were delivered.",
    changes: [
      {
        kind: "fixed",
        title: "Paid bookings become confirmed jobs",
        brief: "Online diagnostic payments land on the schedule.",
        detail: "A customer who pays the diagnostic fee online now gets a confirmed job on the schedule, a confirmation and a receipt.",
      },
      {
        kind: "improved",
        title: "Online payments count in Paid today",
        detail: "Diagnostic fees paid online show in Paid today and the pay tracker alongside invoice payments.",
      },
      {
        kind: "new",
        title: "Refund diagnostic fees",
        brief: "Refund from the job page; see refunds on Invoices.",
        detail: "Refund a diagnostic fee from the job page. Refunds appear in the pay tracker, and Invoices has a Refunded tab.",
      },
      {
        kind: "fixed",
        title: "Service addresses on jobs",
        detail: "Jobs show the customer's service address again.",
      },
      {
        kind: "new",
        title: "Delivery status for contract and refund texts",
        brief: "See whether contract and refund texts arrived.",
        detail: "Contract signing links, signed-contract thank-yous and refund notices are saved in Messages with delivered, undelivered or failed.",
      },
      {
        kind: "improved",
        title: "Materials completes with the work",
        detail: "Once a visit has started or the job is finished, the Materials step shows as done.",
      },
      {
        kind: "new",
        title: "AI operations (preview)",
        detail: "A read-only overview of what needs attention and what connected assistants have done.",
      },
    ],
  },
  {
    version: "1.0.0",
    date: null,
    title: "Volteira",
    summary: "The starting point for version tracking: everything Pacific Plains Electric was already using before November 14, 2026.",
    changes: [
      {
        kind: "new",
        title: "Run the business in one place",
        detail:
          "Jobs and scheduling, estimates, contracts with e-signature, invoices with online payment, customer texting, materials lists and supplier carts, website booking, and the ChatGPT connection.",
      },
    ],
  },
];

export const CURRENT_VERSION = RELEASES[0]!.version;

/** -1, 0 or 1, comparing major.minor.patch numerically. Unreadable parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string) => value.replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

/** Releases newer than `version` (all of them when it is empty), newest first. */
export function releasesSince(version: string | null | undefined): Release[] {
  if (!version) return RELEASES;
  return RELEASES.filter((release) => compareVersions(release.version, version) > 0);
}

/** "v1.2.0" → "v1-2-0", for links to one release on the page. */
export function releaseAnchor(version: string): string {
  return `v${version.replace(/^v/i, "").replace(/\./g, "-")}`;
}

/** "Nov 15, 2026", or the fallback for the undated starting point. */
export function releaseDateLabel(date: string | null): string {
  if (!date) return "Before Nov 14, 2026";
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
