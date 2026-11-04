"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Search, X } from "lucide-react";

import { NavIcon } from "@/components/ui/nav-icon";
import type { SettingsGroup } from "@/lib/navigation";

/**
 * Every setting, in plain groups, with a search box on top.
 *
 * Somebody looking for "stripe" or "password" should find it in the time it
 * takes to type the word, without knowing which group it was filed under.
 */

export type SettingsBadge = { text: string; tone: "good" | "warn" | "muted" };

const TONES: Record<SettingsBadge["tone"], string> = {
  good: "bg-positive-bg text-positive",
  warn: "bg-caution-bg text-caution",
  muted: "bg-white/5 text-ink-muted",
};

function matches(query: string, haystack: string[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = haystack.join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}

export function SettingsDirectory({
  groups,
  badges = {},
}: {
  groups: SettingsGroup[];
  /** A status shown on a tile, keyed by its href. */
  badges?: Record<string, SettingsBadge>;
}) {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    if (!query.trim()) return groups;
    return groups
      .map((group) => ({
        ...group,
        links: group.links.filter((link) =>
          matches(query, [group.title, link.label, link.description, ...(link.keywords ?? [])]),
        ),
      }))
      .filter((group) => group.links.length > 0);
  }, [groups, query]);

  return (
    <div>
      <label className="relative block">
        <span className="sr-only">Search settings</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings: stripe, password, texts…"
          className="min-h-14 w-full rounded-control border border-line bg-surface pl-12 pr-12 text-base outline-none placeholder:text-ink-faint focus:border-brand/50"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="tap-target absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-chip text-ink-muted"
            aria-label="Clear search"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        ) : null}
      </label>

      <div className="mt-4 space-y-5">
        {shown.length === 0 ? (
          <p className="rounded-panel border border-line bg-surface p-6 text-center text-sm text-ink-muted">
            Nothing matches &ldquo;{query}&rdquo;. Try a simpler word, like &ldquo;payments&rdquo; or &ldquo;team&rdquo;.
          </p>
        ) : null}

        {shown.map((group) => (
          <section key={group.title}>
            <h2 className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">{group.title}</h2>
            <div className="mt-2 overflow-hidden rounded-panel border border-line bg-surface">
              {group.links.map((link, index) => {
                const badge = badges[link.href];
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`tap-row flex min-h-[4.5rem] items-center gap-3 px-4 py-3 ${index > 0 ? "border-t border-line" : ""}`}
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-chip bg-brand/10 text-brand">
                      <NavIcon name={link.icon} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold">{link.label}</span>
                        {badge ? (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONES[badge.tone]}`}>{badge.text}</span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{link.description}</span>
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
