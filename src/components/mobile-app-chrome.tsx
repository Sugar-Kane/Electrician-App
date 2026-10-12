"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  ArrowLeft,
  ClipboardList,
  Home,
  MessageCircle,
  MessagesSquare,
  MoreHorizontal,
  Package,
  Search,
  X,
  Zap,
} from "lucide-react";

import { AccountMenu } from "@/components/account-menu";
import { NavIcon } from "@/components/ui/nav-icon";
import { NAV_SECTIONS, activeNavHref, isBeyondBottomNav } from "@/lib/navigation";
import { scrollToTop } from "@/lib/scroll-top";

/**
 * The phone's chrome: a top bar, a bottom bar, and the full menu.
 *
 * Which entry is lit used to be a string each page passed in by hand, so a page
 * that forgot said "Home" while you were somewhere else entirely. It is now
 * derived from the URL, the same way the desktop sidebar does it — there is one
 * answer to "where am I" and both menus read it.
 *
 * The menu used to open from a hamburger in the top-right corner — the hardest
 * point on a phone to reach with the hand holding it — while the button under
 * the thumb labelled "More" navigated to Settings instead of opening anything.
 * So the menu was where the thumb was not, and where the thumb was, a control
 * lied about what it did. More opens the menu now and the hamburger is gone.
 */

/**
 * The four places an electrician goes every day, and More.
 *
 * All five look the same. The assistant used to sit in the middle as a raised
 * yellow button, the loudest thing on every screen, which told people it was
 * the main way to work; it is a button in the top bar now, beside Search, and
 * Materials has its place under the thumb. More is a menu, not a link.
 */
const BOTTOM_ITEMS = [
  { label: "Today", href: "/", icon: Home },
  { label: "Jobs", href: "/jobs", icon: ClipboardList },
  { label: "Materials", href: "/materials", icon: Package },
  { label: "Messages", href: "/messages", icon: MessagesSquare },
  { label: "More", href: "", icon: MoreHorizontal, action: "menu" as const },
];

/** A box somebody types into: the keyboard is up, so the bars get out of the way. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(
    target.type,
  );
}

function Brand() {
  return (
    <Link
      href="/"
      className="flex min-h-11 min-w-0 items-center gap-2 text-ink"
      aria-label="Volteira dashboard"
    >
      <Zap className="h-7 w-7 shrink-0 fill-brand text-brand" aria-hidden />
      {/* Cut short with an ellipsis when the bar is crowded (large text),
          never stacked a letter to a line. */}
      <span className="min-w-0 truncate text-lg font-bold [overflow-wrap:normal]">VOLTEIRA</span>
    </Link>
  );
}

