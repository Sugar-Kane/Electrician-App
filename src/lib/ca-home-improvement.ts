/**
 * California home improvement contracts: the contract types, the statutory
 * notices a home improvement contract carries, and the buyer's right to cancel.
 *
 * The notice wording is copied exactly from the California Contractors License
 * Law & Reference Book, 2026 Edition (CSLB), as extracted and checked in
 * compliance/legal-text/ca-home-improvement-2026.json. A test compares every
 * passage here with that file, so a stray edit fails the build. Nothing in a
 * notice is written by this app or by a model. The outer quotation marks the
 * statute prints around each notice are left off. A California attorney must
 * confirm this text and its layout before relying on it; see
 * compliance/legal-text/README.md.
 *
 * Covers compliance CSLB-002-001, CSLB-002-009, CSLB-003-016/017/025,
 * CSLB-008-001, CSLB-007-001/002/003/004/007, CA-005-007/008, CSLB-007-011.
 *
 * Import-free, so the rules are tested directly.
 */

export type ContractType = "home_improvement" | "service_repair" | "commercial" | "new_construction";

export const CONTRACT_TYPES: readonly { value: ContractType; label: string; describes: string }[] = [
  {
    value: "home_improvement",
    label: "Home improvement",
    describes: "Work on a home: repairs, remodels, additions, upgrades. Carries California's home improvement notices and right to cancel.",
  },
  {
    value: "service_repair",
    label: "Service and repair",
    describes: "A service call or repair the customer asked for. Choose only when counsel has confirmed it is outside the home improvement rules.",
  },
  { value: "commercial", label: "Commercial", describes: "Work for a business, not a home." },
  { value: "new_construction", label: "New construction", describes: "Work on a building not yet lived in, for a builder or developer." },
];

export function isContractType(value: unknown): value is ContractType {
  return CONTRACT_TYPES.some((type) => type.value === value);
}

/**
 * The contract type a job starts with: residential work is a home improvement
 * contract unless the office picks another type (Adam's decision, 2026-11-26).
 */
export function defaultContractType(customerType: string): ContractType {
  return customerType === "commercial" ? "commercial" : "home_improvement";
}

/** The version of the notice text below; stored with each contract that carries it. */
export const LEGAL_TEXT_VERSION = "ca-hic-2026.1";
export const LEGAL_TEXT_SOURCE =
  "California Contractors License Law & Reference Book, 2026 Edition (CSLB), Bus. & Prof. Code §§ 7159, 7159.5";

// ---------------------------------------------------------------------------
// The statutory text, exactly as printed (outer quotation marks left off).
// ---------------------------------------------------------------------------

/** B&P 7159(d)(3): heading, at least 10-point bold. */
export const HOME_IMPROVEMENT_HEADING = "Home Improvement";

/** B&P 7159(d)(4): at least 12-point bold. */
export const COMPLETED_COPY_STATEMENT =
  "You are entitled to a completely filled in copy of this agreement, signed by both you and the contractor, before any work may be started.";

/** B&P 7159(d)(5). */
export const CONTRACT_PRICE_HEADING = "Contract Price";

/** B&P 7159(d)(7). */
export const PROJECT_DESCRIPTION_HEADING =
  "Description of the Project and Description of the Significant Materials to be Used and Equipment to be Installed";

/** B&P 7159(d)(8)(A) and (C): the statement at least 12-point bold. */
export const DOWNPAYMENT_HEADING = "Downpayment";
export const DOWNPAYMENT_STATEMENT = "THE DOWNPAYMENT MAY NOT EXCEED $1,000 OR 10 PERCENT OF THE CONTRACT PRICE, WHICHEVER IS LESS.";

/** B&P 7159(d)(9)(A) and (C): the statement at least 12-point bold. */
export const PROGRESS_PAYMENTS_HEADING = "Schedule of Progress Payments";
export const PROGRESS_PAYMENTS_STATEMENT =
  "The schedule of progress payments must specifically describe each phase of work, including the type and amount of work or services scheduled to be supplied in each phase, along with the amount of each proposed progress payment. IT IS AGAINST THE LAW FOR A CONTRACTOR TO COLLECT PAYMENT FOR WORK NOT YET COMPLETED, OR FOR MATERIALS NOT YET DELIVERED. HOWEVER, A CONTRACTOR MAY REQUIRE A DOWNPAYMENT.";

