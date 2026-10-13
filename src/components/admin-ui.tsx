import Link from "next/link";
import { EyeOff, ShieldCheck } from "lucide-react";

import { revealPrivateDetails } from "@/app/admin/organizations/[id]/actions";

/**
 * The support console's building blocks: a card, a labelled row, a status pill,
 * and the bar that hides or shows a business's private details.
 */

export function Card({
  title,
  id,
  aside,
  children,
}: {
  title: string;
  id?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 rounded-panel border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {aside ? <div className="text-sm text-ink-muted">{aside}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/5 py-2 last:border-0">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-right text-sm font-medium">{value || "—"}</dd>
    </div>
  );
}

export type Tone = "good" | "waiting" | "problem" | "neutral";

const TONES: Record<Tone, string> = {
  good: "border-positive/25 bg-positive-bg text-positive",
  waiting: "border-caution/25 bg-caution-bg text-caution",
  problem: "border-critical/30 bg-critical-bg text-critical",
  neutral: "border-line bg-white/5 text-ink-muted",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-control border border-dashed border-line p-5 text-center text-sm text-ink-muted">{children}</p>;
}

/**
 * Private details are hidden until an admin says why they need them.
 *
 * The reason is recorded first; the page then reloads with that record's id,
 * and only a page carrying a fresh one of the admin's own shows the details.
 * Leaving the page, or fifteen minutes, hides them again.
 */
export function RevealBar({
  organizationId,
  scope,
  returnTo,
  revealed,
  hideHref,
}: {
  organizationId: string;
  scope: string;
  /** This page's address without any reveal on it. */
  returnTo: string;
  revealed: boolean;
  hideHref: string;
}) {
  if (revealed) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-control border border-caution/30 bg-caution-bg px-4 py-3 text-sm text-caution">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">Showing phone numbers, emails and texts on this page. Your reason is on the activity record.</p>
        <Link href={hideHref} className="tap-target inline-flex items-center rounded-chip border border-caution/40 px-3 text-xs font-bold">
          Hide
        </Link>
      </div>
    );
  }

  return (
    <form action={revealPrivateDetails} className="rounded-control border border-line bg-white/[0.03] px-4 py-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <EyeOff className="h-4 w-4 shrink-0" aria-hidden />
        Phone numbers, emails and texts are hidden.
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Reason to show them</span>
          <input
            name="reason"
            required
            minLength={3}
            maxLength={200}
            placeholder="Why, e.g. customer says the text never came"
            className="min-h-11 w-full rounded-control border border-line bg-raised px-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand/70"
          />
        </label>
        <button type="submit" className="tap-target shrink-0 rounded-control border border-line px-4 text-sm font-semibold">
          Show
        </button>
      </div>
    </form>
  );
}

/** The two halves of Access & audit: what happened, and who can get in. */
export function AccessTabs({ current }: { current: "audit" | "users" }) {
  const tabs = [
    { key: "audit", href: "/admin/audit", label: "Activity" },
    { key: "users", href: "/admin/users", label: "People and access" },
  ] as const;
  return (
    <nav aria-label="Access and audit" className="flex flex-wrap gap-2 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? "page" : undefined}
          className={`tap-target inline-flex items-center rounded-chip px-3 font-semibold ${
            tab.key === current ? "bg-white/10 text-ink" : "border border-line text-ink-muted"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
