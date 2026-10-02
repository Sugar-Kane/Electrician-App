import { STARTER_TEMPLATE, fillTemplate, type ContractFacts } from "./contract-template.ts";
import { formatMoney } from "./dashboard-metrics.ts";
import { diagnosticCreditFor, invoiceTotals, type InvoiceTotals } from "./invoice-math.ts";
import { formatCents, jobLineTotals, type JobLine, type JobLineTotals } from "./job-lines.ts";
import type { ContractDocumentData, ContractSignature } from "./pdf/contract-document.tsx";
import type { BusinessLetterhead } from "./pdf/letterhead.tsx";

/**
 * The sample job: what the front page shows, and what /demo walks through.
 *
 * One job carried from the price to the bill, because that is the thing
 * Volteira is for — the lines priced at the start are the lines on the
 * contract and the lines on the invoice, and nobody types them twice.
 *
 * The figures come from the app's own arithmetic (job-lines.ts,
 * invoice-math.ts) and the contract from its own starter template, so the
 * demo cannot drift from what the product does. Change how a diagnostic fee is
 * credited, or reword the template, and the demo says the new thing too.
 *
 * Data and pure functions only. Nothing here can reach a database, which is
 * what lets /demo be public: there is nothing behind it to change.
 */

export type JobStageId = "estimate" | "contract" | "schedule" | "work" | "invoice" | "paid";

export type JobStage = {
  id: JobStageId;
  name: string;
  /** What happens at this stage, in a line. */
  line: string;
};

/**
 * The six stages a job moves through, in order.
 *
 * The front page describes the workflow with this list and the demo walks
 * through it, so the two cannot disagree about it.
 *
 * Each line says only what the app does. Estimate is the job's priced labor
 * and parts: there is no separate estimate document, and what the customer
 * approves is the contract. Paid is what is still owed and the customer's
 * history, because nothing records an invoice payment yet.
 */
export const JOB_STAGES: readonly JobStage[] = [
  { id: "estimate", name: "Estimate", line: "Price the labor and materials." },
  { id: "contract", name: "Contract", line: "Send the agreement and capture approval." },
  { id: "schedule", name: "Schedule", line: "Put the work on the calendar." },
  { id: "work", name: "Work", line: "Keep materials, photos, notes, and progress together." },
  { id: "invoice", name: "Invoice", line: "Turn completed work into a bill." },
  { id: "paid", name: "Paid", line: "Track what’s owed and keep the customer’s history." },
];

export function stageIndex(stage: JobStageId): number {
  return Math.max(
    0,
    JOB_STAGES.findIndex((entry) => entry.id === stage),
  );
}

/** The job's status at each stage, in the app's own words (status-badge.tsx). */
export function jobStatusAt(stage: JobStageId): string {
  switch (stage) {
    case "estimate":
    case "contract":
      return "Pending";
    case "schedule":
      return "Scheduled";
    case "work":
      return "In progress";
    default:
      return "Completed";
  }
}

/** Where the sample business is, and so the clock its dates are read on. */
export const DEMO_TIME_ZONE = "America/Los_Angeles";

// 555-01xx numbers are set aside for fiction: nobody can be rung by mistake.
export const DEMO_BUSINESS: BusinessLetterhead = {
  name: "Ridgeway Electric",
  phone: "(916) 555-0148",
  email: "",
  addressLine1: "",
  city: "Sacramento",
  state: "CA",
  postalCode: "",
  licenseNumber: "",
};

/** Who signs for the business, which it does when it sends the contract. */
export const DEMO_OWNER = { name: "Dana Ridgeway", title: "Owner" };

export const DEMO_CUSTOMER = {
  name: "Sarah Martinez",
  firstName: "Sarah",
  phone: "(916) 555-0186",
  email: "sarah.martinez@example.com",
  addressLines: ["418 Alder Lane", "Sacramento, CA 95822"],
  /** The address as a job card shows it, on one line. */
  shortAddress: "418 Alder Lane, Sacramento",
};

export const DEMO_JOB = {
  number: "1042",
  kind: "Work order",
  work: "200A panel upgrade",
  technician: "Jordan Ellis",
  hours: "8:00 AM–4:00 PM",
  invoiceNumber: "3127",
  /** What the diagnostic visit found, which is why this job exists. */
  finding:
    "The original 100A panel is full, and the main breaker trips when the dryer and the air conditioning run together.",
  /** Paid online when the diagnostic was booked, and credited on the first invoice. */
  diagnosticFeeCents: 18_000,
  scope:
    "Replace the existing 100-amp main panel with a 200-amp main breaker panel and a new 200-amp meter socket. Run new 4/0 service entrance cable, install a new grounding system and whole-home surge protection, and move every existing circuit to a new, labeled breaker. Coordinate the utility disconnect and reconnect, and obtain the permit and final inspection.",
};

