import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { NavIcon } from "@/components/ui/nav-icon";
import { SETTINGS_GROUPS } from "@/lib/navigation";

export const metadata: Metadata = { title: "Settings | Volteira" };

/**
 * One way in to everything you can configure.
 *
 * The settings pages existed but had no home: they were six flat entries in the
 * main menu, mixed in with the day's work, so "where do I change what the
 * assistant tells customers" had no answer short of reading every menu item.
 *
 * Grouped by who a setting belongs to rather than by which table it writes.
 */
export default function SettingsPage() {
  return (
    <FieldPageShell
      title="Settings"
      eyebrow="Setup"
      description="How the business runs, what customers receive, and what it connects to."
    >
      <div className="space-y-4">
        {SETTINGS_GROUPS.map((group) => (
          <section key={group.title} className="rounded-panel border border-line bg-surface p-5 sm:p-6">
            <h2 className="text-lg font-semibold tracking-tight">{group.title}</h2>
            <p className="mt-1 text-sm leading-6 text-ink-muted">{group.blurb}</p>

            <div className="mt-4 space-y-2">
              {group.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="tap-row flex min-h-16 items-center gap-3 rounded-control border border-line bg-raised px-4 py-3"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-chip bg-brand/10 text-brand">
                    <NavIcon name={link.icon} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{link.label}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-ink-muted">
                      {link.description}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </FieldPageShell>
  );
}
