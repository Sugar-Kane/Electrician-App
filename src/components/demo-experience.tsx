"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Clock,
  Clock3,
  ImagePlus,
  Info,
  Mail,
  MessageSquare,
  Package,
  RotateCcw,
  Send,
  type LucideIcon,
} from "lucide-react";

import { ContractPaper } from "@/components/contract-paper";
import { documentFont } from "@/components/document-font";
import { JobHeader, LineRows, StageTrack, WORKFLOW_PRIMARY, WorkflowHeadline } from "@/components/demo-job-parts";
import { SignatureInput, type SignatureValue } from "@/components/signature-input";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button";
import { fingerprintOf, readPrintedName } from "@/lib/contract-signing";
import {
  BOOKED_WEEKDAY,
  DEMO_BUSINESS,
  DEMO_CUSTOMER,
  DEMO_JOB,
  DEMO_LINES,
  JOB_STAGES,
  WEEK_JOBS,
  demoCalendar,
  demoContract,
  demoHistory,
  demoInvoice,
  demoTotals,
  jobStatusAt,
  shortDate,
  signedAtLabel,
  stageIndex,
  type DemoCalendar,
  type DemoDay,
  type JobStageId,
} from "@/lib/demo-job";
import { formatCents, formatQuantity, lineTotalCents } from "@/lib/job-lines";
import { nextStep } from "@/lib/job-workflow";
import type { ContractSignature } from "@/lib/pdf/contract-document";

/**
 * /demo: one sample job, worked from the price to the bill, with nothing saved.
 *
 * It is the app's own screens where the app has one that can stand alone —
 * the contract is ContractPaper, the signature is SignatureInput, the lines and
 * the visit's status are drawn as the job page draws them — and the app's own
 * words on the buttons. A visitor should come away having used Volteira, not
 * read another page about it.
 *
 * Nothing here can change anything. There is no server action, no fetch and no
 * database client in this file or under it: every step is state in this one
 * component, gone when the tab closes. What would reach outside in the real
 * app — saving a line, texting a customer, uploading a photo, sending an
 * invoice — stops at a message saying so, beside the button that was pressed.
 */

const STAGE_TITLES: Record<JobStageId, string> = {
  estimate: "Price the job",
  contract: "Contract",
  schedule: "Schedule",
  work: "On the job",
  invoice: "Invoice",
  paid: "Getting paid",
};

const CAPTIONS: Record<JobStageId, string> = {
  estimate:
    "Sarah booked a diagnostic online and paid for it. Now price the upgrade: these lines carry through to the contract and the invoice.",
  contract: "The price fills in your agreement, already signed for the business. Sign it the way Sarah would.",
  schedule: "Put the work on the calendar. Tap another day to move it.",
  work: "On the day, the work, the parts, the photos and the notes are on one page.",
  invoice: "Built from the same lines, with the fee Sarah paid at booking taken off.",
  paid: "What Sarah owes, and everything on her customer record, in one place.",
};

const STARTING_NOTES =
  "Old panel had three double-tapped breakers. Labeled every circuit in the new panel.";

const CARD = "rounded-panel border border-line bg-surface p-4 sm:p-5";
const SECONDARY =
  "tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-semibold transition hover:border-line-strong disabled:opacity-50";
const NEXT = `${WORKFLOW_PRIMARY} transition hover:bg-brand-strong`;

/** The fingerprint printed under a signature: the start of the body's SHA-256, as the app prints it. */
async function fingerprintFor(body: string): Promise<string> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    return fingerprintOf(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
  } catch {
    // No Web Crypto outside a secure page. Two 32-bit FNV-1a passes stand in:
    // it is a sample, and a fingerprint that is there beats one that is blank.
    let a = 0x811c9dc5;
    let b = 0x01000193;
    for (let index = 0; index < body.length; index += 1) {
      a = Math.imul(a ^ body.charCodeAt(index), 0x01000193) >>> 0;
      b = Math.imul(b ^ body.charCodeAt(body.length - 1 - index), 0x811c9dc5) >>> 0;
    }
    return fingerprintOf(`${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`);
  }
}

