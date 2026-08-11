/**
 * What is wrong with a business, in the order it matters.
 *
 * An electrician who calls support says "it isn't working". The console's job
 * is to turn that into a sentence, and almost every case so far has been one of
 * a small number of things: nobody accepted their invitation, no booking alert
 * address, no messaging service, A2P not approved, legal pages unpublished, or
 * the phone assistant never reaching the server at all.
 *
 * Import-free so the rules can be tested without a database. Ordered by how
 * badly it breaks the business rather than by how easy it is to fix — the point
 * is to answer "what do I tell them first".
 */

export type HealthInput = {
  memberCount: number;
  pendingInvitations: number;
  bookingCount: number;
  /** ISO timestamp of the most recent booking, empty if there has never been one. */
  lastBookingAt: string;
  ownerEmail: string;
  ownerPhone: string;
  messagingServiceSid: string;
  a2pRegistered: boolean;
  legalPublished?: boolean;
  archived: boolean;
};

export type Finding = {
  /** Ordered: 'blocking' stops the business working at all. */
  severity: "blocking" | "degraded" | "note";
  title: string;
  detail: string;
};

const SEVERITY_ORDER: Record<Finding["severity"], number> = {
  blocking: 0,
  degraded: 1,
  note: 2,
};

/** Days since an ISO timestamp, or null when there is no timestamp at all. */
export function daysSince(iso: string, now: Date = new Date()): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000);
}

export function diagnose(input: HealthInput, now: Date = new Date()): Finding[] {
  const findings: Finding[] = [];

  if (input.archived) {
    findings.push({
      severity: "note",
      title: "Archived",
      detail: "This business is archived. Nothing about it is live.",
    });
    return findings;
  }

  if (input.memberCount === 0) {
    findings.push({
      severity: "blocking",
      title: "Nobody can sign in",
      detail:
        input.pendingInvitations > 0
          ? `${input.pendingInvitations} invitation${input.pendingInvitations === 1 ? "" : "s"} sent and not accepted. They cannot open the app until one is.`
          : "This business has no members and no pending invitations. Send one.",
    });
  }

  // The owner's email is the only channel that survives a blocked A2P campaign,
  // so having neither means a booking lands and nobody is told at all.
  if (!input.ownerEmail && !input.ownerPhone) {
    findings.push({
      severity: "blocking",
      title: "Booking alerts go nowhere",
      detail:
        "No booking-alert email or phone is set for this business. A booking taken by the phone assistant will not reach them. Set one at Settings → Booking alerts.",
    });
  } else if (!input.ownerEmail) {
    findings.push({
      severity: "degraded",
      title: "No booking-alert email",
      detail:
        "Only a phone number is set. While a messaging campaign is unapproved, texts do not arrive, so email is the channel that works.",
    });
  }

  if (!input.messagingServiceSid) {
    findings.push({
      severity: "degraded",
      title: "No messaging service",
      detail: "Texting is not configured, so no customer confirmation can be sent.",
    });
  } else if (!input.a2pRegistered) {
    findings.push({
      severity: "note",
      title: "No A2P approval recorded",
      detail:
        "Nothing here records an approved messaging campaign. This is a bookkeeping field somebody fills in by hand, not proof that texts fail — check whether recent messages actually delivered before telling them carriers are refusing (error 30034).",
    });
  }

  if (input.legalPublished === false) {
    findings.push({
      severity: "degraded",
      title: "Legal pages not published",
      detail:
        "A messaging campaign cannot be approved until the privacy policy and text terms open without signing in.",
    });
  }

  if (input.bookingCount === 0) {
    findings.push({
      severity: "note",
      title: "No bookings yet",
      detail: "Nothing has ever been booked for this business.",
    });
  } else {
    const days = daysSince(input.lastBookingAt, now);
    if (days !== null && days >= 30) {
      findings.push({
        severity: "note",
        title: "Quiet for a while",
        detail: `The last booking was ${days} days ago.`,
      });
    }
  }

  return findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** The one-line verdict for a list row. */
export function headline(findings: Finding[]): { label: string; severity: Finding["severity"] | "ok" } {
  const blocking = findings.filter((finding) => finding.severity === "blocking");
  if (blocking.length > 0) {
    return { label: blocking[0]!.title, severity: "blocking" };
  }

  const degraded = findings.filter((finding) => finding.severity === "degraded");
  if (degraded.length > 0) {
    return {
      label:
        degraded.length === 1 ? degraded[0]!.title : `${degraded.length} things need attention`,
      severity: "degraded",
    };
  }

  return { label: "Working", severity: "ok" };
}