/** Labor in hours and parts each, the units the app's own forms start with. */
export const DEMO_LINES: JobLine[] = [
  {
    id: "labor-install",
    kind: "labor",
    description: "Remove old panel, install 200A panel and meter socket",
    quantity: 16,
    unit: "hr",
    unitPriceCents: 12_500,
  },
  {
    id: "labor-permit",
    kind: "labor",
    description: "Permit, inspection and utility coordination",
    quantity: 4,
    unit: "hr",
    unitPriceCents: 12_500,
  },
  {
    id: "part-panel",
    kind: "material",
    description: "200A main breaker load center",
    quantity: 1,
    unit: "each",
    unitPriceCents: 64_000,
    inventoryItemId: "stock-load-center",
  },
  {
    id: "part-meter",
    kind: "material",
    description: "200A meter socket",
    quantity: 1,
    unit: "each",
    unitPriceCents: 31_000,
  },
  {
    id: "part-breakers",
    kind: "material",
    description: "Breakers, AFCI and GFCI",
    quantity: 14,
    unit: "each",
    unitPriceCents: 5_500,
    inventoryItemId: "stock-breakers",
  },
  {
    id: "part-cable",
    kind: "material",
    description: "4/0 SER cable",
    quantity: 30,
    unit: "ft",
    unitPriceCents: 900,
  },
  {
    id: "part-ground",
    kind: "material",
    description: "Ground rods and clamps",
    quantity: 1,
    unit: "set",
    unitPriceCents: 16_000,
  },
  {
    id: "part-surge",
    kind: "material",
    description: "Whole-home surge protector",
    quantity: 1,
    unit: "each",
    unitPriceCents: 20_000,
  },
];

export function demoTotals(): JobLineTotals {
  return jobLineTotals(DEMO_LINES);
}

/** "$4,850", the way the dashboard writes a figure. */
export function demoEstimateLabel(): string {
  return formatMoney(demoTotals().subtotalCents);
}

/**
 * The invoice, from the same lines, less the diagnostic fee paid at booking.
 *
 * Worked out by the functions the real invoice uses, so the credit is taken
 * the way the app takes it: once, off the first invoice.
 */
export function demoInvoice(): InvoiceTotals {
  return invoiceTotals({
    subtotalCents: demoTotals().subtotalCents,
    diagnosticPaidCents: diagnosticCreditFor({
      diagnosticPaid: true,
      diagnosticFeeCents: DEMO_JOB.diagnosticFeeCents,
    }),
  });
}

export type DemoDay = {
  /** YYYY-MM-DD */
  iso: string;
  /** "Tue" */
  weekday: string;
  /** "Oct 13" */
  date: string;
};

export type DemoCalendar = {
  todayIso: string;
  /** When Sarah booked the diagnostic online and paid for it. */
  booked: DemoDay;
  /** The diagnostic visit that turned into this job. */
  diagnostic: DemoDay;
  /**
   * When the contract was drawn up and signed for the business: the day
   * before, so the business's signature is always older than the one the
   * visitor gives today, as it is when a contract is sent for signing.
   */
  contract: DemoDay;
  /** Monday to Friday of the week the work goes into. */
  week: DemoDay[];
};

/** Tuesday: where the work sits in its week until somebody moves it. */
export const BOOKED_WEEKDAY = 1;

const DAY_MS = 86_400_000;

function utcDay(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year ?? NaN, (month ?? NaN) - 1, day ?? NaN));
}

function utcFormat(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(date);
}

function dayOf(date: Date): DemoDay {
  return {
    iso: date.toISOString().slice(0, 10),
    weekday: utcFormat(date, { weekday: "short" }),
    date: utcFormat(date, { month: "short", day: "numeric" }),
  };
}

