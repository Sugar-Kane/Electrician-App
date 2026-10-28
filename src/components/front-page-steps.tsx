"use client";

import { useId, useState } from "react";
import { ArrowUpRight, CalendarCheck2, Check, Clock, FileSignature, MapPin, MessageSquare, Sparkles, Truck } from "lucide-react";

import { BrowserFrame, type FrameNav } from "@/components/browser-frame";
import { LineRows } from "@/components/demo-job-parts";
import { DEMO_CUSTOMER, DEMO_JOB, DEMO_LINES, DEMO_OWNER, demoEstimateLabel, demoInvoice } from "@/lib/demo-job";
import { formatCents } from "@/lib/job-lines";

/**
 * The front page's walk through a job: numbered steps on the left, and on the
 * right Volteira doing the one being pointed at. Hovering, focusing or
 * tapping a step shows it. On a phone, where nothing hovers, a tapped step
 * opens in place with its screen under it.
 *
 * Every screen is something the app does today, drawn with the demo job
 * (lib/demo-job.ts) so the figures agree with the hero and with /demo.
 */

type Step = {
  label: string;
  title: string;
  body: string;
  path: string;
  nav: FrameNav;
  caption: string;
  alt: string;
  Screen: () => React.ReactElement;
};

const STEPS: Step[] = [
  {
    label: "Book",
    title: "Customers book themselves.",
    body: "Requests from your website and texts land in one place. Volteira texts back, offers a time, and takes the diagnostic fee up front.",
    path: "requests",
    nav: "Today",
    caption: "Every request, who answered it, and what’s already paid.",
    alt: `Booking requests in Volteira: ${DEMO_CUSTOMER.name} asked on the website, was texted back, picked Tuesday 8 to 10 AM and paid the $180 diagnostic.`,
    Screen: BookScreen,
  },
  {
    label: "Price",
    title: "Price it from a chat.",
    body: "Describe the job and get the materials list back, priced from Home Depot and Lowe’s with your markup. Add it to the estimate in one tap.",
    path: `jobs/${DEMO_JOB.number}`,
    nav: "Jobs",
    caption: "The list, the store prices, and your price to the customer.",
    alt: "A materials list written from a chat, each item priced at Home Depot and Lowe’s, ready to add to the estimate.",
    Screen: PriceScreen,
  },
  {
    label: "Sign",
    title: "Signed on their phone.",
    body: "Send the contract by text. The customer reads it and signs on their phone, and the signed copy stays on the job.",
    path: "contracts",
    nav: "Jobs",
    caption: "The agreement, both signatures, and when it was signed.",
    alt: `The service agreement for job ${DEMO_JOB.number}, signed by ${DEMO_CUSTOMER.name} on her phone and by the business.`,
    Screen: SignScreen,
  },
  {
    label: "Schedule",
    title: "Plan the day.",
    body: "Put the work on the calendar, assign the tech, and route the day with the supply stop in it.",
    path: "today",
    nav: "Today",
    caption: "Who goes where, in order, with the parts on the way.",
    alt: "Today’s route in Volteira: the panel upgrade at 8 AM, a supply house stop, and recessed lighting at 1 PM.",
    Screen: ScheduleScreen,
  },
  {
    label: "Get paid",
    title: "Bill from the job.",
    body: "The invoice is built from the job’s own lines, with the diagnostic taken off. Send it by text or email and record the payment.",
    path: `invoices/${DEMO_JOB.invoiceNumber}`,
    nav: "Invoices",
    caption: "What was done, what was credited, and what’s still owed.",
    alt: `Invoice ${DEMO_JOB.invoiceNumber} for ${DEMO_CUSTOMER.name}, with the $180 diagnostic credited, sent by text.`,
    Screen: PaidScreen,
  },
];

