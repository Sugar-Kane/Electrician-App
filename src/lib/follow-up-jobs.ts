/**
 * A work order booked from the diagnostic that found the work.
 *
 * A diagnostic is two hours to find the fault, and the fee the customer paid
 * for it is credited against the repair. When the repair is another visit, it
 * is booked as its own job — a work order that follows the diagnostic up — and
 * these are the rules for doing that: what the new job starts out knowing, and
 * whose fee its invoices take off.
 *
 * Nothing here touches the database, so every rule can be tested on its own.
 */

import { keepPhoneDigits, keepZipDigits } from "./digits-input.ts";
import type { NewJobRaw } from "./new-job-input.ts";

/** The diagnostic, as the New job form needs it. */
export type FollowUpSource = {
  customerName: string;
  /** As stored: "+18055550147" or "(805) 555-0147". */
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  accessNotes: string;
  /** What the electrician wrote on the diagnostic — what they found. */
  technicianNotes: string;
  /** What the customer said when they booked it. */
  customerDescription: string;
};

/**
 * The New job form, filled in from the diagnostic.
 *
 * The same customer at the same address, as a work order, so the form is only
 * the parts nobody knows yet: when, how long, and what it comes to. The work is
 * what the electrician found, when they wrote it down — it is what the visit is
 * for — and what the customer asked for when they did not.
 *
 * Every field is still editable. The values are only where the form starts.
 */
export function followUpPrefill(source: FollowUpSource): NewJobRaw {
  return {
    customerName: source.customerName.trim(),
    // Ten digits, the way the phone box keeps them: the stored "+1" form would
    // otherwise be cut to the first ten characters and dial somebody else.
    phone: keepPhoneDigits(source.phone),
    email: source.email.trim(),
    addressLine1: source.addressLine1.trim(),
    addressLine2: source.addressLine2.trim(),
    city: source.city.trim(),
    state: source.state.trim().toUpperCase(),
    postalCode: keepZipDigits(source.postalCode),
    accessNotes: source.accessNotes,
    category: "work_order",
    description: source.technicianNotes.trim() || source.customerDescription.trim(),
    startLocal: "",
    durationHours: "",
    cost: "",
    mode: "save",
    workOrderLines: "",
  };
}

/** A paid-for diagnostic, or a job's lack of one. */
export type DiagnosticFee = { diagnosticPaid: boolean; diagnosticFeeCents: number };

const NO_FEE: DiagnosticFee = { diagnosticPaid: false, diagnosticFeeCents: 0 };

/**
 * Whose diagnostic a job's invoices take off.
 *
 * A job's own. A follow-up has none of its own to give — the fee was paid for
 * the visit it follows — so it takes the one it follows. If that cannot be
 * read, there is nothing to take off: crediting a fee nobody can see was paid
 * would be giving money away.
 */
export function creditSource(
  job: DiagnosticFee & { followUpOf: string | null },
  followed: DiagnosticFee | null,
): DiagnosticFee {
  if (!job.followUpOf) {
    return { diagnosticPaid: job.diagnosticPaid, diagnosticFeeCents: job.diagnosticFeeCents };
  }
  return followed
    ? { diagnosticPaid: followed.diagnosticPaid, diagnosticFeeCents: followed.diagnosticFeeCents }
    : NO_FEE;
}

/**
 * How much of a diagnostic has already been taken off.
 *
 * Across every invoice it could have gone on — the diagnostic's and each of its
 * follow-ups' — so the fee comes off once whichever job is billed first. A void
 * invoice gave nothing: it was never owed, so the credit on it is still there
 * to give.
 */
export function creditGivenCents(
  invoices: { status: string; diagnosticCreditCents: number }[],
): number {
  return invoices.reduce((sum, invoice) => {
    if (invoice.status === "void") return sum;
    const cents = Math.round(Number(invoice.diagnosticCreditCents));
    return Number.isFinite(cents) && cents > 0 ? sum + cents : sum;
  }, 0);
}
