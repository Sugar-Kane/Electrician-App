import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  Calculator,
  CalendarCheck2,
  CalendarDays,
  Camera,
  Check,
  FileSignature,
  NotebookPen,
  Package,
  ReceiptText,
  Route,
  Users,
  UsersRound,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { JobHeader, LineRows, StageTrack, WORKFLOW_PRIMARY, WorkflowHeadline } from "@/components/demo-job-parts";
import { ButtonLink } from "@/components/ui/button";
import { VideoCarousel } from "@/components/video-carousel";
import {
  DEMO_CUSTOMER,
  DEMO_JOB,
  DEMO_LINES,
  JOB_STAGES,
  demoEstimateLabel,
  demoTotals,
  jobStatusAt,
  type JobStage,
} from "@/lib/demo-job";
import { formatCents } from "@/lib/job-lines";
import type { SiteVideo } from "@/lib/site-videos";

/**
 * What a visitor to volteira.com sees: one job, from the price to the bill,
 * and two ways in — an account, or the demo.
 *
 * It sells continuity rather than a list of features. The six stages a job
 * moves through are the spine of the page, and the picture at the top is the
 * demo's own job, drawn by the same components /demo uses.
 *
 * Every claim here is something the app does today. A front page that promises
 * more than the product delivers loses the customer on their first day, which
 * is why the stages say what each one does: "estimate" is the job's priced
 * lines, and "paid" is what is still owed, until the app can record a payment.
 */

type Phase = {
  title: string;
  body: string;
  points: string[];
  stages: [JobStage, JobStage];
};

/**
 * The six stages in pairs, each pair with what it does for the business.
 *
 * Under its two stages rather than in a section of its own, so the workflow
 * and what it is worth are read once, together. On a phone that is half the
 * scrolling of saying them separately.
 */
const PHASES: Phase[] = [
  {
    title: "Quote the job",
    body: "Price it once. The same lines carry into the contract and the invoice.",
    points: ["Labor pricing", "Material pricing", "Contracts"],
    stages: [JOB_STAGES[0], JOB_STAGES[1]],
  },
  {
    title: "Run the job",
    body: "Schedule the work and keep what your team needs attached to the job.",
    points: ["Scheduling", "Materials", "Photos and notes", "Job records"],
    stages: [JOB_STAGES[2], JOB_STAGES[3]],
  },
  {
    title: "Get paid",
    body: "Bill from the job without rebuilding it from scratch.",
    points: ["Invoices", "Sent by text or email", "Customer history"],
    stages: [JOB_STAGES[4], JOB_STAGES[5]],
  },
];

const CONNECTED: { icon: LucideIcon; name: string; line: string }[] = [
  { icon: Calculator, name: "Pricing", line: "Labor and parts, line by line." },
  { icon: Package, name: "Materials", line: "Keep job materials organized." },
  { icon: FileSignature, name: "Contracts", line: "Signed on the customer’s phone." },
  { icon: CalendarDays, name: "Scheduling", line: "Know what’s happening next." },
  { icon: Boxes, name: "Inventory", line: "Know what you already have." },
  { icon: Route, name: "Routes", line: "Plan the day, supply stops included." },
  { icon: Camera, name: "Photos", line: "Keep jobsite photos with the job." },
  { icon: NotebookPen, name: "Job notes", line: "Saved as you type." },
  { icon: ReceiptText, name: "Invoices", line: "Sent by text or email." },
  { icon: CalendarCheck2, name: "Online booking", line: "Customers book and prepay the visit." },
  { icon: Users, name: "Customer records", line: "Every job, for every customer." },
  { icon: UsersRound, name: "Team calendar", line: "See who’s working where." },
];

const EYEBROW = "text-xs font-semibold uppercase tracking-[0.18em] text-brand";
const SECTION_HEADING = "mt-3 text-[1.75rem] font-semibold leading-tight tracking-tight text-balance sm:text-4xl";

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <Link
      href="/"
      className={`inline-flex min-h-11 items-center gap-2.5 whitespace-nowrap font-bold tracking-[0.04em] text-ink ${
        small ? "text-base" : "text-base sm:text-lg"
      }`}
    >
      <span
        className={`grid place-items-center rounded-control bg-brand text-on-brand ${
          small ? "h-8 w-8" : "h-9 w-9 sm:h-10 sm:w-10"
        }`}
      >
        <Zap className="h-5 w-5 fill-current" aria-hidden />
      </span>
      {/* The mark alone on the narrowest phones, where the word and both
          buttons do not fit on one line. It is still read out. */}
      <span className="max-[359px]:sr-only">VOLTEIRA</span>
    </Link>
  );
}

