import Link from "next/link";
import { ArrowLeft, Zap } from "lucide-react";

import { MobileAppChrome } from "@/components/mobile-app-chrome";
import { AccountMenu } from "@/components/account-menu";

export function FieldPageShell({
  title,
  eyebrow,
  description,
  active,
  children,
}: {
  title: string;
  eyebrow: string;
  description?: string;
  active?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="field-page min-h-screen bg-[#06131d] p-2 pb-28 text-white sm:p-4 lg:p-8 lg:pb-8">
      <MobileAppChrome title={title} backHref="/" active={active} />
      <div className="mx-auto max-w-6xl">
        <div className="hidden items-center justify-between lg:flex">
          <Link href="/" className="tap-target inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white"><ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard</Link>
          <div className="flex items-center gap-3">
            <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold"><Zap className="h-5 w-5 fill-[#ffbf18] text-[#ffbf18]" aria-hidden /> VOLTEIRA</Link>
            <AccountMenu />
          </div>
        </div>
        <header className="mb-5 mt-3 rounded-3xl border border-white/10 bg-[#0b1b27] p-5 lg:mt-5 lg:p-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#ffc21c]">{eyebrow}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight lg:text-4xl">{title}</h1>
          {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{description}</p> : null}
        </header>
        {children}
      </div>
    </main>
  );
}
