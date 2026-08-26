import { AlertTriangle, MessageSquareQuote } from "lucide-react";

import {
  callRecordProvenance,
  callRecordTitle,
  type CallRecord,
} from "@/lib/call-record";
import { slotLabel } from "@/lib/schedule-labels";

/**
 * The intake behind a job, for somebody about to drive to it.
 *
 * The job card has always shown one line — what the customer said was wrong —
 * and left the five answers that decide what to load in the van sitting in a
 * booking request nobody opens. This is those answers, one tap from the line
 * they belong to.
 *
 * It is not a transcript and does not pretend to be one. `callRecordProvenance`
 * says on the panel itself where the words came from, because an electrician
 * deciding whether to trust "no, nothing tripped" needs to know it was written
 * down by a receptionist rather than heard.
 */

function taken(iso: string, timeZone: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

export function JobCallRecord({
  record,
  timeZone,
}: {
  record: CallRecord;
  timeZone: string;
}) {
  const when = taken(record.takenAt, timeZone);

  return (
    <div className="border-t border-line pt-4">
      <div className="flex items-start gap-2">
        <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-ink">{callRecordTitle(record)}</p>
          <p className="mt-0.5 text-xs leading-5 text-ink-faint">
            {[when, callRecordProvenance(record)].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      {record.urgency === "urgent" ? (
        <p className="mt-3 flex items-center gap-2 rounded-control bg-caution/10 px-3 py-2 text-sm font-semibold text-caution">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          They said this was urgent
        </p>
      ) : null}

      {record.said ? (
        <blockquote className="mt-3 border-l-2 border-brand/40 pl-3 text-sm leading-6 text-ink">
          {record.said}
        </blockquote>
      ) : null}

      {record.answers.length > 0 ? (
        <dl className="mt-4 space-y-3">
          {record.answers.map((entry) => (
            <div key={entry.question}>
              <dt className="text-xs leading-5 text-ink-faint">{entry.question}</dt>
              <dd className="mt-0.5 text-sm leading-6 text-ink">{entry.answer}</dd>
            </div>
          ))}
        </dl>
      ) : (
        // Said rather than left blank. "Nothing else was asked" is a fact about
        // the call, and an empty panel reads as a page that failed to load.
        <p className="mt-3 text-sm text-ink-muted">
          Nothing else was asked on this one.
        </p>
      )}

      {record.window || record.feeCents > 0 ? (
        <div className="mt-4 space-y-1 border-t border-line pt-3 text-xs leading-5 text-ink-faint">
          {record.window ? (
            /*
             * What was agreed then, not what the job says now. If somebody has
             * since moved the visit these will differ, and the one that belongs
             * on a record of the call is the one the customer was told.
             */
            <p>Agreed on the call: {slotLabel(record.window.start, record.window.end, timeZone)}</p>
          ) : null}
          {record.feeCents > 0 ? (
            <p>Quoted ${(record.feeCents / 100).toFixed(0)} for the diagnostic visit.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