export function DemoExperience({ todayIso }: { todayIso: string }) {
  const calendar = useMemo(() => demoCalendar(todayIso), [todayIso]);
  const [stage, setStage] = useState<JobStageId>("estimate");
  const [notice, setNotice] = useState("");
  const [signature, setSignature] = useState<ContractSignature | null>(null);
  const [dayIndex, setDayIndex] = useState(BOOKED_WEEKDAY);
  const [notes, setNotes] = useState(STARTING_NOTES);

  const job = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const workDay = calendar.week[dayIndex] ?? calendar.week[BOOKED_WEEKDAY];
  const contract = useMemo(
    () => demoContract({ calendar, workDay, signature: signature ?? undefined }),
    [calendar, workDay, signature],
  );
  const at = stageIndex(stage);

  const go = useCallback((next: JobStageId) => {
    moved.current = true;
    setNotice("");
    setStage(next);
  }, []);

  // After a move, and only after one: the new stage's heading takes focus, so
  // a screen reader starts reading the stage rather than staying on a button
  // that has gone. When the move came from the bottom of a long stage, the
  // page goes back up to the job and its stages.
  useEffect(() => {
    if (!moved.current) return;
    heading.current?.focus({ preventScroll: true });
    const card = job.current;
    if (card && card.getBoundingClientRect().top < 0) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }, [stage]);

  async function sign(value: SignatureValue, name: string) {
    const fingerprint = await fingerprintFor(contract.body);
    setSignature({
      method: value.method,
      name,
      image: value.method === "drawn" ? value.image : "",
      signedLabel: signedAtLabel(new Date()),
      fingerprint,
    });
  }

  function restart() {
    setSignature(null);
    setDayIndex(BOOKED_WEEKDAY);
    setNotes(STARTING_NOTES);
    go("estimate");
  }

  const panel: Record<JobStageId, ReactNode> = {
    estimate: <EstimatePanel notice={notice} onDemoAction={setNotice} onNext={() => go("contract")} />,
    contract: (
      <ContractPanel
        contract={contract}
        signature={signature}
        onSign={sign}
        notice={notice}
        onDemoAction={setNotice}
        onNext={() => go("schedule")}
      />
    ),
    schedule: (
      <SchedulePanel
        calendar={calendar}
        dayIndex={dayIndex}
        onPickDay={setDayIndex}
        notice={notice}
        onDemoAction={setNotice}
        onNext={() => go("work")}
      />
    ),
    work: (
      <WorkPanel notes={notes} onNotes={setNotes} notice={notice} onDemoAction={setNotice} onNext={() => go("invoice")} />
    ),
    invoice: <InvoicePanel workDay={workDay} notice={notice} onDemoAction={setNotice} onNext={() => go("paid")} />,
    paid: <PaidPanel calendar={calendar} workDay={workDay} signed={Boolean(signature)} onRestart={restart} />,
  };

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-40 border-b border-line/60 bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              aria-label="Back to Volteira"
              className="tap-target inline-flex min-h-11 items-center gap-2 rounded-control pr-1 text-sm font-semibold text-ink-muted transition hover:text-ink"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden sm:inline">Back to Volteira</span>
              <span className="sm:hidden">Volteira</span>
            </Link>
            <span className="hidden rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand sm:inline-flex">
              Demo
            </span>
          </div>
          <ButtonLink href="/signup" className="whitespace-nowrap">
            Create your account
          </ButtonLink>
        </div>
      </header>

      <p className="border-b border-line bg-brand/[0.05] px-4 py-2 text-center text-sm text-ink-muted">
        <span className="font-semibold text-brand sm:hidden">Demo · </span>A sample job. Nothing here is saved.
      </p>

      <main id="main-content" className="mx-auto max-w-4xl px-4 pb-16 pt-5 sm:px-6 sm:pt-8">
        <section ref={job} aria-label="The job" className="scroll-mt-24 rounded-panel border border-line bg-surface p-4 sm:p-6">
          <JobHeader status={jobStatusAt(stage)} titleAs="h1" />
          <div className="mt-5 border-t border-line pt-4">
            <StageTrack
              current={stage}
              onSelect={go}
              label="Stages of the job"
              details={{
                estimate: "$4,850",
                contract: signature ? "Signed" : "To sign",
                schedule: `${workDay.weekday} 8 AM`,
              }}
            />
          </div>
        </section>

        <section className="mt-6" aria-labelledby="demo-stage-heading">
          {/* Keyed by stage, so each one arrives rather than being swapped in place. */}
          <div key={stage} className="motion-safe:animate-rise">
            <div className="px-1">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">
                Step {at + 1} of {JOB_STAGES.length}
              </p>
              <h2 id="demo-stage-heading" ref={heading} tabIndex={-1} className="mt-1 text-2xl font-semibold tracking-tight">
                {STAGE_TITLES[stage]}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">{CAPTIONS[stage]}</p>
            </div>
            <div className="mt-4">{panel[stage]}</div>
          </div>
        </section>
      </main>
    </div>
  );
}

