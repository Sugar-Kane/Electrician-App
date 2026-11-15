import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/front-page";
import { ButtonLink } from "@/components/ui/button";
import { CURRENT_VERSION, RELEASES, releaseAnchor, releaseDateLabel, type ChangeKind } from "@/lib/releases";

/**
 * What's new in Volteira: every release, newest first, from src/lib/releases.ts.
 * Public, like any product's changelog; the same list feeds the account menu
 * and ChatGPT's list_feature_updates tool.
 */

export const metadata: Metadata = {
  title: "What's new | Volteira",
  description: `Volteira release notes. Current version ${CURRENT_VERSION}.`,
};

const KIND: Record<ChangeKind, { label: string; className: string }> = {
  new: { label: "New", className: "bg-brand/15 text-brand" },
  improved: { label: "Improved", className: "bg-positive-bg text-positive" },
  fixed: { label: "Fixed", className: "bg-white/[0.06] text-ink-muted" },
};

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="px-4 sm:border-b sm:border-line/60 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 py-3">
          <Logo />
          <nav className="flex shrink-0 items-center gap-1.5 sm:gap-2" aria-label="Main">
            <ButtonLink href="/demo" variant="secondary" className="whitespace-nowrap">
              Demo
            </ButtonLink>
            <ButtonLink href="/login" variant="ghost" className="whitespace-nowrap">
              Sign in
            </ButtonLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Release notes</p>
        <h1 className="mt-3 text-[2rem] font-semibold leading-tight tracking-tight sm:text-5xl">What&rsquo;s new in Volteira</h1>
        <p className="mt-4 text-base leading-7 text-ink-muted">
          Every update, newest first. You&rsquo;re on version{" "}
          <span className="rounded-chip bg-white/[0.06] px-2 py-0.5 font-mono text-sm text-ink">v{CURRENT_VERSION}</span>.
        </p>

        <nav aria-label="Versions" className="mt-6 flex flex-wrap gap-2">
          {RELEASES.map((release) => (
            <a
              key={release.version}
              href={`#${releaseAnchor(release.version)}`}
              className="inline-flex min-h-10 items-center rounded-full border border-line px-3 font-mono text-xs text-ink-muted hover:text-ink"
            >
              v{release.version}
            </a>
          ))}
        </nav>

        <ol className="mt-10 space-y-12">
          {RELEASES.map((release, index) => (
            <li key={release.version} id={releaseAnchor(release.version)} className="scroll-mt-6">
              <article className="relative border-l border-line pl-5 sm:pl-8">
                <span className="absolute -left-[5px] top-2 h-2.5 w-2.5 rounded-full bg-brand" aria-hidden />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-sm font-semibold text-brand">v{release.version}</span>
                  <time dateTime={release.date ?? undefined} className="text-sm text-ink-faint">
                    {releaseDateLabel(release.date)}
                  </time>
                  {index === 0 ? <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-on-brand">Latest</span> : null}
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">{release.title}</h2>
                <p className="mt-2 text-sm leading-6 text-ink-muted">{release.summary}</p>
                <ul className="mt-5 space-y-3">
                  {release.changes.map((change) => (
                    <li key={change.title} className="rounded-panel border border-line bg-surface p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${KIND[change.kind].className}`}>
                          {KIND[change.kind].label}
                        </span>
                        <h3 className="font-semibold">{change.title}</h3>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-ink-muted">{change.detail}</p>
                    </li>
                  ))}
                </ul>
              </article>
            </li>
          ))}
        </ol>

        <p className="mt-14 text-sm text-ink-faint">
          Using ChatGPT with Volteira? Ask it &ldquo;what&rsquo;s new in Volteira?&rdquo;.{" "}
          <Link href="/" className="text-brand">
            Back to Volteira
          </Link>
        </p>
      </main>
    </div>
  );
}