/** B&P 7159(d)(13). */
export const EXTRA_WORK_HEADING = "Note About Extra Work and Change Orders";
export const EXTRA_WORK_STATEMENT =
  "Extra Work and Change Orders become part of the contract once the order is prepared in writing and signed by the parties prior to the commencement of work covered by the new change order. The order must describe the scope of the extra work or change, the cost to be added or subtracted from the contract, and the effect the order will have on the schedule of progress payments.";

/** B&P 7159(e)(4). */
export const MECHANICS_LIEN_WARNING: readonly string[] = [
  "MECHANICS LIEN WARNING:",
  "Anyone who helps improve your property, but who is not paid, may record what is called a mechanics lien on your property. A mechanics lien is a claim, like a mortgage or home equity loan, made against your property and recorded with the county recorder.",
  "Even if you pay your contractor in full, unpaid subcontractors, suppliers, and laborers who helped to improve your property may record mechanics liens and sue you in court to foreclose the lien. If a court finds the lien is valid, you could be forced to pay twice or have a court officer sell your home to pay the lien. Liens can also affect your credit.",
  "To preserve their right to record a lien, each subcontractor and material supplier must provide you with a document called a ‘Preliminary Notice.’ This notice is not a lien. The purpose of the notice is to let you know that the person who sends you the notice has the right to record a lien on your property if they are not paid.",
  "BE CAREFUL. The Preliminary Notice can be sent up to 20 days after the subcontractor starts work or the supplier provides material. This can be a big problem if you pay your contractor before you have received the Preliminary Notices.",
  "You will not get Preliminary Notices from your prime contractor or from laborers who work on your project. The law assumes that you already know they are improving your property.",
  "PROTECT YOURSELF FROM LIENS. You can protect yourself from liens by getting a list from your contractor of all the subcontractors and material suppliers that work on your project. Find out from your contractor when these subcontractors started work and when these suppliers delivered goods or materials. Then wait 20 days, paying attention to the Preliminary Notices you receive.",
  "PAY WITH JOINT CHECKS. One way to protect yourself is to pay with a joint check. When your contractor tells you it is time to pay for the work of a subcontractor or supplier who has provided you with a Preliminary Notice, write a joint check payable to both the contractor and the subcontractor or material supplier.",
  // The book prints the period that ends this sentence at the start of the
  // next line (".REMEMBER"); it is kept, on the sentence it ends.
  "For other ways to prevent liens, visit CSLB’s internet website at www.cslb.ca.gov or call CSLB at 800-321-CSLB (2752).",
  "REMEMBER, IF YOU DO NOTHING, YOU RISK HAVING A LIEN PLACED ON YOUR HOME. This can mean that you may have to pay twice, or face the forced sale of your home to pay what you owe.",
];

/** B&P 7159(e)(5): at least 12-point. */
export const CSLB_INFORMATION: readonly string[] = [
  "Information about the Contractors State License Board (CSLB): CSLB is the state consumer protection agency that licenses and regulates construction contractors.",
  "Contact CSLB for information about the licensed contractor you are considering, including information about disclosable complaints, disciplinary actions, and civil judgments that are reported to CSLB.",
  "Use only licensed contractors. If you file a complaint against a licensed contractor within the legal deadline (usually four years), CSLB has authority to investigate the complaint. If you use an unlicensed contractor, CSLB may not be able to help you resolve your complaint. Your only remedy may be in civil court, and you may be liable for damages arising out of any injuries to the unlicensed contractor or the unlicensed contractor’s employees.",
  "For more information:",
  "Visit CSLB’s internet website at www.cslb.ca.gov",
  "Call CSLB at 800-321-CSLB (2752)",
  "Write CSLB at P.O. Box 26000, Sacramento, CA 95826.",
];

