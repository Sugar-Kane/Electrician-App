import Link from "next/link";
import { CalendarCheck2, Check, FileSignature, ReceiptText, ShieldCheck, Zap } from "lucide-react";

// The front page's story in four lines — one job, carried from the price to
// the bill — so the page that says what Volteira does and the page you sign in
// on do not tell two different stories.
const benefits = [
  { icon: ReceiptText, label: "Price a job once: the contract and invoice use the same lines" },
  { icon: FileSignature, label: "Contracts customers sign on their phone" },
  { icon: CalendarCheck2, label: "Schedule, materials, photos and notes on every job" },
  { icon: ShieldCheck, label: "Each company’s data kept separate and secure" },
];

export function AuthShell({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-canvas p-3 text-white sm:p-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,.72fr)] lg:gap-5 lg:p-6">
      <section className="relative hidden min-h-[calc(100vh-48px)] overflow-hidden rounded-[32px] border border-line bg-[#081925] p-10 lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(255,191,24,.16),transparent_30%),radial-gradient(circle_at_80%_90%,rgba(25,105,145,.25),transparent_35%)]" />
        <Link href="/" className="relative inline-flex min-h-12 w-fit items-center gap-3 text-xl font-bold tracking-[0.04em]"><span className="grid h-11 w-11 place-items-center rounded-control bg-brand text-on-brand"><Zap className="h-6 w-6 fill-current" aria-hidden /></span>VOLTEIRA</Link>
        <div className="relative max-w-xl"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Electrical business operations</p><h2 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight xl:text-5xl">Run the business.<br />Power every job.</h2><p className="mt-5 max-w-lg text-base leading-7 text-ink-muted">A field-first command center for scheduling, customers, materials, payments, and profitable work.</p><ul className="mt-9 space-y-4">{benefits.map(({ icon: Icon, label }) => <li key={label} className="flex items-center gap-3 text-sm text-ink"><span className="grid h-10 w-10 place-items-center rounded-chip border border-line bg-white/5 text-brand"><Icon className="h-5 w-5" aria-hidden /></span>{label}</li>)}</ul></div>
        <p className="relative flex items-center gap-2 text-xs text-ink-muted"><Check className="h-4 w-4 text-positive" aria-hidden />Built for owner-operated electrical contractors</p>
      </section>

      <section className="flex min-h-[calc(100vh-24px)] items-center justify-center rounded-[28px] border border-line bg-[#081722] px-4 py-8 sm:min-h-[calc(100vh-40px)] sm:px-8 lg:min-h-[calc(100vh-48px)]">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-8 inline-flex min-h-12 items-center gap-2 text-lg font-bold tracking-[0.04em] lg:hidden"><Zap className="h-7 w-7 fill-brand text-brand" aria-hidden />VOLTEIRA</Link>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">{eyebrow}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-ink-muted">{description}</p>
          <div className="mt-7">{children}</div>
        </div>
      </section>
    </main>
  );
}