/**
 * Where a press that would save, send or upload in the real app ends up.
 *
 * The region is always there and only its words come and go, which is what
 * makes a screen reader announce them. Beside the button that was pressed,
 * rather than in a toast at the edge of the screen, because that is where the
 * person is looking.
 */
function DemoNotice({ show }: { show: boolean }) {
  return (
    <div role="status">
      {show ? (
        <p className="mt-3 flex items-start gap-2 rounded-control border border-brand/30 bg-brand/[0.08] p-3 text-sm leading-6 text-ink">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
          <span>
            This is a demo.{" "}
            <Link href="/signup" className="font-semibold text-brand underline underline-offset-4">
              Create a free account
            </Link>{" "}
            to start your own job.
          </span>
        </p>
      ) : null}
    </div>
  );
}

function DemoAction({
  id,
  icon: Icon,
  onPress,
  className = "",
  disabled = false,
  children,
}: {
  id: string;
  icon: LucideIcon;
  onPress: (id: string) => void;
  className?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={() => onPress(id)} disabled={disabled} className={`${SECONDARY} ${className}`}>
      <Icon className="h-4 w-4" aria-hidden />
      {children}
    </button>
  );
}

function NextButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={NEXT}>
      {children}
      <ArrowRight className="h-5 w-5" aria-hidden />
    </button>
  );
}

