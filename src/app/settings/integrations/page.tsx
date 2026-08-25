import Link from "next/link";
import { Check, ChevronRight, ExternalLink, KeyRound, LockKeyhole, PlugZap, Store, TriangleAlert } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { currentContext } from "@/lib/request-context";
import { getSupplierIntegrations } from "@/lib/supplier-integrations";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { ChatGptConnectionCard } from "./chatgpt-connection-card";
import { revokeChatGptConnection } from "./chatgpt-actions";

const envLabels: Record<string, string> = {
  LOWES_PRODUCT_DISCOVERY_API_URL: "Product Discovery API URL",
  LOWES_PRODUCT_DISCOVERY_CLIENT_ID: "Client ID",
  LOWES_PRODUCT_DISCOVERY_CLIENT_SECRET: "Client secret",
  HOME_DEPOT_PRODUCT_FEED_URL: "Daily product feed URL",
  HOME_DEPOT_IMPACT_PID: "Impact partner website ID (PID)",
};

function dateLabel(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export default async function IntegrationsPage() {
  const suppliers = getSupplierIntegrations();
  const context = await currentContext();
  const canManage = context?.role === "owner";
  let connections: { id: string; createdAt: string; expiresAt: string; lastUsedAt: string }[] = [];

  if (context && canManage) {
    const supabase = asFlexibleClient(await createClient());
    const { data } = await supabase
      .from("mcp_business_credentials")
      .select("id, created_at, expires_at, last_used_at")
      .eq("organization_id", context.organizationId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    connections = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id ?? ""),
      createdAt: dateLabel(row.created_at),
      expiresAt: dateLabel(row.expires_at),
      lastUsedAt: dateLabel(row.last_used_at),
    }));
  }

  return (
    <FieldPageShell backHref="/settings" title="Integrations" eyebrow="Connected services" description="Connect ChatGPT and approved supplier programs without exposing business credentials to technicians or customer browsers.">
      <div className="grid gap-4 lg:grid-cols-2">
        <ChatGptConnectionCard connections={connections} canManage={canManage} revokeAction={revokeChatGptConnection} />

        {suppliers.map((supplier) => {
          const ready = supplier.stage === "configuration_ready";
          return (
            <section key={supplier.id} className="rounded-panel border border-line bg-surface p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-control bg-white/5 text-brand"><Store className="h-6 w-6" aria-hidden /></span><div><p className="text-xs text-ink-faint">{supplier.programName}</p><h2 className="text-lg font-semibold">{supplier.name}</h2></div></div>
                <span className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${ready ? "bg-positive-bg text-positive" : "bg-caution-bg text-caution"}`}>{supplier.statusLabel}</span>
              </div>
              <p className="mt-4 text-sm leading-6 text-ink-muted">{supplier.description}</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {supplier.capabilities.map((capability) => <span key={capability} className="flex min-h-10 items-center gap-2 rounded-chip bg-white/[0.035] px-3 text-xs text-ink-muted"><Check className="h-3.5 w-3.5 shrink-0 text-positive" aria-hidden />{capability}</span>)}
              </div>
              {!ready ? <div className="mt-4 rounded-control border border-line bg-white/[0.025] p-4"><p className="flex items-center gap-2 text-xs font-semibold"><KeyRound className="h-4 w-4 text-brand" aria-hidden />Needed after approval</p><ul className="mt-3 space-y-2 text-xs text-ink-muted">{supplier.missingConfiguration.map((name) => <li key={name}>• {envLabels[name] ?? name}</li>)}</ul></div> : null}
              <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-ink-muted"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-caution" aria-hidden />{supplier.caveat}</p>
              <a href={supplier.applicationUrl} target="_blank" rel="noreferrer" className="tap-target mt-5 flex min-h-12 items-center justify-between rounded-control bg-brand px-4 text-sm font-semibold text-on-brand"><span>{supplier.applicationLabel}</span><ExternalLink className="h-4 w-4" aria-hidden /></a>
            </section>
          );
        })}
      </div>

      <section className="mt-4 rounded-panel border border-positive/20 bg-positive-bg p-5 sm:p-6">
        <div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-positive" aria-hidden /><div><h2 className="font-semibold">Credentials stay server-side</h2><p className="mt-2 text-sm leading-6 text-ink-muted">ChatGPT gets a revocable, business-scoped MCP URL. Supplier client secrets remain in Vercel environment variables and are never sent to browsers or included in ChatGPT tool results.</p></div></div>
      </section>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Link href="/materials" className="tap-row flex min-h-14 items-center justify-between rounded-control border border-line bg-surface px-4 text-sm font-semibold"><span className="flex items-center gap-2"><PlugZap className="h-4 w-4 text-brand" aria-hidden />Compare material searches</span><ChevronRight className="h-4 w-4 text-ink-faint" aria-hidden /></Link>
        <Link href="/route" className="tap-row flex min-h-14 items-center justify-between rounded-control border border-line bg-surface px-4 text-sm font-semibold"><span>Choose a supply stop</span><ChevronRight className="h-4 w-4 text-ink-faint" aria-hidden /></Link>
      </div>
    </FieldPageShell>
  );
}
