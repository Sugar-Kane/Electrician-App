import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, TriangleAlert } from "lucide-react";

import { AdminTime } from "@/components/admin-time";
import { Card, Pill, Row } from "@/components/admin-ui";
import { DateTimeField } from "@/components/ui/date-time-field";
import { SelectField } from "@/components/ui/select-field";
import { getCaseDetail, requirePlatformAdmin } from "@/lib/admin-console";
import { isoToZonedWallClock } from "@/lib/schedule-labels";
import { createClient } from "@/lib/supabase/server";
import {
  CASE_CATEGORIES,
  CASE_SEVERITIES,
  CASE_SEVERITY_TONE,
  CASE_STATES,
  caseMoves,
  caseTargetHref,
} from "@/lib/support-cases";
import { TIMEZONE_OPTIONS } from "@/lib/timezones";

import { assignCase, editCase, moveCase, noteCase } from "../actions";

export const metadata: Metadata = {
  title: "Case | Volteira support",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TOOL_WORDS: Record<string, string> = {
  check_delivery: "Checked delivery",
  retry_text: "Sent a text again",
  fix_recipient: "Corrected a number",
  classify_booking: "Hid a booking",
  merge_duplicates: "Hid duplicate bookings",
  restore_booking: "Brought a booking back",
};

const FIELD_WORDS: Record<string, string> = {
  reporter: "who reported it",
  category: "what it's about",
  severity: "how bad",
  symptom: "what's wrong",
  steps: "what happened before",
  occurred_at: "when",
  occurred_zone: "time zone",
  next_update_due: "next update",
  root_cause: "cause",
  fix: "fix",
  resolution_evidence: "evidence",
};

const inputClass =
  "w-full rounded-control border border-line bg-raised px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand/70";

function Labeled({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-sm font-medium">{text}</span>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** One case: where it stands, what it's about, what's been done, and what's left. */
export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requirePlatformAdmin();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const [found, auth] = await Promise.all([getCaseDetail(id), createClient().then((supabase) => supabase.auth.getUser())]);
  if (!found) notFound();
  const item = found;
  const me = auth.data.user?.id ?? "";
  const zone = item.occurredZone || item.timeZone;
  const overdue = item.overdue;
  const moves = caseMoves({ state: item.state, fix: item.fix, resolutionEvidence: item.resolutionEvidence });
  const category = CASE_CATEGORIES.find((entry) => entry.value === item.category)?.label ?? item.category;
  const hidden = (
    <>
      <input type="hidden" name="caseId" value={item.id} />
      <input type="hidden" name="updatedAt" value={item.updatedAt} />
    </>
  );

  return (
    <div className="space-y-4">
      <Link href="/admin/cases" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand">
        <ChevronLeft className="h-4 w-4" aria-hidden /> Cases
      </Link>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">
            Case #{item.number} · {category}
          </h1>
          <p className="mt-0.5 text-xs text-ink-faint">
            {item.organizationId ? (
              <Link href={`/admin/organizations/${item.organizationId}`} className="font-semibold text-brand">
                {item.organizationName}
              </Link>
            ) : (
              "Platform-wide"
            )}{" "}
            · opened by {item.openedByEmail || "unknown"} <AdminTime iso={item.createdAt} timeZone={item.timeZone} />
            {item.reopenedCount ? ` · reopened ${item.reopenedCount}×` : ""}
          </p>
        </div>
        <span className="flex flex-wrap gap-2">
          <Pill tone={CASE_SEVERITY_TONE[item.severity] ?? "neutral"}>{item.severity}</Pill>
          <Pill tone={item.state === "closed" ? "good" : "neutral"}>{CASE_STATES[item.state] ?? item.state}</Pill>
        </span>
      </header>

      {query.saved ? (
        <p role="status" className="rounded-control border border-positive/25 bg-positive-bg p-3 text-sm text-positive">
          {query.saved}
        </p>
      ) : null}
      {query.error ? (
        <p className="flex items-start gap-2 rounded-control border border-critical/30 bg-critical-bg p-3 text-sm text-critical">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {query.error}
        </p>
      ) : null}

      <Card title="Where it stands">
        <dl>
          <Row label="What's wrong" value={<span className="whitespace-pre-wrap">{item.symptom}</span>} />
          <Row label="With" value={item.assigneeEmail || "Nobody"} />
          <Row
            label="Next update"
            value={
              item.state === "closed" ? (
                "None, it's closed"
              ) : item.nextUpdateDue ? (
                <span className={overdue ? "font-semibold text-critical" : ""}>
                  {overdue ? "Overdue since " : ""}
                  <AdminTime iso={item.nextUpdateDue} timeZone={item.timeZone} />
                </span>
              ) : (
                "Not set"
              )
            }
          />
        </dl>

        <form action={assignCase} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          {hidden}
          <div className="min-w-0 flex-1">
            <Labeled text="Give it to">
              <SelectField
                name="assignee"
                label="Give it to"
                defaultValue={item.assignee}
                placeholder="Nobody"
                choices={[{ value: "", label: "Nobody" }, ...item.admins.map((admin) => ({ value: admin.id, label: `${admin.email}${admin.id === me ? " (you)" : ""}` }))]}
              />
            </Labeled>
          </div>
          <button type="submit" className="tap-target shrink-0 rounded-control border border-line px-4 text-sm font-semibold">
            Assign
          </button>
        </form>

        <div className="mt-5 border-t border-line pt-4">
          <p className="text-sm font-medium">Move it</p>
          <ul className="mt-2 space-y-2">
            {moves.map((move) => (
              <li key={move.to}>
                {move.needs ? (
                  <p className="flex flex-wrap items-center gap-2 rounded-control border border-line p-3 text-sm text-ink-muted">
                    <span className="font-semibold">{move.label}:</span> {move.needs}
                  </p>
                ) : (
                  <form action={moveCase} className="flex flex-col gap-2 rounded-control border border-line p-3 sm:flex-row">
                    {hidden}
                    <input type="hidden" name="to" value={move.to} />
                    <input
                      name="note"
                      required={item.state === "closed"}
                      maxLength={2000}
                      placeholder={item.state === "closed" ? "Why it's being reopened" : "A note for the timeline (optional)"}
                      className={`min-h-11 min-w-0 flex-1 ${inputClass}`}
                    />
                    <button type="submit" className="tap-target shrink-0 rounded-control border border-line px-4 text-sm font-semibold">
                      {move.label}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card title="Records" aside={`${item.links.length}`}>
        {item.links.length === 0 ? (
          <p className="text-sm text-ink-muted">No records linked. Open a case from a text, booking, job or the Overview to link one.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {item.links.map((link) => (
              <li key={`${link.type}:${link.id}`}>
                {item.organizationId ? (
                  <Link href={caseTargetHref(item.organizationId, link)} className="font-semibold text-brand">
                    {link.label || link.type}
                  </Link>
                ) : (
                  <span className="font-semibold">{link.label || link.type}</span>
                )}{" "}
                <span className="text-xs text-ink-faint">· {link.type}</span>
              </li>
            ))}
          </ul>
        )}
        {item.operations.length > 0 ? (
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-sm font-medium">Recovery tools run on these records</p>
            <ul className="mt-2 space-y-1 text-sm text-ink-muted">
              {item.operations.map((operation) => (
                <li key={operation.id}>
                  {TOOL_WORDS[operation.tool] ?? operation.tool} · {operation.state} ·{" "}
                  <AdminTime iso={operation.createdAt} timeZone={item.timeZone} />
                  {operation.reason ? ` · “${operation.reason}”` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card title="Details">
        <form action={editCase} className="space-y-4">
          {hidden}
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled text="What it's about">
              <SelectField name="category" label="What it's about" defaultValue={item.category} choices={CASE_CATEGORIES} />
            </Labeled>
            <Labeled text="How bad">
              <SelectField name="severity" label="How bad" defaultValue={item.severity} choices={CASE_SEVERITIES} />
            </Labeled>
          </div>
          <label className="block">
            <span className="text-sm font-medium">What&rsquo;s wrong</span>
            <textarea name="symptom" required minLength={3} maxLength={2000} rows={3} defaultValue={item.symptom} className={`mt-1 ${inputClass}`} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">What happened before it</span>
            <textarea name="steps" maxLength={4000} rows={3} defaultValue={item.steps} className={`mt-1 ${inputClass}`} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Who reported it</span>
            <input name="reporter" maxLength={300} defaultValue={item.reporter} className={`mt-1 min-h-11 ${inputClass}`} />
          </label>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Labeled text="When it happened">
              <DateTimeField name="occurred_at" label="When it happened" timeZone={zone} defaultValue={isoToZonedWallClock(item.occurredAt, zone)} />
            </Labeled>
            <Labeled text="In which time zone">
              <SelectField name="zone" label="In which time zone" defaultValue={zone} choices={TIMEZONE_OPTIONS} />
            </Labeled>
          </div>
          <Labeled text="Next update owed">
            <DateTimeField name="next_update_due" label="Next update owed" timeZone={zone} defaultValue={isoToZonedWallClock(item.nextUpdateDue, zone)} />
          </Labeled>
          <label className="block">
            <span className="text-sm font-medium">Cause</span>
            <textarea name="root_cause" maxLength={4000} rows={2} defaultValue={item.rootCause} placeholder="What actually went wrong, once known" className={`mt-1 ${inputClass}`} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Fix</span>
            <textarea name="fix" maxLength={4000} rows={2} defaultValue={item.fix} placeholder="What was changed, and where. Needed before asking for it to be verified." className={`mt-1 ${inputClass}`} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Evidence it&rsquo;s fixed</span>
            <textarea name="resolution_evidence" maxLength={4000} rows={2} defaultValue={item.resolutionEvidence} placeholder="What was checked and seen working. Needed before closing." className={`mt-1 ${inputClass}`} />
          </label>
          <button type="submit" className="tap-target rounded-control bg-brand px-5 text-sm font-bold text-on-brand">
            Save details
          </button>
        </form>
      </Card>

      <Card title="Timeline">
        <ol className="space-y-2">
          {item.events.map((event, index) => (
            <li key={`${event.createdAt}-${index}`} className="rounded-control border border-line p-3 text-sm">
              <p>
                <span className="font-semibold">
                  {event.kind === "opened"
                    ? "Opened"
                    : event.kind === "state"
                      ? `${CASE_STATES[event.fromState] ?? event.fromState} → ${CASE_STATES[event.toState] ?? event.toState}`
                      : event.kind === "assigned"
                        ? `Given to ${event.body}`
                        : event.kind === "edited"
                          ? `Changed ${event.body.split(", ").map((key) => FIELD_WORDS[key] ?? key).join(", ")}`
                          : event.kind === "linked"
                            ? `Linked ${event.body}`
                            : "Note"}
                </span>
                {event.kind === "note" || (event.kind === "state" && event.body) || event.kind === "opened" ? (
                  <span className="mt-1 block whitespace-pre-wrap text-ink-muted">{event.body}</span>
                ) : null}
              </p>
              <p className="mt-1 text-xs text-ink-faint">
                {event.actor || "unknown"} · <AdminTime iso={event.createdAt} timeZone={item.timeZone} />
              </p>
            </li>
          ))}
        </ol>
        <form action={noteCase} className="mt-4 flex flex-col gap-2 sm:flex-row">
          {hidden}
          <textarea name="body" required minLength={2} maxLength={4000} rows={2} placeholder="Add a note: who you spoke to, what you checked" className={`min-w-0 flex-1 ${inputClass}`} />
          <button type="submit" className="tap-target shrink-0 rounded-control border border-line px-4 text-sm font-semibold">
            Add note
          </button>
        </form>
      </Card>
    </div>
  );
}
