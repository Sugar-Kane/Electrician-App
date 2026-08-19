import { AppSidebar } from "@/components/app-sidebar";
import { MobileAppChrome } from "@/components/mobile-app-chrome";
import { AccountMenu } from "@/components/account-menu";

/**
 * The frame every signed-in page renders inside.
 *
 * There used to be two of these — this one and the dashboard's, which carried a
 * light canvas and its own header — so moving between the dashboard and
 * anything else changed the whole look of the app. Now there is one frame, and
 * the dashboard is a page inside it like any other.
 *
 * `active` is gone as a prop: which menu entry lights up is derived from the
 * URL, so a page cannot mislabel itself by forgetting to pass it.
 */
export function FieldPageShell({
  title,
  eyebrow,
  description,
  backHref = "/",
  action,
  compact = false,
  bar,
  fill = false,
  children,
}: {
  title: string;
  eyebrow: string;
  description?: string;
  backHref?: string;
  /** Sits opposite the title. For the overflow menu on a job. */
  action?: React.ReactNode;
  /**
   * A smaller header, for a page whose own first block is the point.
   *
   * The full header is a bordered panel with a 4xl heading, which is right for
   * a settings page and wrong for a job: it spends the top third of a phone
   * screen restating the customer's name above the card that already says it,
   * pushing the one button that matters below the fold.
   */
  compact?: boolean;
  /**
   * The page's own top bar, standing in for the title block and — on a phone —
   * for the contents of the app's sticky bar too.
   *
   * For a screen that is one thing rather than a page about it. A conversation
   * with Adam should say "Adam" once, at the top, next to the way back; the
   * default header would say it again underneath in a bordered panel.
   */
  bar?: React.ReactNode;
  /**
   * Give the page the viewport's height instead of the content's, and let a
   * child own the scrolling.
   *
   * Everything else here scrolls as one long column, which is right for a page
   * you read top to bottom. A conversation is not that: the name and the way
   * back have to stay put while the messages move under them, and the box you
   * type into has to stay under your thumb. That needs a frame with a real
   * height, which is what this is. `dvh` rather than `vh` because a phone
   * browser's address bar makes `vh` taller than the screen.
   */
  fill?: boolean;
  children: React.ReactNode;
}) {
  if (fill) {
    return (
      <main className="flex h-[100dvh] flex-col overflow-hidden bg-canvas text-ink">
        <MobileAppChrome title={title} backHref={backHref} bar={bar} bottomNav={false} />
        <div className="mx-auto grid w-full min-h-0 max-w-[1760px] flex-1 gap-2 p-2 sm:p-3 lg:grid-cols-[248px_minmax(0,1fr)]">
          <AppSidebar />
          <div
            id="main-content"
            tabIndex={-1}
            className="flex min-h-0 min-w-0 flex-col lg:px-4 lg:py-2"
          >
            {/* The bar again, for a desktop that has no sticky phone chrome. */}
            {bar ? (
              <div className="mb-2 hidden shrink-0 items-center gap-2 lg:flex">{bar}</div>
            ) : null}
            {children}
          </div>
        </div>
      </main>
    );
  }

  return (
    // The bottom padding clears the floating nav: 12px off the bottom, at
    // least 64px tall, with a create button standing 28px proud of its top
    // edge — roughly 104px before the home indicator is considered at all.
    // `pb-28` is 112px, which cleared it on a phone with no indicator and hid
    // the last row of every page on one with. The inset is added rather than
    // assumed, now that it reports a real number.
    <main className="min-h-screen bg-canvas p-2 pb-[calc(7rem+env(safe-area-inset-bottom))] text-ink sm:p-3 lg:pb-3">
      <MobileAppChrome title={title} backHref={backHref} />
      <div className="mx-auto grid max-w-[1760px] gap-2 lg:grid-cols-[248px_minmax(0,1fr)]">
        <AppSidebar />
        <div className="min-w-0 lg:px-4 lg:py-2">
          <div className="hidden items-center justify-end gap-3 lg:flex">
            <AccountMenu />
          </div>
          {/*
            Where "Skip to content" lands. `tabIndex={-1}` makes it focusable
            by the jump without adding it to the tab order — without that,
            focus stays on the link and the next Tab carries on through the
            sidebar, which is the thing being skipped.
          */}
          <header
            id="main-content"
            tabIndex={-1}
            className={
              compact
                ? "mb-3 mt-1 flex items-start justify-between gap-3 lg:mt-4"
                : "mb-5 mt-3 flex items-start justify-between gap-3 rounded-panel border border-line bg-surface p-5 lg:mt-4 lg:p-8"
            }
          >
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
                {eyebrow}
              </p>
              <h1
                className={`mt-1 font-semibold tracking-tight ${
                  compact ? "text-2xl lg:text-3xl" : "text-2xl lg:text-4xl"
                }`}
              >
                {title}
              </h1>
              {description ? (
                <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">{description}</p>
              ) : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
          </header>
          {children}
        </div>
      </div>
    </main>
  );
}
