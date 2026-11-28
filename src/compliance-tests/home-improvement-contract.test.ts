/**
 * California home improvement contracts: the notice text is the statute's own,
 * word for word, and the right to cancel is computed and honored.
 * compliance/tests/manifest.json maps these IDs to the requirements.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CONTRACT_PRICE_HEADING,
  COMPLETED_COPY_STATEMENT,
  CSLB_INFORMATION,
  DOWNPAYMENT_HEADING,
  DOWNPAYMENT_STATEMENT,
  EXTRA_WORK_HEADING,
  EXTRA_WORK_STATEMENT,
  HOME_IMPROVEMENT_HEADING,
  MECHANICS_LIEN_WARNING,
  NOTICE_OF_CANCELLATION_CAPTION,
  NOTICE_OF_CANCELLATION_INSTRUCTION,
  NOTICE_OF_CANCELLATION_SIGN_LINE,
  NOTICE_OF_CANCELLATION_STATEMENT,
  PROGRESS_PAYMENTS_HEADING,
  PROGRESS_PAYMENTS_STATEMENT,
  PROJECT_DESCRIPTION_HEADING,
  THREE_DAY_NOTICE,
  THREE_DAY_TITLE,
  cancellationDeadline,
  cancellationStatement,
  contractNotices,
  customerMayCancel,
  defaultContractType,
  homeImprovementRefusal,
  refundDueBy,
  seniorVersion,
  withinCancellationPeriod,
} from "../lib/ca-home-improvement.ts";
import { DOWN_PAYMENT_NOTICE } from "../lib/payment-plan.ts";

const legal = JSON.parse(readFileSync(new URL("../../compliance/legal-text/ca-home-improvement-2026.json", import.meta.url), "utf8")) as {
  items: { id: string; text: string | null }[];
};
const squash = (text: string) => text.replace(/[\s­]+/g, "").replace(/-/g, "");
const source = (id: string) => {
  const item = legal.items.find((entry) => entry.id === id);
  assert.ok(item?.text, id);
  return squash(item.text);
};

function assertVerbatim(id: string, passages: readonly string[]) {
  const text = source(id);
  for (const passage of passages) assert.ok(text.includes(squash(passage)), `${id}: ${passage.slice(0, 60)}…`);
}

test("CT-HIC-001: every notice passage is the statute's own text, word for word", () => {
  assertVerbatim("bp-7159-e-4-mechanics-lien-warning", MECHANICS_LIEN_WARNING);
  assertVerbatim("bp-7159-e-5-cslb-information", CSLB_INFORMATION);
  assertVerbatim("bp-7159-e-6-three-day-right-to-cancel", [THREE_DAY_TITLE, ...THREE_DAY_NOTICE]);
  assertVerbatim("bp-7159-e-6-c-vi-notice-of-cancellation", [
    NOTICE_OF_CANCELLATION_CAPTION,
    ...NOTICE_OF_CANCELLATION_STATEMENT,
    NOTICE_OF_CANCELLATION_INSTRUCTION,
    NOTICE_OF_CANCELLATION_SIGN_LINE,
  ]);
  assertVerbatim("bp-7159-d-contract-contents", [
    HOME_IMPROVEMENT_HEADING,
    COMPLETED_COPY_STATEMENT,
    CONTRACT_PRICE_HEADING,
    PROJECT_DESCRIPTION_HEADING,
    DOWNPAYMENT_HEADING,
    DOWNPAYMENT_STATEMENT,
    PROGRESS_PAYMENTS_HEADING,
    PROGRESS_PAYMENTS_STATEMENT,
    EXTRA_WORK_HEADING,
    EXTRA_WORK_STATEMENT,
  ]);
  // The payment plan's own copy of the downpayment statement is the statute's too.
  assert.equal(DOWN_PAYMENT_NOTICE, DOWNPAYMENT_STATEMENT);
});

test("CT-HIC-002: a senior buyer gets the five-day notice and five-day forms, everyone else three", () => {
  assert.equal(seniorVersion(THREE_DAY_TITLE), "Five-Day Right to Cancel");
  assert.match(seniorVersion(THREE_DAY_NOTICE[0]!), /within five business days/);
  assert.match(seniorVersion(THREE_DAY_NOTICE[0]!), /midnight of the fifth business day/);
  assert.doesNotMatch(seniorVersion(THREE_DAY_NOTICE.join(" ")), /\bthree\b|\bthird\b/);
  assert.match(cancellationStatement("five")[0]!, /within five business days/);
  assert.match(cancellationStatement("three")[0]!, /within three business days/);
  // Only "three" changes in the form; the 10 and 20 days stay.
  assert.match(cancellationStatement("five").join(" "), /within 10 days/);
});

const base = {
  contractType: "home_improvement" as const,
  seniorBuyer: false,
  negotiatedAtBusiness: false,
  contractPriceCents: 1_200_000,
  downpaymentCents: 100_000,
  progressPayments: [{ cents: 500_000, phase: "Rough-in wiring for the addition, including wire and boxes" }],
  sellerName: "Fixture Electric",
  sellerAddress: "1 Main St, Fresno, CA 93721",
};

test("CT-HIC-003: a home improvement contract carries every notice, in its place and type size", () => {
  const notices = contractNotices(base)!;
  const ids = notices.sections.map((section) => section.id);
  assert.deepEqual(ids, ["home_improvement", "contract_price", "downpayment", "progress_payments", "extra_work", "mechanics_lien_warning", "cslb_information", "right_to_cancel"]);
  const section = (id: string) => notices.sections.find((entry) => entry.id === id)!;
  assert.equal(section("home_improvement").placement, "top");
  assert.equal(section("right_to_cancel").placement, "cancel");
  assert.ok(section("right_to_cancel").paragraphs.every((paragraph) => paragraph.style === "large_bold"), "12-point bold");
  assert.ok(section("cslb_information").paragraphs.every((paragraph) => paragraph.style !== "body"), "at least 12-point");
  assert.equal(section("downpayment").paragraphs.at(-1)?.style, "large_bold");
  assert.equal(section("progress_payments").paragraphs.at(-1)?.style, "large_bold");
  assert.match(section("progress_payments").paragraphs[1]!.text, /\$5,000\.00: Rough-in wiring/);
  assert.match(section("contract_price").paragraphs[1]!.text, /\$12,000\.00/);
  assert.deepEqual(notices.cancellationForm, { sellerName: "Fixture Electric", sellerAddress: "1 Main St, Fresno, CA 93721", days: "three" });

  // Five days for a senior; no right-to-cancel notice when negotiated at the contractor's place of business.
  assert.equal(contractNotices({ ...base, seniorBuyer: true })!.cancellationForm?.days, "five");
  const atOffice = contractNotices({ ...base, negotiatedAtBusiness: true })!;
  assert.equal(atOffice.cancellationForm, null);
  assert.ok(!atOffice.sections.some((entry) => entry.id === "right_to_cancel"));
  // No downpayment or progress sections when there are none.
  const plain = contractNotices({ ...base, downpaymentCents: 0, progressPayments: [] })!;
  assert.ok(!plain.sections.some((entry) => entry.id === "downpayment" || entry.id === "progress_payments"));
  // Other contract types carry none.
  assert.equal(contractNotices({ ...base, contractType: "commercial" }), null);
});

test("CT-HIC-004: residential work defaults to a home improvement contract; it cannot be drawn up without the buyer's age or a phase for each progress payment", () => {
  assert.equal(defaultContractType("residential"), "home_improvement");
  assert.equal(defaultContractType(""), "home_improvement");
  assert.equal(defaultContractType("commercial"), "commercial");
  assert.match(homeImprovementRefusal({ seniorBuyer: null, progressPayments: [] }), /65 or older/);
  assert.match(homeImprovementRefusal({ seniorBuyer: false, progressPayments: [{ cents: 100, phase: " " }] }), /each progress payment/);
  assert.equal(homeImprovementRefusal({ seniorBuyer: true, progressPayments: [{ cents: 100, phase: "Panel" }] }), "");
});

test("CT-HIC-005: the right to cancel ends at midnight after the third (or fifth) business day, skipping Sundays and holidays", () => {
  const tz = "America/Los_Angeles";
  // Signed Friday Nov 20, 2026, 3pm Pacific: Sat 21 (1), Sun skipped, Mon 23 (2), Tue 24 (3).
  const friday = cancellationDeadline({ receivedAt: new Date("2026-11-20T23:00:00Z"), timeZone: tz, seniorBuyer: false });
  assert.equal(friday.lastDay, "2026-11-24");
  assert.equal(friday.endsAt.toISOString(), "2026-11-25T08:00:00.000Z");
  // Signed Wednesday Nov 25, 2026: Thanksgiving (26th) is skipped: Fri 27, Sat 28, Mon 30.
  const thanksgiving = cancellationDeadline({ receivedAt: new Date("2026-11-25T20:00:00Z"), timeZone: tz, seniorBuyer: false });
  assert.equal(thanksgiving.lastDay, "2026-11-30");
  // A senior on the same day: five business days, Fri 27, Sat 28, Mon 30, Tue Dec 1, Wed Dec 2.
  const senior = cancellationDeadline({ receivedAt: new Date("2026-11-25T20:00:00Z"), timeZone: tz, seniorBuyer: true });
  assert.equal(senior.lastDay, "2026-12-02");
  // Signed late at night: the local day counts, not the UTC one (11pm Pacific Mon = Tue UTC).
  const late = cancellationDeadline({ receivedAt: new Date("2026-12-08T07:00:00Z"), timeZone: tz, seniorBuyer: false });
  assert.equal(late.lastDay, "2026-12-10");
  // Christmas and New Year's are skipped; midnight lands in standard time.
  const holidays = cancellationDeadline({ receivedAt: new Date("2026-12-23T20:00:00Z"), timeZone: tz, seniorBuyer: false });
  assert.equal(holidays.lastDay, "2026-12-28");
  assert.equal(holidays.endsAt.toISOString(), "2026-12-29T08:00:00.000Z");
});

test("CT-HIC-006: deposits and work wait out the right to cancel; the customer may cancel only within it; refunds are due in 10 days", () => {
  const signed = { cancellable: true, signedAt: "2026-11-20T23:00:00Z", cancelDeadline: "2026-11-25T08:00:00Z", cancelledAt: null };
  assert.equal(withinCancellationPeriod(signed, new Date("2026-11-24T20:00:00Z")), true);
  assert.equal(withinCancellationPeriod(signed, new Date("2026-11-25T08:00:00Z")), false);
  // Signed with notices but no deadline recorded: held, never released by mistake.
  assert.equal(withinCancellationPeriod({ ...signed, cancelDeadline: null }, new Date("2027-01-01T00:00:00Z")), true);
  // Not cancellable (another type, or negotiated at the contractor's office), unsigned, or already cancelled: nothing waits.
  assert.equal(withinCancellationPeriod({ ...signed, cancellable: false }, new Date("2026-11-21T00:00:00Z")), false);
  assert.equal(withinCancellationPeriod({ ...signed, signedAt: null }, new Date("2026-11-21T00:00:00Z")), false);
  assert.equal(withinCancellationPeriod({ ...signed, cancelledAt: "2026-11-21T00:00:00Z" }, new Date("2026-11-22T00:00:00Z")), false);

  assert.equal(customerMayCancel({ ...signed, status: "signed" }, new Date("2026-11-24T20:00:00Z")), true);
  assert.equal(customerMayCancel({ ...signed, status: "signed" }, new Date("2026-11-25T09:00:00Z")), false);
  assert.equal(customerMayCancel({ ...signed, status: "void" }, new Date("2026-11-24T20:00:00Z")), false);

  assert.equal(refundDueBy(new Date("2026-11-21T00:00:00Z")).toISOString(), "2026-12-01T00:00:00.000Z");
});

test("CT-HIC-007: after a cancellation every payment is returned in full, to the card when Stripe took it, else by hand, and only once", async () => {
  const { cancellationRefundSteps, owedBackCents, refundsComplete } = await import("../lib/cancellation-refunds.ts");
  const paid = [
    { id: "deposit", source: "prepayment" as const, method: "card", amountCents: 100_000, refundedCents: 0, viaStripe: true },
    { id: "cash", source: "prepayment" as const, method: "cash", amountCents: 25_000, refundedCents: 0, viaStripe: false },
    { id: "inv", source: "invoice" as const, method: "card", amountCents: 50_000, refundedCents: 20_000, viaStripe: true },
    { id: "done", source: "invoice" as const, method: "check", amountCents: 10_000, refundedCents: 10_000, viaStripe: false },
  ];
  assert.deepEqual(cancellationRefundSteps(paid), [
    { id: "deposit", source: "prepayment", amountCents: 100_000, how: "stripe" },
    { id: "cash", source: "prepayment", amountCents: 25_000, how: "by_hand" },
    { id: "inv", source: "invoice", amountCents: 30_000, how: "stripe" },
  ]);
  assert.equal(owedBackCents(paid), 155_000);
  assert.equal(refundsComplete(paid), false);
  // Over-refunded or odd figures never produce a negative or fractional refund.
  assert.deepEqual(cancellationRefundSteps([{ ...paid[0]!, refundedCents: 150_000 }]), []);
  assert.equal(refundsComplete(paid.map((payment) => ({ ...payment, refundedCents: payment.amountCents }))), true);
});

test("CT-HIC-008: starting home improvement work without a contract signed by both parties asks for an acknowledgement", async () => {
  const { startNeedsContractAcknowledgement: needs } = await import("../lib/ca-home-improvement.ts");
  const signed = { contractType: "home_improvement", status: "signed", signedAt: "2026-11-20T00:00:00Z", contractorSignedAt: "2026-11-19T00:00:00Z" };
  assert.equal(needs({ category: "work_order", customerType: "residential", agreement: signed }), false);
  assert.equal(needs({ category: "work_order", customerType: "residential", agreement: null }), true);
  assert.equal(needs({ category: "work_order", customerType: "residential", agreement: { ...signed, signedAt: null, status: "sent" } }), true);
  assert.equal(needs({ category: "work_order", customerType: "residential", agreement: { ...signed, contractorSignedAt: null } }), true);
  assert.equal(needs({ category: "work_order", customerType: "residential", agreement: { ...signed, status: "cancelled" } }), true);
  // Not home improvement work: a diagnostic visit, another contract type, or a business with no contract saying otherwise.
  assert.equal(needs({ category: "diagnostic", customerType: "residential", agreement: null }), false);
  assert.equal(needs({ category: "work_order", customerType: "residential", agreement: { ...signed, contractType: "service_repair", signedAt: null } }), false);
  assert.equal(needs({ category: "work_order", customerType: "commercial", agreement: null }), false);
  assert.equal(needs({ category: "work_order", customerType: "commercial", agreement: { ...signed, signedAt: null } }), true);
});
