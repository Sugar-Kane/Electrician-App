import { CheckCircle2, CreditCard, ExternalLink, TriangleAlert } from "lucide-react";

/**
 * Taking customers' money: the business's own Stripe account, connected to
 * Volteira. Deposits and invoice payments go straight to it.
 */

export type PaymentsCardState = "none" | "pending" | "restricted" | "active" | "disabled";

const NOTICES: Record<string, string> = {
  owner_only: "Only the owner can set up payments.",
  error: "Stripe couldn't start the setup. Try again in a minute.",
};

export function PaymentsCard({
  state,
  dueCount,
  canManage,
  notice,
  feePercent,
}: {
  state: PaymentsCardState;
  /** What Stripe still needs before the account can take charges. */
  dueCount: number;
  canManage: boolean;
  notice?: string;
  feePercent: string;
}) {
  const ready = state === "active";
  const started = state !== "none";

  return (
    <section id="payments" className="rounded-panel border border-brand/25 bg-surface p-5 sm:p-6 lg:col-span-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-control bg-brand/10 text-brand">
            <CreditCard className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <p className="text-xs text-ink-faint">Stripe</p>
            <h2 className="text-lg font-semibold">Customer payments</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
              Let customers pay booking deposits and invoices online, by card or bank transfer (ACH). The money goes to
              your own Stripe account and is paid out to your bank. Stripe&apos;s processing fee comes out of each payment,
              and Volteira keeps {feePercent}.
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-semibold ${
            ready ? "bg-positive-bg text-positive" : started ? "bg-caution-bg text-caution" : "bg-white/5 text-ink-muted"
          }`}
        >
          {ready ? "Taking payments" : state === "disabled" ? "Disabled by Stripe" : started ? "Setup not finished" : "Not set up"}
        </span>
      </div>

      {ready ? (
        <p className="mt-5 flex items-start gap-2 rounded-control border border-positive/25 bg-positive-bg p-4 text-sm leading-6">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden />
          Customers can pay online now. Each invoice link has a Pay button, and booking deposits are charged when a visit
          is booked.
        </p>
      ) : started ? (
        <p className="mt-5 flex items-start gap-2 rounded-control border border-caution/30 bg-caution-bg/40 p-4 text-sm leading-6">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-caution" aria-hidden />
          {state === "disabled"
            ? "Stripe has turned off payments on this account. Open your Stripe dashboard to see why."
            : `Stripe still needs ${dueCount > 0 ? `${dueCount} more detail${dueCount === 1 ? "" : "s"}` : "a few details"} before customers can pay you online. Until then, invoices say to call you, and bookings that need a deposit come to you as requests.`}
        </p>
      ) : null}

      {notice && NOTICES[notice] ? <p className="mt-4 text-sm text-danger">{NOTICES[notice]}</p> : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {canManage && !ready && state !== "disabled" ? (
          <form action="/settings/payments/start" method="post">
            <button className="tap-target min-h-11 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand">
              {started ? "Finish setup in Stripe" : "Set up payments"}
            </button>
          </form>
        ) : null}
        {started ? (
          <a
            href="https://dashboard.stripe.com"
            target="_blank"
            rel="noreferrer"
            className="tap-target inline-flex min-h-11 items-center gap-1.5 rounded-control border border-line px-4 text-sm font-semibold"
          >
            Open Stripe dashboard
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        ) : null}
        {!canManage ? <p className="text-xs text-ink-muted">Only the owner can set up payments.</p> : null}
      </div>
    </section>
  );
}
