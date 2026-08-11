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
  children,
}: {
  title: string;
  eyebrow: string;
  description?: string;
  backHref?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-canvas p-2 pb-28 text-ink sm:p-3 lg:pb-3">
      <MobileAppChrome title={title} backHref={backHref} />
      <div className="mx-auto grid max-w-[1760px] gap-2 lg:grid-cols-[248px_minmax(0,1fr)]">
        <AppSidebar />
        <div className="min-w-0 lg:px-4 lg:py-2">
          <div className="hidden items-center justify-end gap-3 lg:flex">
            <AccountMenu />
          </div>
          <header className="mb-5 mt-3 rounded-panel border border-line bg-surface p-5 lg:mt-4 lg:p-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
              {eyebrow}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight lg:text-4xl">{title}</h1>
            {description ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">{description}</p>
            ) : null}
          </header>
          {children}
        </div>
      </div>
    </main>
  );
}