/** B&P 7159(e)(6)(B)(i): the title, and the text at least 12-point bold. */
export const THREE_DAY_TITLE = "Three-Day Right to Cancel";
export const THREE_DAY_NOTICE: readonly string[] = [
  "You, the buyer, have the right to cancel this contract within three business days. You may cancel by emailing, mailing, faxing, or delivering a written notice to the contractor at the contractor’s place of business by midnight of the third business day after you received a signed and dated copy of the contract that includes this notice. Include your name, your address, and the date you received the signed copy of the contract and this notice.",
  "If you cancel, the contractor must return to you anything you paid within 10 days of receiving the notice of cancellation. For your part, you must make available to the contractor at your residence, in substantially as good condition as you received them, goods delivered to you under this contract or sale. Or, you may, if you wish, comply with the contractor’s instructions on how to return the goods at the contractor’s expense and risk. If you do make the goods available to the contractor and the contractor does not pick them up within 20 days of the date of your notice of cancellation, you may keep them without any further obligation. If you fail to make the goods available to the contractor, or if you agree to return the goods to the contractor and fail to do so, then you remain liable for performance of all obligations under the contract.",
];

/** B&P 7159(e)(6)(C)(vi)(I): the Notice of Cancellation form's statement. */
export const NOTICE_OF_CANCELLATION_CAPTION = "Notice of Cancellation";
export const NOTICE_OF_CANCELLATION_STATEMENT: readonly string[] = [
  "You may cancel this transaction, without any penalty or obligation, within three business days from the above date.",
  "If you cancel, any property traded in, any payments made by you under the contract or sale, and any negotiable instrument executed by you will be returned within 10 days following receipt by the seller of your cancellation notice, and any security interest arising out of the transaction will be canceled.",
  "If you cancel, you must make available to the seller at your residence, in substantially as good condition as when received, any goods delivered to you under this contract or sale, or you may, if you wish, comply with the instructions of the seller regarding the return shipment of the goods at the seller’s expense and risk.",
  "If you do make the goods available to the seller and the seller does not pick them up within 20 days of the date of your notice of cancellation, you may retain or dispose of the goods without any further obligation. If you fail to make the goods available to the seller, or if you agree to return the goods to the seller and fail to do so, then you remain liable for performance of all obligations under the contract.",
];
export const NOTICE_OF_CANCELLATION_INSTRUCTION =
  "To cancel this transaction, mail or deliver a signed and dated copy of this cancellation notice, or any other written notice, or send a telegram to";
export const NOTICE_OF_CANCELLATION_SIGN_LINE = "I hereby cancel this transaction.";

/**
 * B&P 7159(e)(6)(B)(ii) and (C)(vi)(II): for a buyer who is a senior citizen,
 * "three" and "third" become "five" and "fifth", and the notice is entitled
 * "Five-Day Right to Cancel" (7159(e)(6)(A)).
 */
export function seniorVersion(text: string): string {
  return text
    .replace(/\bThree-Day\b/g, "Five-Day")
    .replace(/\bthree\b/g, "five")
    .replace(/\bthird\b/g, "fifth");
}

// ---------------------------------------------------------------------------
// The notices a contract carries, as stored with it.
// ---------------------------------------------------------------------------

/**
 * How a passage is printed. B&P 7159(c)(2): at least 10-point text and
 * 10-point bold headings unless a larger size is required.
 */
export type NoticeStyle = "heading" | "body" | "large" | "large_bold";

export type NoticeParagraph = { text: string; style: NoticeStyle };

/**
 * Where a section goes on the contract:
 * - "top": on the first page, before the business's own terms;
 * - "terms": after the business's terms (price, payments, liens, CSLB);
 * - "cancel": immediately above the owner's signature (7159(e)(6)(C)(ii));
 * - "form": a Notice of Cancellation, printed twice after the signatures on a
 *   page of its own so it can be torn off (7159(e)(6)(C)(vi)).
 */
export type NoticePlacement = "top" | "terms" | "cancel" | "form";

export type NoticeSection = { id: string; placement: NoticePlacement; paragraphs: NoticeParagraph[] };

export type CancellationFormFacts = {
  sellerName: string;
  sellerAddress: string;
  /** "five" for a senior buyer, else "three". */
  days: "three" | "five";
};

export type LegalNotices = {
  version: string;
  source: string;
  contractType: ContractType;
  /** The buyer is 65 or older: the five-day right to cancel applies. */
  seniorBuyer: boolean;
  /** Negotiated at the contractor's place of business: no right-to-cancel notice (7159(e)(6)(A)(i)). */
  negotiatedAtBusiness: boolean;
  sections: NoticeSection[];
  /** Null when the contract carries no right to cancel. */
  cancellationForm: CancellationFormFacts | null;
};

export type ProgressPayment = { cents: number; phase: string };

