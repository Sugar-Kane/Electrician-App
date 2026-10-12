import { AdminTime } from "@/components/admin-time";
import { Card, Empty } from "@/components/admin-ui";
import { listMcpCalls, type OrganizationDetail } from "@/lib/admin-console";
import { maskContacts } from "@/lib/admin-mask";

/** What the phone assistant asked this app to do, and what it was told. */
export async function AssistantTab({ organization, revealed }: { organization: OrganizationDetail; revealed: boolean }) {
  const calls = await listMcpCalls(organization.id, 40);
  const zone = organization.timeZone;

  return (
    <Card title="Phone assistant calls" aside={`${calls.length} shown`}>
      {calls.length === 0 ? (
        <Empty>
          The voice agent has never reached this server for this business. If they say the phone does nothing, this is
          the confirmation — check that the agent is published with the right connector URL.
        </Empty>
      ) : (
        <ul className="space-y-2">
          {calls.map((call) => (
            <li
              key={call.id}
              className={`rounded-control border p-3 text-xs ${call.isError ? "border-critical/25 bg-critical-bg" : "border-line"}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">
                  {call.method}
                  {call.toolName ? ` · ${call.toolName}` : ""}
                </span>
                <span className="text-ink-faint">
                  <AdminTime iso={call.createdAt} timeZone={zone} /> · {call.httpStatus || "—"} · {call.durationMs}ms
                </span>
              </div>
              {call.resultText ? (
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-chip bg-black/30 p-3 text-ink-muted">
                  {revealed ? call.resultText : maskContacts(call.resultText)}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
