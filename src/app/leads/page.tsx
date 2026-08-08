import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, ChevronRight, Clock3, Inbox, MapPin, MessageSquare, PhoneCall, Settings2 } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { formatPhone } from "@/lib/ai-receptionist";
import { createClient } from "@/lib/supabase/server";

type LeadRow = {
  id: string;
  channel: "voice" | "sms";
  status: string;
  urgency: "emergency" | "urgent" | "routine" | "unknown";
  contact_name: string | null;
  contact_phone: string;
  service_address: string | null;
  job_type: string | null;
  summary: string;
  preferred_times: string | null;
  created_at: string;
};

const urgencyStyles: Record<LeadRow["urgency"], string> = {
  emergency: "bg-red-400/15 text-red-300",
  urgent: "bg-amber-400/15 text-amber-300",
  routine: "bg-emerald-400/10 text-emerald-300",
  unknown: "bg-white/5 text-slate-400",
};

const statusStyles: Record<string, string> = {
  new: "bg-[#ffc21c]/15 text-[#ffc21c]",
  contacted: "bg-sky-400/10 text-sky-300",
  scheduled: "bg-emerald-400/10 text-emerald-300",
  converted: "bg-emerald-400/15 text-emerald-300",
  closed: "bg-white/5 text-slate-500",
};

function relativeTime(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function LeadsPage() {
  // Leads are per-signed-in-user data. Stop prerendering before touching
  // Supabase, so a build without runtime credentials does not try to render
  // this page and there is no cached copy of one tenant's leads.
  await connection();

  const supabase = await createClient();

  // RLS scopes this to the organizations the signed-in user belongs to, so no
  // explicit organization filter is needed — and none would be trustworthy.
  const { data, error } = await supabase
    .from("inbound_leads")
    .select("id, channel, status, urgency, contact_name, contact_phone, service_address, job_type, summary, preferred_times, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const leads = (data ?? []) as LeadRow[];
  const open = leads.filter((lead) => lead.status === "new");

  return (
    <FieldPageShell
      title="Leads"
      eyebrow="Inbound calls and texts"
      description="People who called or texted the business number. The AI took the details; pricing and scheduling are yours."
      active="More"
    >
      {error ? (
        <section className="rounded-3xl border border-amber-400/25 bg-amber-400/[0.05] p-5">
          <p className="flex items-start gap-2 text-sm leading-6 text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Leads could not be loaded. If the AI receptionist has not been set up yet, finish the steps on the integrations page.</p>
          <Link href="/settings/integrations" className="tap-target mt-4 flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 text-sm font-semibold"><Settings2 className="h-4 w-4" aria-hidden /> Open integrations</Link>
        </section>
      ) : leads.length === 0 ? (
        <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-8 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white/5 text-slate-500"><Inbox className="h-6 w-6" aria-hidden /></span>
          <h2 className="mt-4 text-lg font-semibold">No leads yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">When someone calls or texts the business number, the AI answers, takes their details, and the lead lands here.</p>
          <Link href="/settings/integrations" className="tap-target mx-auto mt-5 flex min-h-12 w-full max-w-xs items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 text-sm font-semibold"><Settings2 className="h-4 w-4" aria-hidden /> Check the phone line setup</Link>
        </section>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-[#0b1b27] p-4"><p className="text-2xl font-semibold">{open.length}</p><p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-slate-500">Waiting on you</p></div>
            <div className="rounded-2xl border border-white/10 bg-[#0b1b27] p-4"><p className="text-2xl font-semibold">{leads.filter((lead) => lead.urgency === "emergency").length}</p><p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-slate-500">Flagged urgent</p></div>
            <div className="rounded-2xl border border-white/10 bg-[#0b1b27] p-4"><p className="text-2xl font-semibold">{leads.length}</p><p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-slate-500">Last 50</p></div>
          </div>

          {leads.map((lead) => (
            <section key={lead.id} className="rounded-3xl border border-white/10 bg-[#0b1b27] p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/5 text-[#ffc21c]">{lead.channel === "voice" ? <PhoneCall className="h-5 w-5" aria-hidden /> : <MessageSquare className="h-5 w-5" aria-hidden />}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{lead.contact_name ?? formatPhone(lead.contact_phone)}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{lead.job_type ?? "Job type not stated"} · {relativeTime(lead.created_at)}</p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] ${statusStyles[lead.status] ?? statusStyles.closed}`}>{lead.status}</span>
                  {lead.urgency !== "unknown" ? <span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] ${urgencyStyles[lead.urgency]}`}>{lead.urgency}</span> : null}
                </div>
              </div>

              <p className="mt-3 text-sm leading-6 text-slate-300">{lead.summary}</p>

              <div className="mt-3 space-y-1.5 text-[11px] text-slate-500">
                {lead.service_address ? <p className="flex items-center gap-1.5"><MapPin className="h-3 w-3 shrink-0" aria-hidden />{lead.service_address}</p> : <p className="flex items-center gap-1.5 text-amber-300/70"><MapPin className="h-3 w-3 shrink-0" aria-hidden />No address captured — ask when you call back</p>}
                {lead.preferred_times ? <p className="flex items-center gap-1.5"><Clock3 className="h-3 w-3 shrink-0" aria-hidden />Available {lead.preferred_times}</p> : null}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <a href={`tel:${lead.contact_phone}`} className="tap-target flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#ffc21c] px-4 text-sm font-semibold text-[#071723]"><PhoneCall className="h-4 w-4" aria-hidden /> Call back</a>
                <a href={`sms:${lead.contact_phone}`} className="tap-target flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 text-sm font-semibold"><MessageSquare className="h-4 w-4" aria-hidden /> Text</a>
              </div>
            </section>
          ))}
        </div>
      )}

      <Link href="/settings/integrations" className="tap-row mt-4 flex min-h-14 items-center justify-between rounded-2xl border border-white/10 bg-[#0b1b27] px-4 text-sm font-semibold"><span className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-[#ffc21c]" aria-hidden />Receptionist setup</span><ChevronRight className="h-4 w-4 text-slate-500" aria-hidden /></Link>
    </FieldPageShell>
  );
}
