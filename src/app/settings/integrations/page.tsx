import Link from "next/link";
import { Check, ChevronRight, ExternalLink, KeyRound, LockKeyhole, PhoneCall, PlugZap, Store, TriangleAlert } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { getReceptionistIntegrations } from "@/lib/receptionist-integrations";
import { getSupplierIntegrations } from "@/lib/supplier-integrations";

const envLabels: Record<string, string> = {
  LOWES_PRODUCT_DISCOVERY_API_URL: "Product Discovery API URL",
  LOWES_PRODUCT_DISCOVERY_CLIENT_ID: "Client ID",
  LOWES_PRODUCT_DISCOVERY_CLIENT_SECRET: "Client secret",
  HOME_DEPOT_PRODUCT_FEED_URL: "Daily product feed URL",
  HOME_DEPOT_IMPACT_PID: "Impact partner website ID (PID)",
  TWILIO_ACCOUNT_SID: "Twilio account SID",
  TWILIO_AUTH_TOKEN: "Twilio auth token",
  PUBLIC_BASE_URL: "Public base URL (what Twilio signs against)",
  VOICE_AGENT_WEBHOOK_SECRET: "Voice platform webhook secret",
  ANTHROPIC_API_KEY: "Anthropic API key",
  SUPABASE_SECRET_KEY: "Supabase service-role key",
};

export default function SupplierIntegrationsPage() {
  const suppliers = getSupplierIntegrations();
  const receptionist = getReceptionistIntegrations();

  return (
    <FieldPageShell title="Integrations" eyebrow="Connected services" description="Connect approved retailer programs and the inbound phone line without exposing credentials to technicians or customer browsers." active="More">
      <section className="mb-4 rounded-3xl border border-white/10 bg-[#0b1b27] p-5 sm:p-6">
        <div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/5 text-[#ffc21c]"><PhoneCall className="h-6 w-6" aria-hidden /></span><div><p className="text-xs text-slate-500">Inbound calls and texts</p><h2 className="text-lg font-semibold">AI receptionist</h2></div></div>
        <p className="mt-4 text-sm leading-6 text-slate-300">Answers the business number when someone who is not a customer yet calls or texts, captures what they need, and files a lead. It never quotes a price or books a time — that stays with the owner.</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {receptionist.map((integration) => {
            const ready = integration.stage === "configuration_ready";
            return (
              <div key={integration.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                <div className="flex items-start justify-between gap-2"><div><p className="text-[10px] text-slate-500">{integration.programName}</p><h3 className="text-sm font-semibold">{integration.name}</h3></div><span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold ${ready ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}>{integration.statusLabel}</span></div>
                <p className="mt-3 text-xs leading-5 text-slate-400">{integration.description}</p>
                {!ready ? <ul className="mt-3 space-y-1.5 text-[11px] text-slate-400">{integration.missingConfiguration.map((name) => <li key={name} className="flex gap-1.5"><KeyRound className="mt-0.5 h-3 w-3 shrink-0 text-[#ffc21c]" aria-hidden />{envLabels[name] ?? name}</li>)}</ul> : <div className="mt-3 grid gap-1.5">{integration.capabilities.map((capability) => <span key={capability} className="flex items-center gap-1.5 text-[11px] text-slate-300"><Check className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden />{capability}</span>)}</div>}
                <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-4 text-slate-500"><TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" aria-hidden />{integration.caveat}</p>
                <a href={integration.applicationUrl} target="_blank" rel="noreferrer" className="tap-target mt-3 flex min-h-10 items-center justify-between rounded-xl border border-white/10 px-3 text-[11px] font-semibold text-slate-200"><span>{integration.applicationLabel}</span><ExternalLink className="h-3 w-3" aria-hidden /></a>
              </div>
            );
          })}
        </div>
        <Link href="/leads" className="tap-row mt-4 flex min-h-12 items-center justify-between rounded-2xl border border-white/10 px-4 text-sm font-semibold"><span>Review captured leads</span><ChevronRight className="h-4 w-4 text-slate-500" aria-hidden /></Link>
      </section>

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
        <div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden /><div><h2 className="font-semibold">Add credentials securely</h2><p className="mt-2 text-sm leading-6 text-slate-300">When either application is approved, add the supplied values to the Electrician App’s Vercel environment variables. Do not paste client secrets into chat or put them in a public variable. Volteira reads them only on the server.</p></div></div>
      </section>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Link href="/materials" className="tap-row flex min-h-14 items-center justify-between rounded-2xl border border-white/10 bg-[#0b1b27] px-4 text-sm font-semibold"><span className="flex items-center gap-2"><PlugZap className="h-4 w-4 text-[#ffc21c]" aria-hidden />Compare material searches</span><ChevronRight className="h-4 w-4 text-slate-500" aria-hidden /></Link>
        <Link href="/route" className="tap-row flex min-h-14 items-center justify-between rounded-2xl border border-white/10 bg-[#0b1b27] px-4 text-sm font-semibold"><span>Choose a supply stop</span><ChevronRight className="h-4 w-4 text-slate-500" aria-hidden /></Link>
      </div>
    </FieldPageShell>
  );
}