function WorkAndMaterials({ notice, onDemoAction }: { notice: string; onDemoAction: (id: string) => void }) {
  const totals = demoTotals();
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Work &amp; materials</h3>
        <span className="text-sm font-semibold">{formatCents(totals.subtotalCents)}</span>
      </div>
      <div className="mt-2">
        <LineRows lines={DEMO_LINES} />
      </div>
      <dl className="mt-3 space-y-1 text-xs text-ink-muted">
        <div className="flex justify-between">
          <dt>Labor</dt>
          <dd>{formatCents(totals.laborCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Parts</dt>
          <dd>{formatCents(totals.materialCents)}</dd>
        </div>
      </dl>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <DemoAction id="add-labor" icon={Clock} onPress={onDemoAction}>
          Add labor
        </DemoAction>
        <DemoAction id="add-part" icon={Package} onPress={onDemoAction}>
          Add part
        </DemoAction>
      </div>
      <DemoNotice show={notice === "add-labor" || notice === "add-part"} />
    </>
  );
}

function EstimatePanel({
  notice,
  onDemoAction,
  onNext,
}: {
  notice: string;
  onDemoAction: (id: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-3">
      <section className={CARD}>
        <h3 className="text-sm font-semibold">Customer request</h3>
        <p className="mt-2 text-sm leading-6 text-ink-muted">{DEMO_JOB.finding}</p>
        <p className="mt-3 flex items-start gap-2 rounded-control bg-positive-bg p-3 text-sm leading-6 text-positive">
          <Check className="mt-1 h-4 w-4 shrink-0" aria-hidden />
          Diagnostic fee of {formatCents(DEMO_JOB.diagnosticFeeCents)} paid online when Sarah booked
        </p>
      </section>
      <section className={CARD}>
        <WorkAndMaterials notice={notice} onDemoAction={onDemoAction} />
      </section>
      <NextButton onClick={onNext}>Generate contract</NextButton>
    </div>
  );
}

/** The in-person signing sheet, as SignaturePad lays it out, minus the server. */
function SigningForm({ onSign }: { onSign: (value: SignatureValue, name: string) => Promise<void> }) {
  const [name, setName] = useState(DEMO_CUSTOMER.name);
  const [consent, setConsent] = useState(false);
  const [signing, setSigning] = useState(false);
  const [value, setValue] = useState<SignatureValue>({ method: "drawn", image: "" });
  const onChange = useCallback((next: SignatureValue) => setValue(next), []);

  const printed = readPrintedName(name);
  const ready = consent && Boolean(printed) && (value.method === "typed" || Boolean(value.image));

  async function submit(event: FormEvent<HTMLFormElement>) {
    // Never posted anywhere: the form is here for the keyboard (Enter signs)
    // and for the shape of the real one.
    event.preventDefault();
    if (!ready || signing) return;
    setSigning(true);
    await onSign(value, printed);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <SignatureInput printedName={printed} onChange={onChange} />

      <label className="block">
        <span className="text-sm font-semibold">Your full name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
          className="mt-1 block min-h-11 w-full rounded-control border border-line bg-transparent px-3 text-base"
        />
      </label>

      <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-1 h-5 w-5 shrink-0"
        />
        <span>
          I agree to sign this contract electronically, and that my electronic signature counts the same as signing it by
          hand.
        </span>
      </label>

      <button
        type="submit"
        disabled={!ready || signing}
        className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-bold text-on-brand disabled:opacity-50"
      >
        {signing ? "Signing…" : "Sign contract"}
      </button>
    </form>
  );
}

function ContractPanel({
  contract,
  signature,
  onSign,
  notice,
  onDemoAction,
  onNext,
}: {
  contract: ReturnType<typeof demoContract>;
  signature: ContractSignature | null;
  onSign: (value: SignatureValue, name: string) => Promise<void>;
  notice: string;
  onDemoAction: (id: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-3">
      <ContractPaper data={contract} />

      {signature ? (
        <>
          <Banner tone="positive">Signed by {signature.name}. The signed copy stays with the job.</Banner>
          <NextButton onClick={onNext}>Schedule the work</NextButton>
        </>
      ) : (
        <section className={CARD}>
          <h3 className="text-base font-semibold">Sign in person</h3>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            Hand your phone to Sarah, or send her a link to sign on her own. Here, you sign for her.
          </p>
          <div className="mt-4">
            <SigningForm onSign={onSign} />
          </div>
          <div className="mt-5 border-t border-line pt-4">
            <DemoAction id="send-for-signing" icon={Send} onPress={onDemoAction} className="w-full">
              Send for signing
            </DemoAction>
            <DemoNotice show={notice === "send-for-signing"} />
          </div>
        </section>
      )}
    </div>
  );
}

function SchedulePanel({
  calendar,
  dayIndex,
  onPickDay,
  notice,
  onDemoAction,
  onNext,
}: {
  calendar: DemoCalendar;
  dayIndex: number;
  onPickDay: (index: number) => void;
  notice: string;
  onDemoAction: (id: string) => void;
  onNext: () => void;
}) {
  const workDay = calendar.week[dayIndex] ?? calendar.week[BOOKED_WEEKDAY];
  const trip = nextStep("scheduled");

  return (
    <div className="space-y-3">
      <section className={CARD}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Week of {calendar.week[0]?.date}</h3>
          <p className="text-xs text-ink-faint">Tap a day to move the job</p>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-5">
          {calendar.week.map((day, index) => {
            const chosen = index === dayIndex;
            return (
              <li key={day.iso} className="min-w-0">
                <button
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => onPickDay(index)}
                  className={`tap-target flex h-full w-full flex-col gap-2 rounded-control border p-3 text-left transition ${
                    chosen ? "border-brand/60 bg-brand/[0.06]" : "border-line hover:border-line-strong"
                  }`}
                >
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                    {day.weekday} <span className="text-ink">{day.date}</span>
                  </span>
                  {chosen ? (
                    <span className="rounded-chip border border-caution/30 bg-caution-bg px-2 py-1.5 text-xs leading-4 text-caution">
                      <span className="block font-semibold">#{DEMO_JOB.number} Panel upgrade</span>8 AM–4 PM
                    </span>
                  ) : null}
                  {(WEEK_JOBS[index] ?? []).map((other) => (
                    <span
                      key={other.number}
                      className="rounded-chip border border-line bg-white/[0.03] px-2 py-1.5 text-xs leading-4 text-ink-muted"
                    >
                      <span className="block font-semibold text-ink">
                        #{other.number} {other.work}
                      </span>
                      {other.hours}
                    </span>
                  ))}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={CARD}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-ink-muted">Assigned to</p>
            <p className="text-sm font-semibold">{DEMO_JOB.technician}</p>
          </div>
          <p className="text-right text-sm">
            <span className="block font-semibold">
              {workDay.weekday}, {workDay.date}
            </span>
            <span className="text-ink-muted">{DEMO_JOB.hours}</span>
          </p>
        </div>
        <DemoAction id="text-sarah" icon={MessageSquare} onPress={onDemoAction} className="mt-4 w-full">
          Text Sarah
        </DemoAction>
        <DemoNotice show={notice === "text-sarah"} />
      </section>

      <NextButton onClick={onNext}>{trip?.label ?? "Start trip"}</NextButton>
    </div>
  );
}

function WorkPanel({
  notes,
  onNotes,
  notice,
  onDemoAction,
  onNext,
}: {
  notes: string;
  onNotes: (notes: string) => void;
  notice: string;
  onDemoAction: (id: string) => void;
  onNext: () => void;
}) {
  const finish = nextStep("working");

  return (
    <div className="space-y-3">
      <section className={CARD}>
        <WorkflowHeadline state="working" detail="Started 8:06 AM" live />
        <ul className="mt-3 space-y-1.5 text-sm leading-6 text-ink-muted">
          <li className="flex items-start gap-2">
            <Check className="mt-1 h-4 w-4 shrink-0 text-positive" aria-hidden />
            Left 7:41 AM. Sarah was texted that you were on the way.
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-1 h-4 w-4 shrink-0 text-positive" aria-hidden />
            Arrived 8:02 AM. Sarah was texted that you were here.
          </li>
        </ul>
      </section>

      {/* One card with three parts, as on the job page: they are one activity. */}
      <section className="divide-y divide-line rounded-panel border border-line bg-surface px-4 sm:px-5">
        <div className="py-4">
          <WorkAndMaterials notice={notice} onDemoAction={onDemoAction} />
        </div>

        <div className="py-4">
          <h3 className="text-sm font-semibold">Photos</h3>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {(["Before", "After"] as const).map((label) => (
              <div key={label} className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{label}</p>
                <div className="mt-2 grid gap-2">
                  <DemoAction id={`photo-${label}`} icon={Camera} onPress={onDemoAction}>
                    Take photo
                  </DemoAction>
                  <DemoAction id={`upload-${label}`} icon={ImagePlus} onPress={onDemoAction}>
                    Upload
                  </DemoAction>
                </div>
              </div>
            ))}
          </div>
          <DemoNotice show={notice.startsWith("photo-") || notice.startsWith("upload-")} />
        </div>

        <div className="py-4">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="demo-notes" className="text-sm font-semibold">
              Job notes
            </label>
            <span className="text-xs text-ink-faint">Not saved in the demo</span>
          </div>
          <textarea
            id="demo-notes"
            value={notes}
            onChange={(event) => onNotes(event.target.value)}
            rows={3}
            placeholder="What did you find or repair?"
            className="mt-2 block w-full rounded-control border border-line bg-transparent p-3 text-base leading-6"
          />
        </div>
      </section>

      <NextButton onClick={onNext}>{finish?.label ?? "Finish job"}</NextButton>
    </div>
  );
}

const SHEET_HEADING = "text-[11px] font-bold uppercase tracking-[0.1375em] text-[#64748b]";

/** The invoice the customer receives, drawn the way its PDF is (invoice-document.tsx). */
function InvoiceSheet({ workDay, status }: { workDay: DemoDay; status: string }) {
  const totals = demoInvoice();
  const date = shortDate(workDay.iso);

  return (
    <article
      className={`${documentFont.className} rounded-[3px] bg-white px-5 pb-8 pt-7 text-[13px] leading-[19px] text-[#0f172a] shadow-lg sm:px-12 sm:pb-12 sm:pt-10 sm:text-[14px] sm:leading-[21px]`}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 break-words">
          <p className="text-[clamp(18px,5.65vw,22px)] font-bold leading-[1.25] tracking-[0.015em] sm:text-[26px]">
            {DEMO_BUSINESS.name}
          </p>
          <p className="text-[#64748b]">
            {DEMO_BUSINESS.city}, {DEMO_BUSINESS.state}
          </p>
          <p className="text-[#64748b]">{DEMO_BUSINESS.phone}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[clamp(18px,5.65vw,22px)] font-bold leading-[1.25] sm:text-[26px]">INVOICE</p>
          <p className="text-[#64748b]">#{DEMO_JOB.invoiceNumber}</p>
        </div>
      </header>

      <div className="mb-5 mt-4 h-1 bg-[#b8860b]" aria-hidden />

      <div className="flex justify-between gap-4">
        <div className="w-[48%] min-w-0 break-words">
          <p className={SHEET_HEADING}>Bill to</p>
          <p className="mt-1 font-bold">{DEMO_CUSTOMER.name}</p>
          {DEMO_CUSTOMER.addressLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <dl className="w-[46%] min-w-0">
          {[
            ["Invoice date", date],
            ["Due", "On receipt"],
            ["Status", status],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-[#64748b]">{label}</dt>
              <dd className="text-right font-bold">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className={`${SHEET_HEADING} mt-5`}>Job</p>
      <p className="mt-1">
        Job #{DEMO_JOB.number} — {DEMO_CUSTOMER.addressLines.join(", ")}
      </p>
      <p className="text-[#64748b]">
        Service date {date} · Electrician: {DEMO_JOB.technician}
      </p>

      <table className="mt-5 w-full table-fixed border-collapse">
        <thead>
          <tr className="border-b border-[#0f172a]">
            <th scope="col" className={`${SHEET_HEADING} w-[46%] pb-1.5 text-left sm:w-[52%]`}>
              Description
            </th>
            <th scope="col" className={`${SHEET_HEADING} w-[16%] pb-1.5 text-right sm:w-[12%]`}>
              Qty
            </th>
            <th scope="col" className={`${SHEET_HEADING} w-[18%] pb-1.5 text-right sm:w-[16%]`}>
              Rate
            </th>
            <th scope="col" className={`${SHEET_HEADING} w-[20%] pb-1.5 text-right`}>
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {DEMO_LINES.map((line, index) => (
            <tr key={line.id} className={index % 2 === 1 ? "bg-[#f8fafc]" : undefined}>
              <td className="break-words py-1.5 pr-2 align-top">{line.description}</td>
              <td className="py-1.5 text-right align-top">
                {formatQuantity(line.quantity)} {line.unit}
              </td>
              <td className="py-1.5 text-right align-top">{formatCents(line.unitPriceCents)}</td>
              <td className="py-1.5 text-right align-top">{formatCents(lineTotalCents(line))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto mt-4 w-full space-y-1 sm:w-1/2">
        {(
          [
            ["Subtotal", formatCents(totals.subtotalCents), false],
            ["Diagnostic already paid", `-${formatCents(totals.diagnosticCreditCents)}`, false],
            ["Total", formatCents(totals.totalCents), true],
            ["Balance due", formatCents(totals.totalCents), true],
          ] as const
        ).map(([label, value, strong]) => (
          <div key={label} className={`flex justify-between gap-3 ${strong ? "font-bold" : ""}`}>
            <dt className={strong ? undefined : "text-[#64748b]"}>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <p className={`${SHEET_HEADING} mt-6`}>Payment</p>
      <p className="mt-1">Payment is due on receipt.</p>
      <p className="text-[#64748b]">Thank you for your business. Questions? Call {DEMO_BUSINESS.phone}.</p>
    </article>
  );
}

function InvoicePanel({
  workDay,
  notice,
  onDemoAction,
  onNext,
}: {
  workDay: DemoDay;
  notice: string;
  onDemoAction: (id: string) => void;
  onNext: () => void;
}) {
  const [text, setText] = useState(true);
  const [email, setEmail] = useState(true);

  return (
    <div className="space-y-3">
      <InvoiceSheet workDay={workDay} status="Draft" />

      <section className={CARD}>
        <h3 className="text-sm font-semibold">Send invoice #{DEMO_JOB.invoiceNumber}</h3>
        <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={text}
            onChange={(event) => setText(event.target.checked)}
            className="h-5 w-5 shrink-0 accent-[var(--color-brand)]"
          />
          <MessageSquare className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
          Text {DEMO_CUSTOMER.phone}
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={email}
            onChange={(event) => setEmail(event.target.checked)}
            className="h-5 w-5 shrink-0 accent-[var(--color-brand)]"
          />
          <Mail className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
          <span className="min-w-0 break-all">Email {DEMO_CUSTOMER.email}</span>
        </label>
        <DemoAction
          id="send-invoice"
          icon={Send}
          onPress={onDemoAction}
          disabled={!text && !email}
          className="mt-3 w-full"
        >
          Send invoice
        </DemoAction>
        <DemoNotice show={notice === "send-invoice"} />
      </section>

      <NextButton onClick={onNext}>Next: Paid</NextButton>
    </div>
  );
}

function PaidPanel({
  calendar,
  workDay,
  signed,
  onRestart,
}: {
  calendar: DemoCalendar;
  workDay: DemoDay;
  signed: boolean;
  onRestart: () => void;
}) {
  const invoice = demoInvoice();
  const history = demoHistory({ calendar, workDay, signed });

  return (
    <div className="space-y-3">
      <section className={CARD}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Invoice #{DEMO_JOB.invoiceNumber}</h3>
            <p className="mt-1 text-sm text-ink-muted">
              Sent by text, {workDay.weekday} {workDay.date} · Due on receipt
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-info-bg px-2.5 py-1 text-[11px] font-semibold text-info">
            <Clock3 className="h-3.5 w-3.5" aria-hidden />
            Unpaid
          </span>
        </div>
        <div className="mt-4 flex items-end justify-between gap-3 border-t border-line pt-4">
          <span className="text-sm text-ink-muted">Balance due</span>
          <span className="text-2xl font-semibold">{formatCents(invoice.totalCents)}</span>
        </div>
        <p className="mt-3 text-sm leading-6 text-ink-muted">
          The {formatCents(invoice.diagnosticCreditCents)} Sarah paid at booking is already off. The invoice is listed
          under Unpaid on your Invoices page, with what is owed.
        </p>
      </section>

      <section className={CARD}>
        <h3 className="text-sm font-semibold">History · {DEMO_CUSTOMER.name}</h3>
        <ol className="mt-3 space-y-3">
          {history.map((entry) => (
            <li key={`${entry.day.iso}-${entry.text}`} className="flex gap-3 text-sm leading-6">
              <span className="w-14 shrink-0 text-ink-faint">{entry.day.date}</span>
              <span className="min-w-0">{entry.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-panel border border-brand/25 bg-brand/[0.06] p-5 text-center sm:p-8">
        <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">That’s one job, start to finish.</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-muted">
          Create your account to run your own. No credit card required.
        </p>
        <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
          <ButtonLink href="/signup" size="lg" className="px-6">
            Create your account
          </ButtonLink>
          <button type="button" onClick={onRestart} className={`${SECONDARY} min-h-14 bg-raised`}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            Start over
          </button>
          <ButtonLink href="/" variant="ghost" size="lg">
            Back to Volteira
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
