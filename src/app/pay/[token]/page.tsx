import type { Metadata } from "next";
import { CheckCircle2, Clock, Landmark, Phone, ReceiptText, Wallet } from "lucide-react";

import { dueWords, payLinkView } from "@/lib/job-prepayment-pay";

/**
 * The customer's pay link for a deposit or an installment.
 *
 * Reached by an unguessable token, not a session. It shows what this payment
 * asks for now (what is left of it, less anything already paid or on its way
 * by bank) and a Pay button to Stripe, by bank (ACH) or card. Once the job's
 * invoice is out, the invoice asks for what is owed, and this page sends the
 * customer there.
 */

export const metadata: Metadata = {
  title: "Make a payment",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

const PAY_PROBLEMS: Record<string, string> = {
  processing: "A bank payment for this job is already on its way, so there is nothing to pay right now.",
  paid: "Nothing is owed on this payment. Thank you.",
  busy: "A payment for this job was just started. Wait a minute, then refresh this page to see where it stands.",
  not_payable: "This payment can't be made online right now. Call the business and they will help.",
  unavailable: "Online payment isn't working right now. Try again in a few minutes, or call the business.",
};

export default async function PayLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string; pay?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const found = UUID.test(token) ? await payLinkView(token) : null;

  if (found && "unavailable" in found) {
    return (
      <main id="main-content" className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-white">
        <section className="w-full max-w-lg rounded-[28px] border border-line bg-[#081925] p-6 text-center sm:p-8">
          <h1 className="text-2xl font-semibold">This page can&apos;t load right now</h1>
          <p className="mt-3 text-sm leading-6 text-ink-muted">Try again in a few minutes. Nothing has been charged.</p>
        </section>
      </main>
    );
  }
  const view = found;

  if (!view) {
    return (
      <main id="main-content" className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-white">
        <section className="w-full max-w-lg rounded-[28px] border border-line bg-[#081925] p-6 text-center sm:p-8">
          <h1 className="text-2xl font-semibold">We could not find that payment</h1>
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            The link may be old, or the payment plan may have changed. Call the business and they will send it again.
          </p>
        </section>
      </main>
    );
  }

  const { payment, amountCents, processingCents, canPay, notYet } = view;
  const tel = payment.businessPhone.replace(/[^\d+]/g, "");
  const invoiceOut = Boolean(payment.invoiceToken);
  const settled = !invoiceOut && amountCents === 0 && processingCents === 0;
  const justPaid = query.paid === "1" && !settled;
  const problem = query.pay && query.pay !== "invoice" ? PAY_PROBLEMS[query.pay] : undefined;
  // More than this payment alone: an earlier one is still owed and comes with it.
  const includesEarlier = amountCents > payment.payment.cents;
  const forJob = payment.jobNumber ? ` · job #${payment.jobNumber}` : "";

  return (
    <main id="main-content" className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-white">
      <section className="w-full max-w-lg rounded-[28px] border border-line bg-[#081925] p-6 sm:p-8">
        <span
          className={`grid h-14 w-14 place-items-center rounded-full ${
            settled ? "bg-positive-bg text-positive" : invoiceOut ? "bg-info-bg text-info" : "bg-caution-bg text-caution"
          }`}
        >
          {settled ? <CheckCircle2 className="h-7 w-7" aria-hidden /> : invoiceOut ? <ReceiptText className="h-7 w-7" aria-hidden /> : <Wallet className="h-7 w-7" aria-hidden />}
        </span>

        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
          {payment.label}
          {forJob}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">
          {settled ? "Paid, thank you" : invoiceOut ? "Your invoice is ready" : processingCents > 0 && amountCents === 0 ? "Payment on its way" : `${money(amountCents)} due`}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          {payment.businessName}
          {payment.customerFirstName ? ` · for ${payment.customerFirstName}` : ""}
        </p>

        {invoiceOut ? (
          <p className="mt-5 rounded-control border border-info/40 bg-info-bg/40 p-3 text-sm leading-6">
            The invoice for this job has been sent. It counts what you have already paid and shows what is left.
          </p>
        ) : (
          <dl className="mt-5 space-y-1.5 border-y border-line py-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt>
                {payment.label} {dueWords(payment.payment, payment.timeZone)}
              </dt>
              <dd className="shrink-0 font-semibold">{money(payment.payment.cents)}</dd>
            </div>
            {includesEarlier ? (
              <div className="flex justify-between gap-3 text-ink-muted">
                <dt>Earlier payment still owed</dt>
                <dd className="shrink-0">{money(amountCents - payment.payment.cents)}</dd>
              </div>
            ) : null}
            {payment.prepaidCents > 0 ? (
              <div className="flex justify-between gap-3 text-ink-muted">
                <dt>Paid toward the job so far</dt>
                <dd className="shrink-0">{money(payment.prepaidCents)}</dd>
              </div>
            ) : null}
          </dl>
        )}

        {processingCents > 0 ? (
          <p className="mt-6 flex gap-3 rounded-control border border-info/40 bg-info-bg/40 p-3 text-sm leading-6">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
            <span>
              Your bank payment of {money(processingCents)} is on its way. Bank transfers usually take 3–5 business days to clear,
              and this page will say paid once it has.
            </span>
          </p>
        ) : justPaid ? (
          <p className="mt-6 flex gap-3 rounded-control border border-info/40 bg-info-bg/40 p-3 text-sm leading-6">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
            <span>Thank you. Your payment is being confirmed; refresh in a minute to see it.</span>
          </p>
        ) : null}

        {problem && !justPaid ? (
          <p className="mt-6 rounded-control border border-caution/40 bg-caution-bg/40 p-3 text-sm leading-6">{problem}</p>
        ) : null}

        {invoiceOut ? (
          <a
            href={`/invoice/${encodeURIComponent(payment.invoiceToken ?? "")}`}
            className="tap-target mt-8 flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 py-2 text-center font-semibold text-on-brand"
          >
            <ReceiptText className="h-5 w-5" aria-hidden />
            View your invoice
          </a>
        ) : notYet ? (
          <p className="mt-8 rounded-control border border-line bg-canvas px-4 py-3 text-sm leading-6 text-ink-muted">
            {payment.signed
              ? "This payment opens once the work it covers is done. The business will send you the link again then."
              : "This payment opens once the contract is signed."}
          </p>
        ) : canPay && !justPaid ? (
          <form action={`/pay/${encodeURIComponent(token)}/checkout`} method="post" className="mt-8">
            <button
              type="submit"
              className="tap-target flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 py-2 text-center font-semibold text-on-brand"
            >
              <Landmark className="h-5 w-5" aria-hidden />
              Pay {money(amountCents)} online
            </button>
            <p className="mt-2 text-center text-xs leading-5 text-ink-muted">By bank transfer (ACH) or card, securely through Stripe.</p>
          </form>
        ) : null}

        {payment.businessPhone ? (
          <a
            href={`tel:${tel}`}
            className={`tap-target ${canPay || invoiceOut ? "mt-3 border border-line text-white" : "mt-8 bg-brand text-on-brand"} flex min-h-12 items-center justify-center gap-2 rounded-control px-5 py-2 text-center font-semibold`}
          >
            <Phone className="h-5 w-5" aria-hidden />
            <span>
              {canPay || invoiceOut ? "Or call " : "Call "}
              <span className="whitespace-nowrap">{payment.businessPhone}</span>
            </span>
          </a>
        ) : null}
      </section>
    </main>
  );
}