function dollars(cents: number): string {
  return (Math.max(0, Math.round(cents)) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const para = (text: string, style: NoticeStyle = "body"): NoticeParagraph => ({ text, style });

/**
 * Why a home improvement contract cannot be drawn up yet, or "" when it can.
 * Each progress payment must say what work or materials it pays for
 * (7159(d)(9)(B)); the buyer's age decides which right to cancel applies.
 */
export function homeImprovementRefusal(input: { seniorBuyer: boolean | null; progressPayments: ProgressPayment[] }): string {
  if (input.seniorBuyer === null) {
    return "Answer whether the customer is 65 or older. It decides whether they get three or five business days to cancel.";
  }
  const missing = input.progressPayments.findIndex((payment) => !payment.phase.trim());
  if (missing >= 0) {
    return "Describe the work each progress payment is for (the phase of work, and the materials or equipment it covers) on the payment plan before drawing up the contract.";
  }
  return "";
}

/**
 * The notices for a contract, frozen when it is drawn up and stored with it.
 * Only a home improvement contract carries them; other types return null.
 */
export function contractNotices(input: {
  contractType: ContractType;
  seniorBuyer: boolean;
  negotiatedAtBusiness: boolean;
  contractPriceCents: number;
  downpaymentCents: number;
  progressPayments: ProgressPayment[];
  sellerName: string;
  sellerAddress: string;
}): LegalNotices | null {
  if (input.contractType !== "home_improvement") return null;

  const sections: NoticeSection[] = [
    {
      id: "home_improvement",
      placement: "top",
      paragraphs: [para(HOME_IMPROVEMENT_HEADING, "heading"), para(COMPLETED_COPY_STATEMENT, "large_bold")],
    },
    {
      id: "contract_price",
      placement: "terms",
      paragraphs: [para(CONTRACT_PRICE_HEADING, "heading"), para(input.contractPriceCents > 0 ? dollars(input.contractPriceCents) : "")],
    },
  ];

  if (input.downpaymentCents > 0) {
    sections.push({
      id: "downpayment",
      placement: "terms",
      paragraphs: [para(DOWNPAYMENT_HEADING, "heading"), para(dollars(input.downpaymentCents)), para(DOWNPAYMENT_STATEMENT, "large_bold")],
    });
  }

  if (input.progressPayments.length > 0) {
    sections.push({
      id: "progress_payments",
      placement: "terms",
      paragraphs: [
        para(PROGRESS_PAYMENTS_HEADING, "heading"),
        ...input.progressPayments.map((payment, index) => para(`${index + 1}. ${dollars(payment.cents)}: ${payment.phase.trim()}`)),
        para(PROGRESS_PAYMENTS_STATEMENT, "large_bold"),
      ],
    });
  }

  sections.push(
    { id: "extra_work", placement: "terms", paragraphs: [para(EXTRA_WORK_HEADING, "heading"), para(EXTRA_WORK_STATEMENT)] },
    {
      id: "mechanics_lien_warning",
      placement: "terms",
      paragraphs: MECHANICS_LIEN_WARNING.map((text, index) => para(text, index === 0 ? "heading" : "body")),
    },
    { id: "cslb_information", placement: "terms", paragraphs: CSLB_INFORMATION.map((text) => para(text, "large")) },
  );

  const days = input.seniorBuyer ? "five" : "three";
  const cancellable = !input.negotiatedAtBusiness;
  if (cancellable) {
    const adapt = (text: string) => (input.seniorBuyer ? seniorVersion(text) : text);
    sections.push({
      id: "right_to_cancel",
      placement: "cancel",
      paragraphs: [para(adapt(THREE_DAY_TITLE), "large_bold"), ...THREE_DAY_NOTICE.map((text) => para(adapt(text), "large_bold"))],
    });
  }

  return {
    version: LEGAL_TEXT_VERSION,
    source: LEGAL_TEXT_SOURCE,
    contractType: input.contractType,
    seniorBuyer: input.seniorBuyer,
    negotiatedAtBusiness: input.negotiatedAtBusiness,
    sections,
    cancellationForm: cancellable ? { sellerName: input.sellerName.trim(), sellerAddress: input.sellerAddress.trim(), days } : null,
  };
}

/** The Notice of Cancellation statement for this buyer: "five" in place of "three" for a senior. */
export function cancellationStatement(days: "three" | "five"): string[] {
  return NOTICE_OF_CANCELLATION_STATEMENT.map((text) => (days === "five" ? text.replace(/\bthree\b/g, "five") : text));
}

/** Reads a stored notices snapshot back, or null for a contract without one. */
export function readLegalNotices(value: unknown): LegalNotices | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.version !== "string" || !Array.isArray(row.sections)) return null;
  return value as LegalNotices;
}