/** The demo's job, part-way through: priced, signed, on the calendar. */
function HeroPreview() {
  const totals = demoTotals();
  const shown = DEMO_LINES.slice(0, 3);

  return (
    <div className="relative mx-auto mt-9 max-w-4xl motion-safe:animate-rise sm:mt-14">
      <div
        role="img"
        aria-label={`A job in Volteira: ${DEMO_CUSTOMER.name}’s ${DEMO_JOB.work}, estimated at ${demoEstimateLabel()}. The estimate and contract are done, and the work is scheduled for Tuesday.`}
        className="rounded-panel border border-line bg-surface p-4 text-left shadow-2xl shadow-black/40 sm:p-6"
      >
        <JobHeader status={jobStatusAt("schedule")} />

        <div className="mt-5 border-t border-line pt-5">
          <StageTrack current="schedule" details={{ estimate: "Priced", contract: "Signed", schedule: "Tue 8 AM" }} />
        </div>

        {/* The rest of the job page, from a tablet up. On a phone the header
            and the stages say enough, and the page goes on to say the rest. */}
        <div className="mt-5 hidden gap-6 border-t border-line pt-5 sm:grid sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Work &amp; materials</p>
              <p className="text-sm font-semibold">{formatCents(totals.subtotalCents)}</p>
            </div>
            <div className="mt-1">
              <LineRows lines={shown} />
            </div>
            <p className="mt-1 text-xs text-ink-faint">+ {DEMO_LINES.length - shown.length} more lines</p>
          </div>
          <ul className="space-y-4">
            <Fact icon={CalendarDays} title={`Tuesday · ${DEMO_JOB.hours}`} detail={`Assigned to ${DEMO_JOB.technician}`} />
            <Fact icon={FileSignature} title="Contract signed" detail={`By ${DEMO_CUSTOMER.name}, on her phone`} />
            <Fact icon={CalendarCheck2} title="Diagnostic fee paid online" detail="$180.00, taken off the invoice" />
          </ul>
        </div>
      </div>
    </div>
  );
}

function Fact({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip border border-line bg-white/[0.04] text-brand">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="block text-sm text-ink-muted">{detail}</span>
      </span>
    </li>
  );
}