/** Today where the sample business is, as YYYY-MM-DD. */
export function demoToday(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEMO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The job's dates, counted from today, so the sample never reads as last
 * year's.
 *
 * Worked out from a plain date rather than a clock, and formatted in UTC, so
 * the page that renders it and the browser that takes it over produce the same
 * words whatever time zone either of them is in.
 */
export function demoCalendar(todayIso: string): DemoCalendar {
  const parsed = utcDay(todayIso);
  const today = Number.isNaN(parsed.getTime()) ? utcDay(demoToday(new Date())) : parsed;
  const offset = (days: number) => new Date(today.getTime() + days * DAY_MS);
  // The first Monday after today, so the work is always ahead, never booked
  // into a day that has already gone by.
  const untilMonday = (8 - today.getUTCDay()) % 7 || 7;

  return {
    todayIso: dayOf(today).iso,
    booked: dayOf(offset(-9)),
    diagnostic: dayOf(offset(-7)),
    contract: dayOf(offset(-1)),
    week: [0, 1, 2, 3, 4].map((day) => dayOf(offset(untilMonday + day))),
  };
}

/** "Tue, Oct 13, 2026": how a contract writes a date (contract-actions.ts). */
export function longDate(iso: string): string {
  return utcFormat(utcDay(iso), { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** "Oct 13, 2026": the contract's own date lines (contract-data.ts). */
export function shortDate(iso: string): string {
  return utcFormat(utcDay(iso), { month: "short", day: "numeric", year: "numeric" });
}

/** "Oct 2, 2026, 3:14 PM PDT": a signature's moment, as contract-signing.ts writes it. */
export function signedAtLabel(at: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DEMO_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
}

/** The facts the contract is filled from, as the app gathers them for a real job. */
export function demoContractFacts(calendar: DemoCalendar, workDay: DemoDay): Partial<ContractFacts> {
  return {
    business_name: DEMO_BUSINESS.name,
    business_phone: DEMO_BUSINESS.phone,
    customer_name: DEMO_CUSTOMER.name,
    service_address: DEMO_CUSTOMER.addressLines.join(", "),
    job_number: DEMO_JOB.number,
    job_date: longDate(workDay.iso),
    work_type: DEMO_JOB.work,
    total: formatCents(demoTotals().subtotalCents),
    // As the app writes it for a customer who paid when they booked: they are
    // not asked for it again by their own contract.
    deposit: `${formatCents(DEMO_JOB.diagnosticFeeCents)} (paid)`,
    scope: DEMO_JOB.scope,
    // The day it was drawn up, which is what the template means by today.
    today: longDate(calendar.contract.iso),
  };
}

/**
 * The contract, as ContractPaper draws it: the app's starter template filled
 * from the job, already signed for the business, and signed by Sarah once the
 * visitor has done it for her.
 */
export function demoContract(input: {
  calendar: DemoCalendar;
  workDay: DemoDay;
  signature?: ContractSignature;
}): ContractDocumentData {
  const filled = fillTemplate(STARTER_TEMPLATE, demoContractFacts(input.calendar, input.workDay));

  return {
    business: DEMO_BUSINESS,
    kind: "agreement",
    reference: `Job #${DEMO_JOB.number}`,
    createdLabel: shortDate(input.calendar.contract.iso),
    customer: {
      name: DEMO_CUSTOMER.name,
      addressLines: DEMO_CUSTOMER.addressLines,
      phone: DEMO_CUSTOMER.phone,
      email: DEMO_CUSTOMER.email,
    },
    job: {
      number: DEMO_JOB.number,
      addressLines: DEMO_CUSTOMER.addressLines,
      scheduledLabel: `Scheduled ${shortDate(input.workDay.iso)}`,
    },
    body: filled.body,
    unfilled: filled.unfilled.map((key) => `{{${key}}}`),
    ...(input.signature ? { signature: input.signature } : {}),
    contractorSignature: {
      method: "typed",
      name: DEMO_OWNER.name,
      title: DEMO_OWNER.title,
      image: "",
      // Late afternoon in Sacramento, whichever side of daylight saving.
      signedLabel: signedAtLabel(new Date(`${input.calendar.contract.iso}T23:12:00Z`)),
    },
  };
}

export type WeekJob = { number: string; work: string; hours: string };

/** What else is on the calendar that week, by weekday, so the job has company. */
export const WEEK_JOBS: Record<number, WeekJob[]> = {
  0: [
    { number: "1039", work: "GFCI outlets", hours: "9–11 AM" },
    { number: "1040", work: "EV charger circuit", hours: "1–4 PM" },
  ],
  2: [{ number: "1043", work: "Recessed lighting", hours: "8 AM–12 PM" }],
  3: [{ number: "1044", work: "Diagnostic: flickering lights", hours: "10 AM–12 PM" }],
  4: [{ number: "1045", work: "Ceiling fan install", hours: "1–3 PM" }],
};

export type HistoryEntry = { day: DemoDay; text: string };

/** The customer's history, as her record keeps it: everything, in order, on one page. */
export function demoHistory(input: {
  calendar: DemoCalendar;
  workDay: DemoDay;
  signed: boolean;
}): HistoryEntry[] {
  const { calendar, workDay } = input;
  const today = dayOf(utcDay(calendar.todayIso));
  const invoice = demoInvoice();

  return [
    {
      day: calendar.booked,
      text: `Booked a diagnostic online and paid the ${formatCents(DEMO_JOB.diagnosticFeeCents)} fee`,
    },
    { day: calendar.diagnostic, text: `Diagnostic visit: ${DEMO_JOB.work} recommended` },
    { day: calendar.contract, text: `Contract sent for ${formatCents(demoTotals().subtotalCents)}` },
    ...(input.signed ? [{ day: today, text: "Signed the contract" }] : []),
    { day: workDay, text: `Panel upgrade finished by ${DEMO_JOB.technician}` },
    {
      day: workDay,
      text: `Invoice #${DEMO_JOB.invoiceNumber} sent by text: ${formatCents(invoice.totalCents)} due`,
    },
  ];
}
