"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { markReleaseSeen } from "@/app/whats-new/actions";
import { useFocusTrap } from "@/components/ui/keyboard";
import { isPublicPath } from "@/lib/public-paths";

type Props = {
  version: string;
  title: string;
  highlights: { title: string; brief: string }[];
  fixes: number;
  moreHref: string;
};

/** The once-per-release "What's new" dialog. Okay hides it until the next release. */
export function WhatsNewDialog({ version, title, highlights, fixes, moreHref }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const [, startTransition] = useTransition();
  const dialog = useRef<HTMLDivElement>(null);
  const okay = useRef<HTMLButtonElement>(null);

  // Not over the public pages a business shares with customers (booking,
  // contracts, invoices) or the changelog itself. "/" is public only for
  // visitors; signed in (the only time this renders) it is the dashboard.
  const shown = open && (pathname === "/" || !isPublicPath(pathname)) && pathname !== "/changelog";
  useFocusTrap({ active: shown, container: dialog, initial: okay });

  if (!shown) return null;

  // The server shows this only while the account has not acknowledged this
  // version; Okay records it on the account and hides it now.
  function acknowledge() {
    setOpen(false);
    startTransition(() => {
      void markReleaseSeen();
    });
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="max-h-[calc(100dvh-2rem-env(safe-area-inset-bottom))] w-full max-w-md overflow-y-auto overscroll-contain rounded-panel border border-line bg-surface p-5 shadow-2xl"
      >
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-brand/15 text-brand">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">What&rsquo;s new · v{version}</p>
            <h2 id="whats-new-title" className="text-lg font-semibold leading-snug">
              {title}
            </h2>
          </div>
        </div>

        <ul className="mt-4 space-y-3">
          {highlights.map((item) => (
            <li key={item.title} className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{item.title}</p>
                {item.brief ? <p className="mt-0.5 text-sm leading-5 text-ink-muted">{item.brief}</p> : null}
              </div>
            </li>
          ))}
        </ul>
        {fixes > 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            Plus {fixes} bug {fixes === 1 ? "fix" : "fixes"}.
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href={moreHref}
            onClick={acknowledge}
            className="inline-flex min-h-11 items-center justify-center rounded-control px-2 text-sm font-semibold text-brand"
          >
            See all features and fixes
          </Link>
          <button
            ref={okay}
            type="button"
            onClick={acknowledge}
            className="min-h-11 rounded-control border border-positive/40 bg-positive-bg px-6 text-sm font-semibold text-positive"
          >
            Okay
          </button>
        </div>
      </div>
    </div>
  );
}