export function FrontPageSteps() {
  const [active, setActive] = useState(0);
  const id = useId();
  const step = STEPS[active];

  return (
    <div className="mt-8 grid gap-10 lg:mt-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14">
      <ol className="border-t border-line">
        {STEPS.map((each, index) => {
          const on = index === active;
          return (
            <li key={each.label} className="border-b border-line">
              <button
                type="button"
                aria-pressed={on}
                aria-controls={`${id}-screen`}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onClick={() => setActive(index)}
                className="group relative grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] gap-x-3 py-5 text-left outline-none focus-visible:bg-white/[0.03] sm:py-6"
              >
                <span className={`pt-0.5 font-mono text-sm ${on ? "text-brand" : "text-ink-faint"}`}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className={`block font-mono text-xs uppercase tracking-[0.2em] ${on ? "text-ink" : "text-ink-faint"}`}>
                    {each.label}
                  </span>
                  <span
                    className={`mt-2 block text-xl font-semibold tracking-tight transition-colors sm:text-2xl ${
                      on ? "text-ink" : "text-ink-muted group-hover:text-ink"
                    }`}
                  >
                    {each.title}
                  </span>
                  <span className={`mt-2 block text-sm leading-6 sm:text-base sm:leading-7 ${on ? "text-ink-muted" : "text-ink-faint"}`}>
                    {each.body}
                  </span>
                </span>
                <ArrowUpRight
                  className={`h-5 w-5 transition ${on ? "text-brand" : "text-ink-faint group-hover:text-ink-muted"}`}
                  aria-hidden
                />
                {/* The rule under the step being shown. */}
                <span
                  aria-hidden
                  className={`absolute inset-x-0 -bottom-px h-0.5 bg-brand transition-opacity ${on ? "opacity-100" : "opacity-0"}`}
                />
              </button>
              {/* On a phone the screen opens under its own step. */}
              {on ? (
                <div className="pb-6 lg:hidden">
                  <StepScreen step={each} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="hidden lg:block">
        <div id={`${id}-screen`} className="sticky top-24" aria-live="polite">
          <StepScreen step={step} swapKey={active} />
        </div>
      </div>
    </div>
  );
}

/**
 * One window for every step: the frame stays where it is, the same size,
 * and only the screen inside it and the caption under it change.
 */
function StepScreen({ step, swapKey }: { step: Step; swapKey?: number }) {
  const { Screen } = step;
  return (
    <figure>
      <BrowserFrame path={step.path} active={step.nav} label={step.alt} bodyClassName={SCREEN_SIZE}>
        <div key={swapKey} className="motion-safe:animate-swap">
          <Screen />
        </div>
      </BrowserFrame>
      <figcaption key={swapKey} className="mt-4 min-h-12 text-sm text-ink-muted motion-safe:animate-swap sm:text-base">
        {step.caption}
      </figcaption>
    </figure>
  );
}

/** Tall enough for the tallest screen, so every step's window is the same size. */
const SCREEN_SIZE = "h-[36rem]";

const CHIP = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold";
const GOOD = `${CHIP} border-positive/30 bg-positive-bg text-positive`;
const BRAND = `${CHIP} border-brand/30 bg-brand/[0.1] text-brand`;
const PLAIN = `${CHIP} border-line text-ink-muted`;

function ScreenTitle({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-4">
      <p className="text-lg font-semibold tracking-tight">{title}</p>
      <p className="text-xs text-ink-muted">{detail}</p>
    </div>
  );
}

function BookScreen() {
  return (
    <div>
      <ScreenTitle title="Booking requests" detail="3 new today" />
      <ul className="space-y-2">
        <li className="rounded-control border border-brand/30 bg-brand/[0.05] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{DEMO_CUSTOMER.name}</p>
              <p className="truncate text-xs text-ink-muted">Main breaker trips with the dryer and A/C on</p>
            </div>
            <span className={GOOD}>
              <Check className="h-3 w-3" aria-hidden /> $180 paid
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className={PLAIN}>From your website</span>
            <span className={PLAIN}>Texted</span>
            <span className={BRAND}>
              <CalendarCheck2 className="h-3 w-3" aria-hidden /> Tue 8–10 AM
            </span>
          </div>
        </li>
        <li className="rounded-control border border-line p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Marcus Lee</p>
              <p className="truncate text-xs text-ink-muted">EV charger in the garage</p>
            </div>
            <span className={PLAIN}>Choosing a time</span>
          </div>
        </li>
        <li className="rounded-control border border-line p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Priya Shah</p>
              <p className="truncate text-xs text-ink-muted">Flickering kitchen lights</p>
            </div>
            <span className={PLAIN}>Call back</span>
          </div>
        </li>
      </ul>
      <div className="mt-4 rounded-control border border-line bg-surface p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          <MessageSquare className="h-3 w-3" aria-hidden /> Text conversation
        </p>
        <div className="mt-2 space-y-1.5 text-xs leading-5">
          <p className="mr-10 rounded-control bg-white/[0.05] px-2.5 py-1.5">
            Hi {DEMO_CUSTOMER.firstName}, this is Ridgeway Electric about your website request. Does Tue 8–10 AM work?
          </p>
          <p className="ml-auto w-fit rounded-control bg-brand/[0.15] px-2.5 py-1.5">Yes, that works!</p>
          <p className="mr-10 rounded-control bg-white/[0.05] px-2.5 py-1.5">
            You’re booked. Here’s the link to pay the $180 diagnostic.
          </p>
        </div>
      </div>
    </div>
  );
}

const PRICED: { qty: string; name: string; homeDepot: string; lowes: string }[] = [
  { qty: "1", name: "200A main breaker panel, 40-space", homeDepot: "$289.00", lowes: "$299.00" },
  { qty: "25 ft", name: "2/0-2/0-2/0-1 SER aluminum", homeDepot: "$4.12/ft", lowes: "$4.38/ft" },
  { qty: "1", name: "200A meter base, ringless", homeDepot: "$118.00", lowes: "$112.47" },
  { qty: "4", name: "20A AFCI breakers", homeDepot: "$48.97", lowes: "$51.98" },
];

function PriceScreen() {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-brand" aria-hidden /> Materials chat
      </p>
      <p className="mt-3 ml-auto w-fit max-w-[85%] rounded-control bg-brand/[0.1] px-3 py-2 text-sm">
        200A panel upgrade, about a 25 ft run from the meter
      </p>
      <div className="mt-3 rounded-control border border-line bg-white/[0.015] p-3">
        <p className="text-sm font-semibold">Ridgeway Electric — Panel Upgrade Material List</p>
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Service &amp; panel</p>
        <ul className="mt-1 divide-y divide-line">
          {PRICED.map((item) => (
            <li key={item.name} className="py-2">
              <p className="text-sm">
                {item.qty} × {item.name}
              </p>
              <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-muted">
                <span>Home Depot {item.homeDepot}</span>
                <span className="font-semibold text-ink">Lowe’s {item.lowes}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">Store price + 20% markup</p>
        <span className="inline-flex min-h-9 items-center rounded-control bg-brand px-3 text-xs font-bold text-on-brand">
          Add to the estimate · {demoEstimateLabel()}
        </span>
      </div>
    </div>
  );
}

function SignScreen() {
  return (
    <div>
      <ScreenTitle title="Service agreement" detail={`Job #${DEMO_JOB.number} · ${DEMO_JOB.work}`} />
      <div className="rounded-control border border-line bg-white/[0.015] p-3">
        <LineRows lines={DEMO_LINES.slice(0, 3)} />
        <p className="mt-2 flex items-center justify-between text-sm font-semibold">
          <span>Contract total</span>
          <span>{demoEstimateLabel()}</span>
        </p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {[
          { who: DEMO_CUSTOMER.name, role: "Customer", when: "Signed on her phone · Oct 13, 2:14 PM" },
          { who: DEMO_OWNER.name, role: "Ridgeway Electric", when: "Signed when sent · Oct 12" },
        ].map((signer) => (
          <div key={signer.who} className="rounded-control border border-line p-3">
            <p className="font-serif text-2xl italic leading-8 text-ink">{signer.who}</p>
            <p className="mt-1 border-t border-line pt-1 text-xs text-ink-muted">
              {signer.role} · {signer.when}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-positive">
        <FileSignature className="h-4 w-4" aria-hidden /> Signed · copy saved on the job
      </p>
    </div>
  );
}

const STOPS: { time: string; title: string; detail: string; icon: typeof Clock; tone: string }[] = [
  { time: "8:00 AM", title: `#${DEMO_JOB.number} · ${DEMO_CUSTOMER.name}`, detail: `${DEMO_JOB.work} · ${DEMO_JOB.technician}`, icon: MapPin, tone: "text-brand" },
  { time: "12:15 PM", title: "Supply house", detail: "Pick up the 2/0 SER and meter base", icon: Truck, tone: "text-ink-muted" },
  { time: "1:00 PM", title: "#1043 · Recessed lighting", detail: "Kitchen, six cans · Jordan Ellis", icon: MapPin, tone: "text-brand" },
];

function ScheduleScreen() {
  return (
    <div>
      <ScreenTitle title="Today · Tuesday" detail="3 stops · 38 mi · leave by 7:25 AM" />
      <ol className="relative space-y-3 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-line">
        {STOPS.map(({ time, title, detail, icon: Icon, tone }) => (
          <li key={title} className="relative flex items-start gap-3">
            <span className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-surface ${tone}`}>
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 rounded-control border border-line p-3">
              <p className="text-xs font-semibold text-ink-faint">{time}</p>
              <p className="truncate text-sm font-semibold">{title}</p>
              <p className="truncate text-xs text-ink-muted">{detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 grid grid-cols-5 gap-1.5 text-center text-[11px]">
        {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => (
          <span
            key={day}
            className={`rounded-control border py-2 ${day === "Tue" ? "border-brand/40 bg-brand/[0.1] font-semibold text-brand" : "border-line text-ink-muted"}`}
          >
            {day}
          </span>
        ))}
      </div>
    </div>
  );
}

function PaidScreen() {
  const invoice = demoInvoice();
  const rows: [string, string][] = [
    ["Labor and materials", formatCents(invoice.subtotalCents)],
    ["Diagnostic paid online", `−${formatCents(invoice.diagnosticCreditCents)}`],
    ["Tax", formatCents(invoice.taxCents)],
  ];
  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold tracking-tight">Invoice INV-{DEMO_JOB.invoiceNumber}</p>
          <p className="text-xs text-ink-muted">
            {DEMO_CUSTOMER.name} · {DEMO_JOB.work}
          </p>
        </div>
        <span className={BRAND}>Sent by text</span>
      </div>
      <div className="rounded-control border border-line bg-white/[0.015] p-3">
        <LineRows lines={DEMO_LINES.slice(0, 2)} />
        <dl className="mt-2 space-y-1.5 border-t border-line pt-2 text-sm">
          {rows.map(([name, value]) => (
            <div key={name} className="flex justify-between gap-3">
              <dt className="text-ink-muted">{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3 border-t border-line pt-2 font-semibold">
            <dt>Due</dt>
            <dd>{formatCents(invoice.totalCents)}</dd>
          </div>
        </dl>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-ink-muted">
          <Check className="h-3.5 w-3.5 text-positive" aria-hidden /> Viewed by {DEMO_CUSTOMER.firstName} · pay link included
        </p>
        <span className="inline-flex min-h-9 items-center rounded-control bg-brand px-3 text-xs font-bold text-on-brand">Record payment</span>
      </div>
    </div>
  );
}
