import type { Metadata } from "next";

import { listAuditTrail } from "@/lib/admin-console";

export const metadata: Metadata = {
  title: "Activity | Volteira support",
  robots: { index: false, follow: false },
};

const LABELS: Record<string, string> = {
  "organization.viewed": "Opened a business's records",
  "invitation.sent": "Sent an invitation",
};

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * What support has done.
 *
 * Looking inside a business's records reaches names, addresses, and phone
 * numbers belonging to people who never agreed to be seen by the platform. This
 * page is the answer to "who looked, and when" — including for whoever is
 * reading it.
 */
export default async function AdminAuditPage() {
  const entries = await listAuditTrail();

  return (
    <div className="space-y-3">
      <p className="px-1 text-sm text-slate-400">
        Every time a business&rsquo;s records were opened or an invitation was sent.
      </p>

      {entries.map((entry) => (
        <div key={entry.id} className="rounded-2xl border border-white/10 bg-[#0b1b27] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">{LABELS[entry.action] ?? entry.action}</p>
            <p className="text-xs text-slate-500">{when(entry.createdAt)}</p>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {entry.adminEmail || "unknown"}
            {entry.organizationName ? ` · ${entry.organizationName}` : ""}
          </p>
          {entry.detail && entry.detail !== "{}" ? (
            <pre className="mt-2 overflow-x-auto rounded-xl bg-black/30 p-3 text-xs text-slate-400">
              {entry.detail}
            </pre>
          ) : null}
        </div>
      ))}

      {entries.length === 0 ? (
        <p className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5 text-sm text-slate-400">
          Nothing yet.
        </p>
      ) : null}
    </div>
  );
}