export function MobileAppChrome({
  title,
  backHref,
  bar,
  bottomNav = true,
  flush = false,
}: {
  title?: string;
  backHref?: string;
  /**
   * Replaces what the top bar contains, keeping the bar itself.
   *
   * For a screen that *is* one thing rather than a page about it — a
   * conversation, where the person's name belongs where the page title would
   * otherwise go. Without this the name appears twice, once in this bar and
   * again in the header below it.
   */
  bar?: React.ReactNode;
  /**
   * The floating tab bar. Off for a screen with its own bottom control: a
   * message composer under a floating nav is a send button behind a nav button.
   */
  bottomNav?: boolean;
  /**
   * Whether the parent has no horizontal padding for this bar to cancel.
   *
   * The scrolling shell pads its main element, so the bar pulls itself back out
   * to both edges with a negative margin. A full-height shell pads the content
   * grid instead and leaves the main bare — there the same negative margin
   * pushes the bar 8px off each side of the phone, clipping the account button
   * against `overflow-hidden`.
   */
  flush?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const active = activeNavHref(pathname);

  /*
   * Tapping the tab you are already on does nothing at all — the router has
   * nowhere to go, so a screen scrolled halfway down stays halfway down. On
   * Home that is the difference between "today at a glance" and whatever
   * happened to be under your thumb.
   */
  function toTopIfHere(href: string) {
    if (href === pathname) scrollToTop();
  }

  // Somewhere that came from the menu rather than the bottom bar. Lighting
  // More there beats a bottom bar with nothing lit, which reads as "you are
  // nowhere" on every page but four.
  const beyond = isBeyondBottomNav(pathname);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  /*
   * While a box has the keyboard, the floating bars hide (globals.css reads
   * `data-typing`). On a phone the keyboard takes half the screen, and the
   * tab bar and a job's action bar used to sit on top of the very field being
   * typed into.
   */
  useEffect(() => {
    const root = document.documentElement;
    let showing: number | undefined;
    function onFocusIn(event: FocusEvent) {
      if (!isTypingTarget(event.target)) return;
      window.clearTimeout(showing);
      root.dataset.typing = "true";
    }
    /*
     * The bars come back a moment after the box loses focus, not at once.
     * Tapping Save under a text box moves focus on the press, and a bar that
     * reappeared right then sat under the finger for the release — so the tap
     * landed on the bar and Save never heard it. Waiting until the tap is
     * over lets it finish where it started.
     */
    function onFocusOut(event: FocusEvent) {
      if (isTypingTarget(event.relatedTarget)) return;
      window.clearTimeout(showing);
      showing = window.setTimeout(() => {
        if (!isTypingTarget(document.activeElement)) delete root.dataset.typing;
      }, 300);
    }
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      window.clearTimeout(showing);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      delete root.dataset.typing;
    };
  }, []);

  return (
    <>
      <header
        // Two independent things: reaching both edges, and the gap underneath.
        // The negative margin cancels padding the parent has — `flush` says
        // there is none, and keeping it there pushed the bar 8px off each side
        // of the phone. The gap is only wanted when a page's own content
        // follows; a screen supplying its own `bar` butts straight up to it.
        className={`sticky top-0 z-40 flex min-h-14 items-center justify-between border-b border-line bg-canvas/95 px-3 py-1.5 backdrop-blur lg:hidden ${
          flush ? "" : "-mx-2"
        } ${bar ? "" : "mb-3"}`}
      >
        {bar ?? (
          <>
            {backHref ? (
              <Link
                href={backHref}
                className="tap-target inline-flex min-w-0 items-center gap-2 text-ink"
                aria-label={`Back to ${backHref === "/" ? "dashboard" : "previous page"}`}
              >
                <ArrowLeft className="h-5 w-5 shrink-0" aria-hidden />
                <span className="truncate text-sm font-semibold">{title}</span>
              </Link>
            ) : (
              <Brand />
            )}
            <div className="flex items-center gap-1.5">
              {/*
                A link to the real search page, not an overlay. The overlay that
                used to open here searched `pilotJobs` — the demo fixtures — so
                an electrician tapping it saw four invented customers and none
                of their own work, while /search queried the database properly.
                One search, and it is the one that returns real jobs.
              */}
              <Link
                href="/search"
                className="tap-target grid h-11 w-11 place-items-center rounded-chip border border-line bg-raised text-ink"
                aria-label="Search jobs and customers"
              >
                <Search className="h-5 w-5" aria-hidden />
              </Link>
              <Link
                href="/assistant"
                prefetch
                aria-current={pathname === "/assistant" ? "page" : undefined}
                className="tap-target grid h-11 w-11 place-items-center rounded-chip border border-line bg-raised text-ink aria-[current=page]:border-brand/50 aria-[current=page]:text-brand"
                aria-label="Ask Volteira"
              >
                <MessageCircle className="h-5 w-5" aria-hidden />
              </Link>
              <AccountMenu />
            </div>
          </>
        )}
      </header>

      {bottomNav ? (
        <nav
          data-hide-while-typing
          className="fixed inset-x-3 bottom-3 z-50 flex min-h-[64px] items-end justify-around rounded-control border border-line bg-sunken/96 px-1 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 shadow-2xl backdrop-blur lg:hidden"
          aria-label="Mobile navigation"
        >
          {BOTTOM_ITEMS.map(({ label, href, icon: Icon, action }) => {
            const menu = action === "menu";

            const current = menu
              ? beyond
              : !action && activeNavHref(href) === active && active !== null;

            const shell = `tap-target flex min-w-[54px] flex-col items-center justify-center gap-0.5 rounded-chip text-[10px] ${
              current ? "text-brand" : "text-ink-muted"
            }`;

            const inner = (
              <>
                <span className="grid h-7 place-items-center">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span>{label}</span>
              </>
            );

            // More opens a sheet rather than navigating, so it is a button. A
            // link to "" would quietly take somebody to the dashboard, which is
            // what More did in a different way before.
            if (action) {
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setMenuOpen(true)}
                  aria-haspopup="dialog"
                  aria-expanded={menuOpen}
                  aria-label="Open main menu"
                  className={shell}
                >
                  {inner}
                </button>
              );
            }

            return (
              <Link
                key={label}
                href={href}
                // The whole route, not the loading state. Every page here is
                // `force-dynamic`, and the default prefetch stops at the
                // nearest loading boundary — which is the skeleton, so the
                // wait for the data was still the whole wait.
                prefetch
                onClick={() => toTopIfHere(href)}
                aria-current={current ? "page" : undefined}
                className={shell}
              >
                {inner}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {menuOpen ? (
        <div
          className="fixed inset-0 z-[70] bg-black/60 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Main menu"
          onClick={() => setMenuOpen(false)}
        >
          <div
            // Clears the home indicator. The last entry in a menu that ends
            // inside the iPhone gesture area is an entry nobody can tap.
            className="ml-auto flex h-full w-[88%] max-w-sm flex-col overflow-y-auto bg-sunken p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <Brand />
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="tap-target grid h-11 w-11 place-items-center rounded-chip border border-line"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <nav className="mt-6 space-y-4" aria-label="Main menu links">
              {NAV_SECTIONS.map((section, index) => (
                <div key={section.title || `section-${index}`}>
                  {section.title ? (
                    <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                      {section.title}
                    </p>
                  ) : null}
                  <div className="space-y-2">
                    {section.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        prefetch
                        onClick={() => {
                          setMenuOpen(false);
                          toTopIfHere(item.href);
                        }}
                        aria-current={item.href === active ? "page" : undefined}
                        className={`flex min-h-14 items-center gap-3 rounded-control border px-3 py-2 active:bg-white/10 ${
                          item.href === active
                            ? "border-brand/40 bg-brand/[0.08]"
                            : "border-line bg-white/[0.03]"
                        }`}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-white/5 text-brand">
                          <NavIcon name={item.icon} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-ink">{item.label}</span>
                          <span className="block truncate text-[11px] text-ink-muted">
                            {item.description}
                          </span>
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}
