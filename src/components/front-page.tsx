import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  Bot,
  CalendarCheck2,
  Camera,
  Check,
  FileSignature,
  MessageSquareText,
  Package,
  PhoneCall,
  ReceiptText,
  Route,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { ButtonLink } from "@/components/ui/button";
import { VideoCarousel } from "@/components/video-carousel";
import type { SiteVideo } from "@/lib/site-videos";

/**
 * What a visitor to volteira.com sees: what the product does, the walkthrough
 * videos, and the way in.
 *
 * Every claim here is something the app does today. A front page that promises
 * more than the product delivers loses the customer on their first day.
 */

type Headline = {
  icon: LucideIcon;
  label: string;
  title: string;
  body: string;
  points: string[];
};

const HEADLINES: Headline[] = [
  {
    icon: PhoneCall,
    label: "AI receptionist",
    title: "Every call answered, even when you’re up a ladder",
    body: "Maya answers your business line and your texts at any hour, in English or Spanish. She finds out what’s wrong, asks the safety questions, and books the customer into a time you actually have open.",
    points: [
      "Books into real openings on your schedule",
      "Hands the call to you when a caller asks for a person",
      "Every answer saved on the job before you drive out",
    ],
  },
  {
    icon: ReceiptText,
    label: "Automatic invoicing",
    title: "The invoice builds itself from the job",
    body: "The work and parts you log on a job become the invoice, one tap from going to the customer by text or email. Fees they’ve already paid come off, and anything added later is billed as the difference, never twice.",
    points: [
      "Lines come straight from the job’s work and parts",
      "A diagnostic fee paid at booking is credited automatically",
      "Work added after the invoice goes out is billed on its own",
    ],
  },
  {
    icon: CalendarCheck2,
    label: "Diagnostics & work orders",
    title: "Booked and paid before you roll the truck",
    body: "Customers book a diagnostic online and pay the fee up front, choosing from times your schedule can keep. When it turns into a job, book the work order from the diagnostic and the customer, address and notes come with it.",
    points: [
      "Online booking with the diagnostic fee paid up front",
      "Work orders booked straight from the diagnostic",
      "Paid bookings can go straight onto your Google Calendar",
    ],
  },
];

const MORE: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: FileSignature,
    title: "Contracts signed on a phone",
    body: "Text a signing link or hand over your phone. Work added after signing goes on a change order.",
  },
  {
    icon: Package,
    title: "Inventory that keeps count",
    body: "Parts used on a job come off the count, so you know what you have before you need it.",
  },
  {
    icon: Route,
    title: "Routes with supply stops",
    body: "Line up the day with a Lowe’s or Home Depot stop on the way, then open it in Google or Apple Maps.",
  },
  {
    icon: MessageSquareText,
    title: "Every text in one place",
    body: "Two-way texting with customers, and an automatic text when you’re on the way and when you arrive.",
  },
  {
    icon: Camera,
    title: "Before and after photos",
    body: "Take them on the job or upload them later. They stay with the job, where you’ll look for them.",
  },
  {
    icon: Bot,
    title: "An assistant that knows the business",
    body: "Ask who still owes you or what’s on tomorrow, and get a straight answer from your own records.",
  },
];

/** What happens while the electrician is busy, drawn as the day's feed. */
const DAY = [
  { icon: PhoneCall, title: "Maya answered a call", detail: "Breaker keeps tripping · diagnostic booked for Thursday, 8–10 AM" },
  { icon: CalendarCheck2, title: "Diagnostic fee paid online", detail: "On the schedule before anybody called you" },
  { icon: ReceiptText, title: "Invoice sent by text", detail: "Built from the job’s work and parts, diagnostic fee credited" },
];

function Logo() {
  return (
    <Link href="/" className="inline-flex min-h-12 items-center gap-3 whitespace-nowrap text-lg font-bold tracking-[0.04em] text-ink">
      <span className="grid h-10 w-10 place-items-center rounded-control bg-brand text-on-brand">
        <Zap className="h-5 w-5 fill-current" aria-hidden />
      </span>
      VOLTEIRA
    </Link>
  );
}

