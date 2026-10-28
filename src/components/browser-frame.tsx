import { ArrowUpRight, CalendarDays, Home, MessageSquare, Package, ReceiptText, Users, Wrench, Zap } from "lucide-react";

/**
 * Volteira in a browser window, for the front page: the address bar, the
 * app's own side navigation, and whatever screen is put inside.
 *
 * No hooks, so the server draws it around the hero's job and the steps
 * section draws it around each step's screen.
 */

export type FrameNav = "Today" | "Jobs" | "Customers" | "Materials" | "Messages" | "Invoices";

const NAV: { name: FrameNav; icon: typeof Home }[] = [
  { name: "Today", icon: Home },
  { name: "Jobs", icon: Wrench },
  { name: "Customers", icon: Users },
  { name: "Materials", icon: Package },
  { name: "Messages", icon: MessageSquare },
  { name: "Invoices", icon: ReceiptText },
];

export function BrowserFrame({
  path,
  active,
  label,
  bodyClassName = "",
  children,
}: {
  /** After "volteira.com / ". */
  path: string;
  active: FrameNav;
  /** What the picture shows, read out in place of the mock screen. */
  label: string;
  /** Sizes the screen area, so a frame that swaps screens never changes size. */
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className="overflow-hidden rounded-panel border border-line-strong bg-canvas text-left shadow-2xl shadow-black/50"
    >
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <span aria-hidden className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        </span>
        <p className="truncate text-center font-mono text-xs text-ink-muted">
          volteira.com <span className="text-ink-faint">/</span> {path}
        </p>
        <ArrowUpRight className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
      </div>
      <div className={`grid sm:grid-cols-[9.5rem_minmax(0,1fr)] ${bodyClassName}`}>
        <nav aria-hidden className="hidden border-r border-line bg-surface/60 px-2.5 py-3 sm:block">
          <p className="flex items-center gap-2 px-2 pb-3 text-sm font-bold tracking-[0.04em]">
            <span className="grid h-6 w-6 place-items-center rounded-[6px] bg-brand text-on-brand">
              <Zap className="h-3.5 w-3.5 fill-current" />
            </span>
            VOLTEIRA
          </p>
          <ul className="space-y-0.5">
            {NAV.map(({ name, icon: Icon }) => (
              <li
                key={name}
                className={`flex items-center gap-2 rounded-control px-2 py-1.5 text-xs ${
                  name === active ? "bg-brand/[0.12] font-semibold text-brand" : "text-ink-muted"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {name}
              </li>
            ))}
          </ul>
          <p className="mt-6 flex items-center gap-2 px-2 text-[11px] text-ink-faint">
            <CalendarDays className="h-3.5 w-3.5" />
            Ridgeway Electric
          </p>
        </nav>
        <div className="min-w-0 overflow-hidden p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
}
