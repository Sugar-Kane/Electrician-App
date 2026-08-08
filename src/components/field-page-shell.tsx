import { AppSidebar } from "@/components/app-sidebar";
import { MobileAppChrome } from "@/components/mobile-app-chrome";
import { AccountMenu } from "@/components/account-menu";

/**
 * The frame every page other than the dashboard renders inside.
 *
 * It carries the same left menu the dashboard has. Before, the menu existed
 * only on the dashboard, so choosing anything from it dropped you onto a page
 * with no navigation at all and a single "Dashboard" link back.
 */
export function FieldPageShell({
  title,
  eyebrow,
  description,
  active,
  children,
}: {
  title: string;
  eyebrow: string;
  description?: string;
  active?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="field-page min-h-screen bg-[#06131d] p-2 pb-28 text-white sm:p-3 lg:pb-3">
      <MobileAppChrome title={title} backHref="/" active={active} />
      <div className="mx-auto grid max-w-[1760px] gap-2 lg:grid-cols-[248px_minmax(0,1fr)]">
        <AppSidebar />
        <div className="min-w-0 lg:px-4 lg:py-2">
          <div className="hidden items-center justify-end gap-3 lg:flex">
            <AccountMenu />
          </div>
          <header className="mb-5 mt-3 rounded-3xl border border-white/10 bg-[#0b1b27] p-5 lg:mt-4 lg:p-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#ffc21c]">{eyebrow}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight lg:text-4xl">{title}</h1>
            {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{description}</p> : null}
          </header>
          {children}
        </div>
      </div>
    </main>
  );
}
