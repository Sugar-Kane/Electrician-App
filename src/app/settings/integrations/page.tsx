import Link from "next/link";
import { Check, ChevronRight, ExternalLink, KeyRound, LockKeyhole, PlugZap, Store, TriangleAlert } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { getSupplierIntegrations } from "@/lib/supplier-integrations";

const envLabels: Record<string, string> = {
  LOWES_PRODUCT_DISCOVERY_API_URL: "Product Discovery API URL",
  LOWES_PRODUCT_DISCOVERY_CLIENT_ID: "Client ID",
  LOWES_PRODUCT_DISCOVERY_CLIENT_SECRET: "Client secret",
  HOME_DEPOT_PRODUCT_FEED_URL: "Daily product feed URL",
  HOME_DEPOT_IMPACT_PID: "Impact partner website ID (PID)",
};

export default function SupplierIntegrationsPage() {
  const suppliers = getSupplierIntegrations();

  return (
    <FieldPageShell title="Supplier integrations" eyebrow="Product discovery" description="Connect approved retailer programs without exposing credentials to technicians or customer browsers." active="More">
      <div className="grid gap-4 lg:grid-cols-2">
        {suppliers.map((supplier) => {
          const ready = supplier.stage === "configuration_ready";
          return (
            <section key={supplier.id} className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/5 text-[#ffc21c]"><Store className="h-6 w-6" aria-hidden /></span><div><p className="text-xs text-slate-500">{supplier.programName}</p><h2 className="text-lg font-semibold">{supplier.name}</h2></div></div>
                <span className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${ready ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}>{supplier.statusLabel}</span>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-300">{supplier.description}</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {supplier.capabilities.map((capability) => <span key={capability} className="flex min-h-10 items-center gap-2 rounded-xl bg-white/[0.035] px-3 text-xs text-slate-300"><Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />{capability}</span>)}
              </div>
              {!ready ? <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><p className="flex items-center gap-2 text-xs font-semibold"><KeyRound className="h-4 w-4 text-[#ffc21c]" aria-hidden />Needed after approval</p><ul className="mt-3 space-y-2 text-xs text-slate-400">{supplier.missingConfiguration.map((name) => <li key={name}>• {envLabels[name] ?? name}</li>)}</ul></div> : null}
              <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-slate-400"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />{supplier.caveat}</p>
              <a href={supplier.applicationUrl} target="_blank" rel="noreferrer" className="tap-target mt-5 flex min-h-12 items-center justify-between rounded-2xl bg-[#ffc21c] px-4 text-sm font-semibold text-[#071723]"><span>{supplier.applicationLabel}</span><ExternalLink className="h-4 w-4" aria-hidden /></a>
            </section>
          );
        })}
      </div>

      <section className="mt-4 rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.045] p-5 sm:p-6">
        <div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden /><div><h2 className="font-semibold">Add credentials securely</h2><p className="mt-2 text-sm leading-6 text-slate-300">When either application is approved, add the supplied values to the Electrician App’s Vercel environment variables. Do not paste client secrets into chat or put them in a public variable. Volterra reads them only on the server.</p></div></div>
      </section>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Link href="/materials" className="tap-row flex min-h-14 items-center justify-between rounded-2xl border border-white/10 bg-[#0b1b27] px-4 text-sm font-semibold"><span className="flex items-center gap-2"><PlugZap className="h-4 w-4 text-[#ffc21c]" aria-hidden />Compare material searches</span><ChevronRight className="h-4 w-4 text-slate-500" aria-hidden /></Link>
        <Link href="/route" className="tap-row flex min-h-14 items-center justify-between rounded-2xl border border-white/10 bg-[#0b1b27] px-4 text-sm font-semibold"><span>Choose a supply stop</span><ChevronRight className="h-4 w-4 text-slate-500" aria-hidden /></Link>
      </div>
    </FieldPageShell>
  );
}
