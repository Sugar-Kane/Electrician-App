import type { Metadata } from "next";
import Link from "next/link";

import { AdminTime } from "@/components/admin-time";
import { Empty, Pill, type Tone } from "@/components/admin-ui";
import { SelectField } from "@/components/ui/select-field";
import { listOperations, listOrganizations } from "@/lib/admin-console";

export const metadata: Metadata = {
  title: "Recovery | Volteira support",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TOOLS = [
  { value: "check_delivery", label: "Checked delivery" },
  { value: "retry_text", label: "Sent a text again" },
  { value: "fix_recipient", label: "Corrected a number" },
];

const STATES: Record<string, { label: string; tone: Tone }> = {
  attempted: { label: "Running, or stopped part way", tone: "waiting" },
  accepted: { label: "Accepted by the provider", tone: "good" },
  verified: { label: "Done", tone: "good" },
  failed: { label: "Failed", tone: "problem" },
  unknown: { label: "Outcome unknown", tone: "waiting" },
};

/**
 * Every recovery tool anybody ran: who, on which business, to what, why, and
 * how it ended. An operation still "running" long after it started stopped
 * part way, and says so rather than looking finished.
 */
export default async function AdminRecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; tool?: string }>;
}) {
  const params = await searchParams;
  const business = UUID.test(params.business ?? "") ? params.business! : "";
  const tool = TOOLS.some((entry) => entry.value === params.tool) ? params.tool! : "";
  const [operations, organizations] = await Promise.all([
    listOperations({ organizationId: business, tool }),
    listOrganizations(),
  ]);

  return (
    <div className="space-y-3">
      <form action="/admin/recovery" className="rounded-panel border border-line bg-surface p-4">
        <p className="text-sm text-ink-muted">
          Every recovery tool run from this console, newest first. Each one was claimed before it ran, so none can have
          run twice.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <SelectField
            name="business"
            label="Business"
            defaultValue={business}
            placeholder="Every business"
            choices={[{ value: "", label: "Every business" }, ...organizations.map((entry) => ({ value: entry.id, label: entry.name }))]}
          />
          <SelectField
            name="tool"
            label="Tool"
            defaultValue={tool}
            placeholder="Every tool"
            choices={[{ value: "", label: "Every tool" }, ...TOOLS]}
          />
          <button type="submit" className="tap-target rounded-control bg-brand px-5 text-sm font-bold text-on-brand">
            Show
          </button>
        </div>
      </form>

      {operations.length === 0 ? (
        <Empty>{business || tool ? "Nothing matches." : "No recovery tool has been run yet."}</Empty>
      ) : (
        operations.map((operation) => {
          const state = STATES[operation.state] ?? { label: operation.state, tone: "neutral" as Tone };
          const base = `/admin/organizations/${operation.organizationId}`;
          const href =
            operation.targetType === "message"
              ? `${base}/messages/${operation.targetId}`
              : operation.messageId
                ? `${base}/messages/${operation.messageId}`
                : operation.targetType === "customer"
                  ? `${base}?tab=jobs&customer=${operation.targetId}`
                  : base;
          return (
            <div key={operation.id} className="rounded-control border border-line bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">
                  {TOOLS.find((entry) => entry.value === operation.tool)?.label ?? operation.tool} ·{" "}
                  <Link href={href} className="text-brand">
                    {operation.organizationName}
                  </Link>
                </p>
                <Pill tone={state.tone}>{state.label}</Pill>
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                By {operation.actorEmail || "an unknown account"}
                {operation.reason ? ` · “${operation.reason}”` : ""}
              </p>
              <p className="mt-1 text-xs text-ink-faint">
                Started <AdminTime iso={operation.createdAt} timeZone={operation.timeZone} />
                {operation.finishedAt ? (
                  <>
                    {" · finished "}
                    <AdminTime iso={operation.finishedAt} timeZone={operation.timeZone} />
                  </>
                ) : null}
              </p>
            </div>
          );
        })
      )}
    </div>
  );
}