export function FrontPage({ videos, preview = false }: { videos: SiteVideo[]; preview?: boolean }) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      {preview ? (
        <div className="border-b border-brand/25 bg-brand/[0.08] px-4 py-3 text-sm">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="text-ink">You’re signed in. This is the front page visitors see.</p>
            <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-brand">
              Back to your dashboard <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      ) : null}

      <header className="px-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 py-4">
          <Logo />
          <nav className="flex shrink-0 items-center gap-2" aria-label="Account">
            <ButtonLink href="/login" variant="ghost" className="whitespace-nowrap">
              Sign in
            </ButtonLink>
            {/* Hidden by a wrapper rather than on the link, whose own
                `inline-flex` would win over `hidden`. A phone has Create your
                account a thumb's width below anyway. */}
            <span className="hidden sm:block">
              <ButtonLink href="/signup" className="whitespace-nowrap">
                Get started
              </ButtonLink>
            </span>
          </nav>
        </div>
      </header>

      <main id="main-content">
        <section className="relative overflow-hidden px-4 pb-16 pt-8 sm:px-6 sm:pt-14 lg:pb-24">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(255,191,24,.13),transparent_32%),radial-gradient(circle_at_85%_70%,rgba(25,105,145,.22),transparent_38%)]" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)] lg:gap-14">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">For electrical contractors</p>
              <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
                Run the business.
                <br />
                Power every job.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-ink-muted sm:text-lg sm:leading-8">
                Volteira answers your phone, books diagnostics and work orders into your real schedule, and turns
                the work on each job into an invoice. You stay on the tools.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/signup" size="lg" className="px-6">
                  Create your account <ArrowRight className="h-4 w-4" aria-hidden />
                </ButtonLink>
                <ButtonLink href="/login" variant="secondary" size="lg" className="px-6">
                  Sign in
                </ButtonLink>
              </div>
              <a
                href="#how-it-works"
                className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink-muted transition hover:text-ink"
              >
                <ArrowDown className="h-4 w-4" aria-hidden /> See how it works
              </a>
            </div>

            <div className="rounded-panel border border-line bg-surface/80 p-5 shadow-2xl shadow-black/30 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">While you’re on a job</p>
              <ul className="mt-4 space-y-3">
                {DAY.map(({ icon: Icon, title, detail }) => (
                  <li key={title} className="flex items-start gap-3 rounded-control border border-line bg-raised p-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-chip bg-brand/10 text-brand">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{title}</span>
                      <span className="mt-0.5 block text-sm leading-6 text-ink-muted">{detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="px-4 py-16 sm:px-6 lg:py-20" aria-labelledby="features-heading">
          <div className="mx-auto max-w-6xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">What it does for you</p>
            <h2 id="features-heading" className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
              The office work, handled
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-ink-muted">
              Answering the phone, booking the visit and billing for it. Volteira does all three and hands you the job.
            </p>

            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              {HEADLINES.map(({ icon: Icon, label, title, body, points }) => (
                <article key={label} className="flex flex-col rounded-panel border border-line bg-surface p-6">
                  <span className="grid h-12 w-12 place-items-center rounded-control bg-brand text-on-brand">
                    <Icon className="h-6 w-6" aria-hidden />
                  </span>
                  <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-brand">{label}</p>
                  <h3 className="mt-2 text-xl font-semibold leading-snug">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-ink-muted">{body}</p>
                  <ul className="mt-5 space-y-2.5 border-t border-line pt-5">
                    {points.map((point) => (
                      <li key={point} className="flex items-start gap-2.5 text-sm leading-6 text-ink">
                        <Check className="mt-1 h-4 w-4 shrink-0 text-positive" aria-hidden />
                        {point}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 pb-16 sm:px-6 lg:pb-20" aria-labelledby="more-heading">
          <div className="mx-auto max-w-6xl">
            <h2 id="more-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              And the rest of the day
            </h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {MORE.map(({ icon: Icon, title, body }) => (
                <article key={title} className="rounded-panel border border-line bg-surface p-5">
                  <span className="grid h-10 w-10 place-items-center rounded-chip border border-line bg-white/5 text-brand">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink-muted">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-4 px-4 pb-16 sm:px-6 lg:pb-24" aria-labelledby="videos-heading">
          <div className="mx-auto max-w-4xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">See it work</p>
            <h2 id="videos-heading" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Watch Volteira on the job
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-ink-muted">
              Short walkthroughs of the app doing the work: a call answered, a diagnostic booked, an invoice sent.
            </p>
            <div className="mt-8">
              <VideoCarousel videos={videos} />
            </div>
          </div>
        </section>

        <section className="px-4 pb-16 sm:px-6 lg:pb-24">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[32px] border border-line bg-[#081925] px-6 py-12 text-center sm:px-10 sm:py-16">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,191,24,.16),transparent_45%)]" />
            <div className="relative">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Get your evenings back</h2>
              <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-ink-muted">
                Create your account and set up your business in a few minutes.
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <ButtonLink href="/signup" size="lg" className="px-6">
                  Create your account <ArrowRight className="h-4 w-4" aria-hidden />
                </ButtonLink>
                <ButtonLink href="/login" variant="secondary" size="lg" className="px-6">
                  Sign in
                </ButtonLink>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 text-sm text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Volteira</p>
          <p>Built for owner-operated electrical contractors</p>
        </div>
      </footer>
    </div>
  );
}
