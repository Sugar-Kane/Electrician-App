"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Zap } from "lucide-react";

import { NavIcon } from "@/components/ui/nav-icon";
import { NAV_SECTIONS, activeNavHref, type NavItem } from "@/lib/navigation";
import { scrollToTop } from "@/lib/scroll-top";

/**
 * The left menu.
 *
 * It renders NAV_SECTIONS and nothing of its own, so the desktop sidebar and
 * the mobile drawer cannot disagree about what exists — which is how
 * /settings/legal once ended up reachable only by typing the URL.
 */

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="Volteira dashboard">
      <span className="flex h-10 w-8 items-center justify-center text-brand">
        <Zap className="h-9 w-9 fill-current" strokeWidth={1.5} aria-hidden />
      </span>
      <span className="text-xl font-bold text-ink">VOLTEIRA</span>
    </Link>
  );
}

export function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      /*
       * The whole route, not just the loading state.
       *
       * Every page in this app is `force-dynamic`, and prefetch's default for a
       * dynamic route stops at the nearest `loading.tsx` — so the skeleton
       * arrived early and the two-second wait for the data was still the whole
       * two seconds. `prefetch` fetches the page itself, in the background,
       * while the menu sits on screen.
       *
       * Only in production. The dev server does not prefetch at all, so this
       * cannot be measured with `npm run dev`.
       */
      prefetch
      // Clicking the entry you are already on has nowhere to navigate to, so
      // the page stays wherever it was scrolled to. Going back to the top is
      // what the click meant.
      onClick={() => (active ? scrollToTop() : undefined)}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-3 rounded-chip px-3 py-2.5 text-sm transition ${
        active
          ? "bg-white/10 font-semibold text-brand"
          : "text-ink-muted hover:bg-white/5 hover:text-ink"
      }`}
    >
      <NavIcon name={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
}

/**
 * Takes no props any more.
 *
 * It used to be handed the business and owner names for a card at the bottom
 * that linked to /account — the left menu's own copy of what now lives behind
 * the avatar in the top right. Two ways in to the same page, one of them the
 * only thing in the rail that was not a destination.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const active = activeNavHref(pathname);

  return (
    /*
     * Pinned, not scrolled.
     *
     * It used to be `min-h-[calc(100vh-16px)]` with no upper bound, which is
     * why its own `overflow-y-auto` never engaged: an element that is free to
     * grow never overflows. So the whole rail travelled up the screen with the
     * page, and getting back to the menu meant scrolling a long invoice list
     * back to the top first.
     *
     * `sticky` rather than `fixed` because the rail is a grid column — fixed
     * would take it out of flow and the content would slide underneath it.
     *
     * `self-start` is the part that actually makes sticky work here. A grid
     * item stretches to the height of its row by default, so the rail was
     * exactly as tall as the page and had nowhere to stick within; measured, it
     * still travelled the full scroll distance. Aligned to the start it is its
     * own height again, and the row is the thing that scrolls past it.
     *
     * The other half of it was `overflow-x: hidden` on `html` — see the note in
     * `globals.css`. Between them, `sticky` had been inert app-wide.
     */
    <aside className="sticky top-3 hidden h-[calc(100vh-24px)] flex-col self-start overflow-hidden rounded-panel border border-line bg-sunken px-3 py-5 shadow-2xl shadow-black/20 lg:flex">
      <div className="px-3 pb-6">
        <Brand />
        <p className="mt-1 pl-[42px] text-[8px] font-semibold tracking-[0.12em] text-ink-faint">
          ELECTRICAL BUSINESS MANAGEMENT
        </p>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto" aria-label="Primary navigation">
        {NAV_SECTIONS.map((section, index) => (
          <div key={section.title || `section-${index}`} className={index > 0 ? "pt-4" : ""}>
            {section.title ? (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                {section.title}
              </p>
            ) : null}
            {section.items.map((item) => (
              <NavLink key={item.href} item={item} active={item.href === active} />
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