// ---------------------------------------------------------------------------
// The right to cancel: when it ends, and what waits for it.
// ---------------------------------------------------------------------------

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return ymd(new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7)));
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return ymd(new Date(Date.UTC(year, month + 1, -offset)));
}

/**
 * The holidays that are not business days for the right to cancel: New Year's
 * Day, Washington's Birthday, Memorial Day, Independence Day, Labor Day,
 * Columbus Day, Veterans Day, Thanksgiving Day and Christmas Day, as Civil
 * Code 1689.5 is understood to list them. Counsel must confirm the list and
 * whether a holiday falling on a weekend moves; the enacted text was not read.
 */
export function cancellationHolidays(year: number): Set<string> {
  return new Set([
    `${year}-01-01`,
    nthWeekday(year, 1, 1, 3), // third Monday in February
    lastWeekday(year, 4, 1), // last Monday in May
    `${year}-07-04`,
    nthWeekday(year, 8, 1, 1), // first Monday in September
    nthWeekday(year, 9, 1, 2), // second Monday in October
    `${year}-11-11`,
    nthWeekday(year, 10, 4, 4), // fourth Thursday in November
    `${year}-12-25`,
  ]);
}

/** Every day but Sunday and the holidays above. */
export function isCancellationBusinessDay(isoDate: string): boolean {
  const date = new Date(`${isoDate}T12:00:00Z`);
  if (date.getUTCDay() === 0) return false;
  return !cancellationHolidays(date.getUTCFullYear()).has(isoDate);
}

/** "2026-11-26" for an instant, in the business's timezone. */
export function localDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The instant a local date begins (00:00) in a timezone. */
export function startOfLocalDay(isoDate: string, timeZone: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, day);
  // The zone's offset at that moment, read back from how it prints.
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - instant;
  };
  let instant = guess - offsetAt(guess);
  instant = guess - offsetAt(instant);
  return new Date(instant);
}

/**
 * When the buyer's right to cancel ends: midnight at the end of the third
 * business day (fifth for a senior) after the day they received the signed
 * copy. Returns the last day to cancel and the instant the right ends (the
 * start of the following day in the business's timezone).
 */
export function cancellationDeadline(input: { receivedAt: Date; timeZone: string; seniorBuyer: boolean }): {
  lastDay: string;
  endsAt: Date;
} {
  let day = localDate(input.receivedAt, input.timeZone);
  let counted = 0;
  const needed = input.seniorBuyer ? 5 : 3;
  const next = (isoDate: string) => ymd(new Date(Date.parse(`${isoDate}T12:00:00Z`) + 86_400_000));
  while (counted < needed) {
    day = next(day);
    if (isCancellationBusinessDay(day)) counted += 1;
  }
  return { lastDay: day, endsAt: startOfLocalDay(next(day), input.timeZone) };
}

/** Within the right to cancel: deposits are not asked for and work waits. A contract signed with notices but no deadline recorded counts as within it. */
export function withinCancellationPeriod(
  contract: { cancellable: boolean; signedAt: string | null; cancelDeadline: string | null; cancelledAt: string | null },
  now: Date,
): boolean {
  if (!contract.cancellable || !contract.signedAt || contract.cancelledAt) return false;
  if (!contract.cancelDeadline) return true;
  return now.getTime() < Date.parse(contract.cancelDeadline);
}

/** Refunds after a cancellation are due within 10 days of receiving it (the notice's own words). */
export const REFUND_DAYS = 10;

export function refundDueBy(cancelledAt: Date): Date {
  return new Date(cancelledAt.getTime() + REFUND_DAYS * 86_400_000);
}

/** Whether the customer may still cancel from their link right now. */
export function customerMayCancel(
  contract: { cancellable: boolean; signedAt: string | null; cancelDeadline: string | null; cancelledAt: string | null; status: string },
  now: Date,
): boolean {
  if (contract.status !== "signed") return false;
  return withinCancellationPeriod(contract, now);
}
