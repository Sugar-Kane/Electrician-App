import Link from "next/link";
import { CheckCircle2, CircleDashed, CircleHelp, TriangleAlert, XCircle } from "lucide-react";

import { AdminTime } from "@/components/admin-time";
import { Card, Empty, Pill, type Tone } from "@/components/admin-ui";
import { listAssistantRows, type OrganizationDetail } from "@/lib/admin-console";
import { maskContacts } from "@/lib/admin-mask";
import { assistantCalls, type AssistantCall, type LinkState } from "@/lib/assistant-trace";

const LINK_STYLE: Record<LinkState, { Icon: typeof CheckCircle2; className: string; word: string }> = {
  ok: { Icon: CheckCircle2, className: "text-positive", word: "Yes" },
  missing: { Icon: XCircle, className: "text-critical", word: "No" },
  failed: { Icon: XCircle, className: "text-critical", word: "Failed" },
  waiting: { Icon: CircleDashed, className: "text-caution", word: "Sending" },
  unknown: { Icon: CircleHelp, className: "text-ink-faint", word: "Unknown" },
};

const TONE: Record<AssistantCall["outcome"]["tone"], Tone> = {
  good: "good",
  problem: "problem",
  waiting: "waiting",
  neutral: "neutral",
};

function minutes(call: AssistantCall): string {
  const span = Math.round((Date.parse(call.endedAt) - Date.parse(call.startedAt)) / 60000);
  return span < 1 ? "under a minute" : `${span} min`;
}

/**
 * What the phone assistant did, call by call.
 *
 * Business actions first, each with its chain: was the booking saved, was the
 * owner told, was the customer sent a confirmation. Protocol chatter is folded
 * away. A claim with nothing behind it is flagged in red at the top of its call.
 */
export async function AssistantTab({ organization, revealed }: { organization: OrganizationDetail; revealed: boolean }) {
  const calls = assistantCalls(await listAssistantRows(organization.id, 300));
  const zone = organization.timeZone;
  const base = `/admin/organizations/${organization.id}`;
  const problems = calls.filter((call) => call.problems.length > 0).length;
  const words = (value: string) => (revealed ? value : maskContacts(value));

  return (
    <Card title="Phone assistant calls" aside={`${calls.length} ${calls.length === 1 ? "call" : "calls"}${problems ? ` · ${problems} with problems` : ""}`}>
      {calls.length === 0 ? (
        <Empty>
          The voice agent has never reached this server for this business. If they say the phone does nothing, this is
          the confirmation — check that the agent is published with the right connector URL.
        </Empty>
      ) : (
        <ul className="space-y-3">
          {calls.map((call) => (
            <li
              key={call.key}
              className={`rounded-control border p-4 ${call.problems.length > 0 ? "border-critical/30" : "border-line"}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">
                  <AdminTime iso={call.startedAt} timeZone={zone} /> · {minutes(call)}
                </p>
                <Pill tone={TONE[call.outcome.tone]}>{call.outcome.text}</Pill>
              </div>
              {call.grouped === "time" ? (
                <p className="mt-1 text-xs text-ink-faint">
                  Logged before calls were grouped: these rows are grouped by time, and which booking they saved isn&rsquo;t known.
                </p>
              ) : null}

              {call.problems.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {call.problems.map((problem) => (
                    <li key={problem} className="flex items-start gap-2 rounded-chip bg-critical-bg px-3 py-2 text-xs text-critical">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      {problem}
                    </li>
                  ))}
                </ul>
              ) : null}

              {call.actions.map((action) => (
                <div key={action.row.id} className="mt-3 rounded-control border border-line p-3">
                  <p className="text-sm">
                    <span className="font-semibold">{action.row.toolName}</span> · {action.claim}
                  </p>
                  {action.links.length > 0 ? (
                    <ol className="mt-2 grid gap-2 sm:grid-cols-3">
                      {action.links.map((link) => {
                        const style = LINK_STYLE[link.state];
                        return (
                          <li key={link.label} className="rounded-chip border border-line px-3 py-2 text-xs">
                            <span className={`flex items-center gap-1.5 font-semibold ${style.className}`}>
                              <style.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              {link.label}: {style.word}
                            </span>
                            {link.detail ? <span className="mt-1 block text-ink-muted">{link.detail}</span> : null}
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {action.row.bookingRequestId ? (
                      <Link href={`${base}?tab=bookings#booking-${action.row.bookingRequestId}`} className="font-semibold text-brand">
                        The booking
                      </Link>
                    ) : null}
                    {action.row.jobNumber ? (
                      <Link href={`${base}/jobs/${action.row.jobNumber}`} className="font-semibold text-brand">
                        Job #{action.row.jobNumber}
                      </Link>
                    ) : null}
                  </div>
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer py-2 font-semibold text-ink-muted">What the assistant was told</summary>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-chip bg-black/30 p-3 text-ink-muted">
                      {words(action.row.resultText) || "Nothing."}
                    </pre>
                  </details>
                </div>
              ))}

              {call.steps.length > call.actions.length ? (
                <p className="mt-3 text-xs text-ink-muted">
                  Also asked:{" "}
                  {call.steps
                    .filter((step) => !call.actions.some((action) => action.row.id === step.id))
                    .map((step) => `${step.toolName}${step.isError ? " (error)" : ""}`)
                    .join(", ")}
                </p>
              ) : null}

              {call.protocol.length > 0 ? (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer py-2 text-ink-faint">
                    {call.protocol.length} protocol {call.protocol.length === 1 ? "message" : "messages"} (connecting, listing tools)
                  </summary>
                  <ul className="space-y-1 text-ink-faint">
                    {call.protocol.map((row) => (
                      <li key={row.id}>
                        <AdminTime iso={row.createdAt} timeZone={zone} /> · {row.method} · {row.durationMs}ms
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