/** The same job on the phone in the van: mid-job, with one button to finish it. */
function FieldPreview() {
  const totals = demoTotals();

  return (
    // Cropped on a phone, where the whole handset would be a screen of its own.
    <div className="relative mx-auto max-h-[10.5rem] w-full max-w-[19.5rem] overflow-hidden sm:max-h-none">
      <div
        role="img"
        aria-label="The same job on a phone, mid-job: work started at 8:06 AM, the labor and parts on the job, before and after photos, and one button to finish."
        className="rounded-[2.5rem] border border-line-strong bg-[#030b11] p-2.5 shadow-2xl shadow-black/50"
      >
        <div className="rounded-[2rem] border border-line bg-canvas px-4 pb-5 pt-4">
          <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-white/10" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Job #{DEMO_JOB.number}</p>
          <p className="mt-1 text-lg font-semibold">{DEMO_CUSTOMER.name}</p>

          <div className="mt-3 rounded-panel border border-line bg-surface p-4">
            <WorkflowHeadline state="working" detail="Started 8:06 AM" />
          </div>

          <div className="mt-3 rounded-panel border border-line bg-surface px-3.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 text-sm font-semibold">Work &amp; materials</p>
              <p className="shrink-0 whitespace-nowrap text-sm font-semibold">{formatCents(totals.subtotalCents)}</p>
            </div>
            <LineRows lines={DEMO_LINES.slice(2, 4)} />
            <p className="mt-3 text-sm font-semibold">Photos</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {["Before", "After"].map((label) => (
                <span
                  key={label}
                  className="grid aspect-[4/3] place-items-center rounded-control border border-dashed border-line text-xs text-ink-faint"
                >
                  <span className="flex flex-col items-center gap-1">
                    <Camera className="h-4 w-4" aria-hidden />
                    {label}
                  </span>
                </span>
              ))}
            </div>
          </div>

          <span className={`${WORKFLOW_PRIMARY} mt-3`}>Finish job</span>
        </div>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-canvas to-transparent sm:hidden"
      />
    </div>
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

      {/* Sticky from a tablet up, where Create account stays in reach. A phone
          keeps the bar out of the way: the hero's own buttons are right below. */}
      <header className="z-40 px-4 sm:sticky sm:top-0 sm:border-b sm:border-line/60 sm:bg-canvas/85 sm:px-6 sm:backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 py-3">
          <Logo />
          <nav className="flex shrink-0 items-center gap-1.5 sm:gap-2" aria-label="Main">
            <ButtonLink href="/demo" variant="secondary" className="whitespace-nowrap">
              Demo
            </ButtonLink>
            <ButtonLink href="/login" variant="ghost" className="whitespace-nowrap">
              Sign in
            </ButtonLink>
            {/* Hidden by a wrapper rather than on the link, whose own
                `inline-flex` would win over `hidden`. */}
            <span className="hidden sm:block">
              <ButtonLink href="/signup" className="whitespace-nowrap">
                Create account
              </ButtonLink>
            </span>
          </nav>
        </div>
      </header>

      <main id="main-content">
        <section className="relative overflow-hidden px-4 pb-12 pt-7 sm:px-6 sm:pb-20 sm:pt-16" aria-labelledby="hero-heading">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,194,28,.11),transparent_62%)]"
          />
          <div className="relative mx-auto max-w-3xl text-center">
            <p className={EYEBROW}>For electrical contractors</p>
            <h1 id="hero-heading" className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Run the business.
              <br />
              Power every job.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-pretty text-ink-muted sm:text-lg sm:leading-8">
              Volteira keeps estimates, materials, contracts, scheduling, job records, invoices, and payments together
              in one place built for electrical contractors.
            </p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <ButtonLink href="/signup" size="lg" className="px-6">
                Create free account <ArrowRight className="h-4 w-4" aria-hidden />
              </ButtonLink>
              <ButtonLink href="/demo" variant="secondary" size="lg" className="px-6">
                Try the demo
              </ButtonLink>
            </div>
            <p className="mt-4 text-sm text-ink-muted">No credit card required</p>
          </div>

          <HeroPreview />
        </section>

        <section id="workflow" className="px-4 py-12 sm:px-6 sm:py-14 lg:py-20" aria-labelledby="workflow-heading">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-2xl">
              <p className={EYEBROW}>One job. One workflow.</p>
              <h2 id="workflow-heading" className={SECTION_HEADING}>
                From estimate to paid.
              </h2>
              <p className="mt-4 text-base leading-7 text-pretty text-ink-muted">
                Everything your team needs follows the job from the first quote to the final payment.
              </p>
            </div>

            <div className="relative mt-8 lg:mt-10">
              {/* One line under all six stages, on a screen wide enough to put
                  them in a row: from the first circle to the last. */}
              <span
                aria-hidden
                className="workflow-line pointer-events-none absolute left-5 right-[calc((100%_-_3rem)/6_-_1.625rem)] top-5 hidden h-0.5 rounded-full bg-gradient-to-r from-brand via-brand/60 to-brand/25 lg:block"
              />
              {/*
                Two shapes from one list. On a wide screen the six stages run
                in a row with each pair's card underneath, the rows shared
                across the three columns (subgrid) so the cards line up. Below
                that each pair is one card, the stages inside it, which is half
                the height of stacking stages and cards separately.
              */}
              <ol className="grid gap-3 lg:grid-cols-3 lg:grid-rows-[auto_1fr] lg:gap-x-6 lg:gap-y-5">
                {PHASES.map((phase, phaseIndex) => (
                  <li
                    key={phase.title}
                    className="flex flex-col rounded-panel border border-line bg-surface p-4 sm:p-5 lg:row-span-2 lg:grid lg:grid-rows-subgrid lg:border-0 lg:bg-transparent lg:p-0"
                  >
                    <article className="lg:rounded-panel lg:border lg:border-line lg:bg-surface lg:p-5 lg:transition lg:hover:border-line-strong">
                      <h3 className="text-lg font-semibold">{phase.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-ink-muted lg:mt-2">{phase.body}</p>
                      <ul className="mt-4 hidden flex-wrap gap-2 lg:flex">
                        {phase.points.map((point) => (
                          <li
                            key={point}
                            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.03] px-3 py-1.5 text-sm text-ink"
                          >
                            <Check className="h-3.5 w-3.5 text-positive" aria-hidden />
                            {point}
                          </li>
                        ))}
                      </ul>
                    </article>
                    <ol
                      className="mt-3 grid gap-2.5 border-t border-line pt-3 sm:mt-4 sm:grid-cols-2 sm:gap-3 sm:pt-4 lg:order-first lg:mt-0 lg:border-0 lg:pt-0"
                      start={phaseIndex * 2 + 1}
                    >
                      {phase.stages.map((stage, stageIndex) => (
                        <li key={stage.id} className="flex items-start gap-3 lg:block">
                          <span
                            aria-hidden
                            className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full border border-brand/40 bg-surface text-xs font-bold text-brand lg:h-10 lg:w-10 lg:bg-canvas lg:text-sm"
                          >
                            {phaseIndex * 2 + stageIndex + 1}
                          </span>
                          <p className="min-w-0 text-sm leading-6 text-ink-muted lg:mt-3">
                            <span className="mr-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink lg:mr-0 lg:block">
                              {stage.name}
                            </span>
                            <span className="lg:mt-1 lg:block">{stage.line}</span>
                          </p>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section
          className="border-y border-line bg-surface/50 px-4 py-12 sm:px-6 sm:py-14 lg:py-20"
          aria-labelledby="connected-heading"
        >
          <div className="mx-auto max-w-6xl">
            <p className={EYEBROW}>Built around the job</p>
            <h2 id="connected-heading" className={SECTION_HEADING}>
              Everything stays connected.
            </h2>
            {/* On a phone, the names: two columns of a word or two each say
                enough, at a third of the height. The line under each joins
                them from a tablet up. */}
            <ul className="mt-7 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-6 lg:mt-10 lg:grid-cols-4 lg:gap-x-8">
              {CONNECTED.map(({ icon: Icon, name, line }) => (
                <li key={name} className="flex min-w-0 items-center gap-3 sm:items-start">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip border border-line bg-white/[0.04] text-brand">
                    <Icon className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{name}</span>
                    <span className="mt-0.5 hidden text-sm leading-5 text-ink-muted sm:block">{line}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="demo" className="px-4 py-12 sm:px-6 sm:py-14 lg:py-20" aria-labelledby="demo-heading">
          <div className="mx-auto grid max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
            <div>
              <h2 id="demo-heading" className="text-[1.75rem] font-semibold leading-tight tracking-tight text-balance sm:text-4xl">
                See how a job moves through Volteira.
              </h2>
              <p className="mt-4 text-base leading-7 text-ink-muted">Explore the workflow without creating an account.</p>
              <ButtonLink href="/demo" size="lg" className="mt-7 px-6">
                Try the demo <ArrowRight className="h-4 w-4" aria-hidden />
              </ButtonLink>
            </div>
            {/* The walkthrough videos once support has added some, and the
                job itself until then: a picture of the product either way,
                never a promise of one. */}
            <div className="min-w-0">{videos.length > 0 ? <VideoCarousel videos={videos} /> : <FieldPreview />}</div>
          </div>
        </section>

        <section className="px-4 pb-12 sm:px-6 sm:pb-16 lg:pb-24" aria-labelledby="closing-heading">
          <div className="mx-auto max-w-6xl rounded-panel border border-brand/25 bg-brand/[0.06] px-5 py-9 text-center sm:px-10 sm:py-14">
            <span className="mx-auto hidden h-11 w-11 place-items-center rounded-control bg-brand text-on-brand sm:grid">
              <Zap className="h-5 w-5 fill-current" aria-hidden />
            </span>
            <h2 id="closing-heading" className="text-[1.75rem] font-semibold leading-tight tracking-tight text-balance sm:mt-5 sm:text-4xl">
              Spend less time running the office.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-ink-muted">
              Keep your jobs, customers, materials, and paperwork in one place.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <ButtonLink href="/signup" size="lg" className="px-6">
                Create free account <ArrowRight className="h-4 w-4" aria-hidden />
              </ButtonLink>
              <ButtonLink href="/demo" variant="secondary" size="lg" className="px-6">
                Try the demo
              </ButtonLink>
            </div>
            <p className="mt-4 text-sm text-ink-muted">No credit card required</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-line px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Logo small />
            <p className="text-sm text-ink-faint">© {new Date().getFullYear()} Volteira</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 text-sm">
            <Link href="/demo" className="inline-flex min-h-11 items-center text-ink-muted transition hover:text-ink">
              Demo
            </Link>
            <Link href="/login" className="inline-flex min-h-11 items-center text-ink-muted transition hover:text-ink">
              Sign in
            </Link>
            <Link href="/signup" className="inline-flex min-h-11 items-center text-ink-muted transition hover:text-ink">
              Create account
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
