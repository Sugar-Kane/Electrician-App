import { Check, Clock, Package } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  DEMO_CUSTOMER,
  DEMO_JOB,
  JOB_STAGES,
  demoEstimateLabel,
  stageIndex,
  type JobStageId,
} from "@/lib/demo-job";
import { formatCents, formatQuantity, lineTotalCents, type JobLine } from "@/lib/job-lines";
import { stateLabel, type WorkflowState } from "@/lib/job-workflow";

/**
 * The sample job, drawn the way the app draws a job.
 *
 * The front page shows it as a picture and /demo lets a visitor work it, and
 * both are built from these. One set of pieces is what keeps the picture on the
 * front page honest: it is the demo, not a drawing of one.
 *
 * No hooks and no state, so the server renders them into the front page and
 * the demo uses them in the browser. Where the app has the same thing — a line
 * on the job, the status of a visit — the markup follows the app's
 * (job-lines-panel.tsx, job-workflow.tsx) rather than a marketing version of
 * it.
 */

/** The big button at the bottom of a job, as job-workflow.tsx draws it. */
export const WORKFLOW_PRIMARY =
  "tap-target inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-base font-bold text-on-brand";

/** Whose job, what it is, where, and what it is worth. */
export function JobHeader({
  status,
  titleAs: Title = "p",
}: {
  status: string;
  /** The demo's page heading. In the front page's picture it is just text. */
  titleAs?: "h1" | "p";
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Job #{DEMO_JOB.number} · {DEMO_JOB.kind}
        </p>
        <Title className="mt-1 text-xl font-semibold tracking-tight text-ink sm:text-2xl">{DEMO_CUSTOMER.name}</Title>
        <p className="mt-1 text-sm leading-6 text-ink-muted">
          {DEMO_JOB.work}
          <span className="hidden sm:inline"> · {DEMO_CUSTOMER.shortAddress}</span>
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2 text-right">
        <StatusBadge status={status} />
        <p className="text-xs text-ink-faint">
          Estimate
          <span className="block text-lg font-semibold leading-6 text-ink">{demoEstimateLabel()}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * The six stages, with the ones behind it ticked and the one it is at lit.
 *
 * In a row of six from a tablet up, joined by a line that fills as the job
 * moves; two rows of three on a phone, where six across would be too small to
 * read. Given `onSelect`, each stage is a button that opens it.
 */
export function StageTrack({
  current,
  details = {},
  onSelect,
  label = "Job stages",
}: {
  current: JobStageId;
  /** A word or two under a stage: "Signed", "Tue 8 AM". */
  details?: Partial<Record<JobStageId, string>>;
  onSelect?: (stage: JobStageId) => void;
  label?: string;
}) {
  const at = stageIndex(current);
  const last = JOB_STAGES.length - 1;

  return (
    <div className="relative">
      {/* From the middle of the first stage to the middle of the last, with
          the part already travelled in the brand colour. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-[calc(100%/12)] right-[calc(100%/12)] top-[22px] hidden h-0.5 rounded-full bg-line sm:block"
      >
        <span
          className="block h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
          style={{ width: `${(at / last) * 100}%` }}
        />
      </span>

      <ol className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-6" aria-label={label}>
        {JOB_STAGES.map((stage, index) => {
          const state = index < at ? "done" : index === at ? "current" : "next";
          const detail = details[stage.id];

          const inner = (
            <>
              {/* Opaque underneath, so the line runs behind the circles rather
                  than through them; the green tint is a layer on top. */}
              <span
                className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold transition ${
                  state === "done"
                    ? "border border-positive/30 bg-surface text-positive"
                    : state === "current"
                      ? "bg-brand text-on-brand ring-4 ring-brand/15"
                      : "border border-line bg-surface text-ink-faint"
                }`}
              >
                {state === "done" ? <span aria-hidden className="absolute inset-0 rounded-full bg-positive-bg" /> : null}
                <span className="relative">
                  {state === "done" ? <Check className="h-4 w-4" aria-hidden /> : index + 1}
                </span>
              </span>
              <span
                className={`text-xs font-semibold ${state === "next" ? "text-ink-muted" : "text-ink"}`}
              >
                {stage.name}
                {state === "done" ? <span className="sr-only"> (done)</span> : null}
              </span>
              {detail ? <span className="-mt-1 hidden text-[11px] leading-4 text-ink-faint sm:block">{detail}</span> : null}
            </>
          );

          return (
            <li key={stage.id} className="min-w-0">
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(stage.id)}
                  aria-current={state === "current" ? "step" : undefined}
                  className="tap-target flex w-full flex-col items-center gap-1.5 rounded-control px-1 py-1 text-center transition hover:bg-raised"
                >
                  {inner}
                </button>
              ) : (
                <div className="flex flex-col items-center gap-1.5 px-1 py-1 text-center">{inner}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A job's labor and parts, one row each, as the job page lists them. */
export function LineRows({ lines }: { lines: JobLine[] }) {
  return (
    <ul>
      {lines.map((line) => {
        const Icon = line.kind === "labor" ? Clock : Package;
        return (
          <li key={line.id} className="flex items-center gap-2 border-b border-line py-2 last:border-b-0">
            <Icon className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{line.description}</span>
              <span className="block text-xs text-ink-muted">
                {formatQuantity(line.quantity)} {line.unit} × {formatCents(line.unitPriceCents)}
                {line.inventoryItemId ? " · from inventory" : null}
              </span>
            </span>
            <span className="shrink-0 text-sm font-semibold">{formatCents(lineTotalCents(line))}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Where the visit is, said once, in the words job-workflow.tsx uses. */
export function WorkflowHeadline({
  state,
  detail,
  live = false,
}: {
  state: WorkflowState;
  detail?: string;
  /** Announced when it changes. Only where it can change. */
  live?: boolean;
}) {
  const arrived = state === "arrived";
  const tone =
    state === "completed" || arrived ? "text-positive" : state === "scheduled" ? "text-ink-muted" : "text-brand";

  return (
    <div>
      <p
        className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${tone}`}
        role={live ? "status" : undefined}
      >
        {arrived || state === "completed" ? <Check className="h-4 w-4" aria-hidden /> : null}
        {stateLabel(state)}
      </p>
      {detail ? <p className="mt-1 text-sm text-ink-muted">{detail}</p> : null}
    </div>
  );
}
