import Link from "next/link";

import { AdminTime } from "@/components/admin-time";
import { Card, Empty, Pill } from "@/components/admin-ui";
import { listOrgMessages, type OrganizationDetail } from "@/lib/admin-console";
import { maskBody, maskPhone } from "@/lib/admin-mask";
import { deliveryState } from "@/lib/message-errors";

/** The business's texts, newest first, with delivery evidence for each. */
export async function MessagesTab({ organization, revealed }: { organization: OrganizationDetail; revealed: boolean }) {
  const messages = await listOrgMessages(organization.id);
  const zone = organization.timeZone;
  const base = `/admin/organizations/${organization.id}`;

  return (
    <Card title="Texts" aside={`${messages.length} shown`}>
      {messages.length === 0 ? (
        <Empty>No texts.</Empty>
      ) : (
        <ul className="space-y-2">
          {messages.map((message) => {
            const state = deliveryState(message);
            return (
              <li key={message.id} className="rounded-control border border-line p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 text-sm font-semibold">
                    {message.direction === "outbound" ? "To " : "From "}
                    {message.customerName || "unknown"}{" "}
                    <span className="font-normal text-ink-muted">
                      {revealed ? message.customerPhone : maskPhone(message.customerPhone)}
                    </span>
                  </p>
                  <Pill tone={state.tone}>{state.label}</Pill>
                </div>
                <p className={`mt-1 text-sm ${revealed ? "whitespace-pre-wrap break-words text-ink" : "text-ink-faint"}`}>
                  {revealed ? message.body || "Empty" : maskBody(message.body)}
                </p>
                <p className="mt-1 text-xs text-ink-faint">
                  <AdminTime iso={message.createdAt} timeZone={zone} />
                  {message.deliveredAt ? (
                    <>
                      {" · delivered "}
                      <AdminTime iso={message.deliveredAt} timeZone={zone} />
                    </>
                  ) : null}
                  {message.jobNumber ? (
                    <>
                      {" · "}
                      <Link href={`${base}/jobs/${message.jobNumber}`} className="font-semibold text-brand">
                        Job #{message.jobNumber}
                      </Link>
                    </>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
