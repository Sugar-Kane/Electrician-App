"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Eye, LoaderCircle, Send, Wallet } from "lucide-react";

import {
  recordInvoicePayment,
  sendInvoice,
  sendInvoicePreview,
  type InvoiceActionState,
} from "@/app/invoices/actions";
import { inputClass } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { formatCents } from "@/lib/job-lines";
import type { JobInvoiceSummary } from "@/lib/job-line-data";
import { PAYMENT_METHODS } from "@/lib/invoice-payment";

/**
 * What to do next with each of the job's invoices, in the job's billing
 * section: preview it, send it, or record that it was paid.
 *
 * The invoice goes to the customer twice, in effect. Once the contract is
 * signed they can be sent a preview (what they will be billed, nothing due
 * yet), and the real invoice goes when the work is complete. Sending the
 * preview leaves the invoice a draft, so its lines can still change.
 */

const initial: InvoiceActionState = { error: "" };

function shortDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ""
    : at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Submit({ label, pendingLabel, icon: Icon, primary }: {
  label: string;
  pendingLabel: string;
  icon: typeof Send;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control px-3 text-sm font-semibold disabled:opacity-60 ${
        primary ? "bg-brand text-on-brand" : "border border-brand text-brand"
      }`}
    >
      {pending ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : <Icon className="h-4 w-4 shrink-0" aria-hidden />}
      {pending ? pendingLabel : label}
    </button>
  );
}

function Outcome({ state }: { state: InvoiceActionState }) {
  if (state.error) return <p className="mt-2 text-xs text-critical">{state.error}</p>;
  if (state.notice) {
    return (
      <p className="mt-2 text-xs text-positive" role="status">
        {state.notice}
      </p>
    );
  }
  return null;
}

/** Text and email boxes, ticked for whichever the customer has. */
function Channels({ hasPhone, hasEmail }: { hasPhone: boolean; hasEmail: boolean }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
      <label className="inline-flex min-h-11 items-center gap-2">
        <input type="checkbox" name="sendSms" defaultChecked={hasPhone} disabled={!hasPhone} className="h-4 w-4" />
        Text{hasPhone ? "" : " (no phone)"}
      </label>
      <label className="inline-flex min-h-11 items-center gap-2">
        <input type="checkbox" name="sendEmail" defaultChecked={hasEmail} disabled={!hasEmail} className="h-4 w-4" />
        Email{hasEmail ? "" : " (no email)"}
      </label>
    </div>
  );
}

function PreviewForm({ invoice, hasPhone, hasEmail }: { invoice: JobInvoiceSummary; hasPhone: boolean; hasEmail: boolean }) {
  const [state, action] = useActionState(sendInvoicePreview, initial);
  return (
    <form action={action}>
      <input type="hidden" name="invoiceId" value={invoice.id} />
      <p className="mb-2 text-xs leading-5 text-ink-muted">
        The contract is signed. Send {invoice.label} as a preview: the customer sees what they will be billed, with
        nothing due yet.
      </p>
      <Channels hasPhone={hasPhone} hasEmail={hasEmail} />
      <Submit
        label={invoice.previewSentAt ? "Send the preview again" : "Send invoice preview"}
        pendingLabel="Sending preview…"
        icon={Eye}
        primary
      />
      {invoice.previewSentAt ? (
        <p className="mt-2 text-xs text-ink-muted">Preview sent {shortDate(invoice.previewSentAt)}.</p>
      ) : null}
      <p className="mt-2 rounded-control bg-white/[0.03] p-2.5 text-xs leading-5 text-ink-muted">
        Send the final invoice when the work is complete.
      </p>
      <Outcome state={state} />
    </form>
  );
}

function SendForm({ invoice, hasPhone, hasEmail }: { invoice: JobInvoiceSummary; hasPhone: boolean; hasEmail: boolean }) {
  const [state, action] = useActionState(sendInvoice, initial);
  return (
    <form action={action}>
      <input type="hidden" name="invoiceId" value={invoice.id} />
      <p className="mb-2 text-xs leading-5 text-ink-muted">
        The work is complete. Send {invoice.label} for {formatCents(invoice.totalCents)}.
      </p>
      <Channels hasPhone={hasPhone} hasEmail={hasEmail} />
      <Submit label="Send invoice" pendingLabel="Sending…" icon={Send} primary />
      <Outcome state={state} />
    </form>
  );
}

function PaymentForm({ invoice }: { invoice: JobInvoiceSummary }) {
  const [state, action] = useActionState(recordInvoicePayment, initial);
  const owed = (invoice.balanceDueCents / 100).toFixed(2);
  return (
    <form action={action}>
      <input type="hidden" name="invoiceId" value={invoice.id} />
      {invoice.onlineProcessingCents ? (
        <p className="mb-2 rounded-control border border-info/40 bg-info-bg/40 p-2 text-xs leading-5">
          The customer paid {formatCents(invoice.onlineProcessingCents)} online by bank transfer. It is clearing, which usually
          takes 3–5 business days, and the invoice will be marked paid when it does. Don&apos;t record it here as well.
        </p>
      ) : null}
      <p className="mb-2 text-xs leading-5 text-ink-muted">
        {formatCents(invoice.balanceDueCents)} owed on {invoice.label}. The customer can pay online from their invoice link,
        by bank transfer or card, and that is recorded for you. Record a payment here when they pay you another way.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <SelectField name="method" defaultValue="check" label="How they paid" choices={PAYMENT_METHODS} />
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={owed}
          aria-label="Amount paid"
          className={inputClass}
        />
      </div>
      <input name="note" placeholder="Note (check number, optional)" aria-label="Note" className={`${inputClass} mt-2`} />
      <div className="mt-2">
        <Submit label="Record payment" pendingLabel="Recording…" icon={Wallet} primary />
      </div>
      <Outcome state={state} />
    </form>
  );
}

export function InvoiceSteps({
  invoices,
  jobCompleted,
  agreementSigned,
  hasPhone,
  hasEmail,
}: {
  /** Live invoices only (not void), newest first. */
  invoices: JobInvoiceSummary[];
  jobCompleted: boolean;
  agreementSigned: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
}) {
  if (invoices.length === 0) return null;

  return (
    <div className="mt-3 space-y-3">
      {invoices.map((invoice) => {
        const paid = invoice.status === "paid" || Boolean(invoice.paidAt);
        const sent = !paid && (invoice.status !== "draft" || Boolean(invoice.lastSentAt));

        return (
          <div key={invoice.id} className="rounded-control border border-line p-3">
            {paid ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-positive">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {invoice.label} paid{invoice.paidAt ? ` ${shortDate(invoice.paidAt)}` : ""}.
              </p>
            ) : sent ? (
              <PaymentForm invoice={invoice} />
            ) : jobCompleted ? (
              <SendForm invoice={invoice} hasPhone={hasPhone} hasEmail={hasEmail} />
            ) : agreementSigned ? (
              <PreviewForm invoice={invoice} hasPhone={hasPhone} hasEmail={hasEmail} />
            ) : (
              <p className="text-xs leading-5 text-ink-muted">
                {invoice.label} is a draft. Once the contract is signed you can send the customer a preview, and the
                invoice itself when the work is complete.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
