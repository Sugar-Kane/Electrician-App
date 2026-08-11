import { Eye } from "lucide-react";

import { endImpersonation } from "@/app/admin/impersonate/actions";
import { currentImpersonation } from "@/lib/request-context";

/**
 * The reminder that you are not yourself right now.
 *
 * Impersonation with write access is the most dangerous thing in the app: a
 * mis-tap cancels a real appointment and texts a real customer. So the state is
 * never implicit — it sits at the top of every page, in a colour used nowhere
 * else, naming the business and how long is left, with the way out beside it.
 *
 * Rendered above the page rather than inside it, so a page that forgets to
 * include it cannot exist.
 */
export async function ImpersonationBanner() {
  const impersonating = await currentImpersonation();
  if (!impersonating) return null;

  const minutes = Math.max(
    0,
    Math.round((new Date(impersonating.expiresAt).getTime() - Date.now()) / 60_000),
  );

  return (
    <div className="sticky top-0 z-[80] border-b border-brand/40 bg-brand text-on-brand">
      <div className="mx-auto flex max-w-[1760px] flex-wrap items-center gap-3 px-4 py-2">
        <Eye className="h-4 w-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 text-sm font-semibold">
          You are working inside {impersonating.organizationName}.
          <span className="ml-2 font-normal opacity-80">
            Anything you do here is real, and ends in {minutes} minute{minutes === 1 ? "" : "s"}.
          </span>
        </p>
        <form action={endImpersonation}>
          <button
            type="submit"
            className="tap-target rounded-chip border border-on-brand/30 px-3 text-xs font-bold"
          >
            Stop
          </button>
        </form>
      </div>
    </div>
  );
}
