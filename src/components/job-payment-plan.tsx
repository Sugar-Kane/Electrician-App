"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2, LoaderCircle, Plus, Send, Trash2, Wallet } from "lucide-react";

import {
  recordPrepaymentAction,
  savePaymentPlanAction,
  sendPayLinkAction,
  setPaymentWorkDoneAction,
  type PaymentPlanState,
} from "@/app/jobs/[jobId]/payment-plan-actions";
import { FormMessage, inputClass } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { formatCents } from "@/lib/job-lines";
import { maxDownPaymentCents, paymentLabel, planAmounts, type PlanDue, type PlanItemInput } from "@/lib/payment-plan";
import type { JobPaymentPlan as Plan } from "@/lib/payment-plan-server";

/**
 * How the customer pays for the job: in full on completion, a deposit and the
 * balance, or installments. What is set here is printed on the contract they
 * sign. Money received before the invoice (a deposit in cash, say) is recorded
 * here too, and comes off the invoice when it is sent.
 */

type Row = { kind: "deposit" | "installment"; amountType: "fixed" | "percent"; value: string; due: PlanDue; dueDate: string };

const DUE_CHOICES = [
  { value: "on_signing", label: "On signing" },
  { value: "on_date", label: "On a date" },
  { value: "on_completion", label: "On completion" },
];

function rowsFrom(items: PlanItemInput[]): { rows: Row[]; finalDue: PlanDue; finalDate: string } {
  const rows: Row[] = items
    .filter((item) => item.kind !== "final")
    .map((item) => ({
      kind: item.kind === "deposit" ? "deposit" : "installment",
      amountType: item.amountType,
      value:
        item.amountType === "percent"
          ? String((item.percentBps ?? 0) / 100)
          : item.amountCents
            ? (item.amountCents / 100).toFixed(2)
            : "",
      due: item.due,
      dueDate: item.dueDate ?? "",
    }));
  const final = items.find((item) => item.kind === "final");
  return { rows, finalDue: final?.due ?? "on_completion", finalDate: final?.dueDate ?? "" };
}

function toItems(rows: Row[], finalDue: PlanDue, finalDate: string): PlanItemInput[] {
  if (rows.length === 0) return [];
  const items: PlanItemInput[] = rows.map((row) => {
    const number = Number(row.value.replace(/[$,%\s]/g, ""));
    return {
      kind: row.kind,
      amountType: row.amountType,
      amountCents: row.amountType === "fixed" && Number.isFinite(number) ? Math.round(number * 100) : null,
      percentBps: row.amountType === "percent" && Number.isFinite(number) ? Math.round(number * 100) : null,
      due: row.due,
      dueDate: row.due === "on_date" ? row.dueDate : null,
    };
  });
  items.push({ kind: "final", amountType: "fixed", due: finalDue, dueDate: finalDue === "on_date" ? finalDate : null });
  return items;
}

function PrepaymentForm({ jobNumber }: { jobNumber: string }) {
  const [state, action, pending] = useActionState<PaymentPlanState, FormData>(recordPrepaymentAction, { error: "" });
  const [method, setMethod] = useState("cash");
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="jobNumber" value={jobNumber} />
      <input type="hidden" name="method" value={method} />
      <div className="grid grid-cols-2 gap-2">
        <input name="amount" inputMode="decimal" placeholder="Amount received" aria-label="Amount received" className={inputClass} />
        <SelectField
          label="How it was paid"
          value={method}
          onChange={setMethod}
          choices={[
            { value: "cash", label: "Cash" },
            { value: "check", label: "Check" },
            { value: "other", label: "Other" },
          ]}
        />
      </div>
      <input name="note" placeholder="Note (optional), like check #1042" aria-label="Note" maxLength={300} className={inputClass} />
      <button
        type="submit"
        disabled={pending}
        className="tap-target inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-control border border-line px-4 text-sm font-semibold disabled:opacity-60"
      >
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Wallet className="h-4 w-4" aria-hidden />}
        Record payment received
      </button>
      <FormMessage error={state.error} notice={state.notice} />
    </form>
  );
}

/**
 * Each saved payment's pay link: whether it is paid, when the customer was
 * asked, and a button to text and email it now (or copy it). Deposits due on
 * signing go out by themselves once the contract is signed, and dated payments
 * on their date; the balance due on completion is asked for by the invoice.
 */
function PayLinks({ jobNumber, plan }: { jobNumber: string; plan: Plan & { canEdit: boolean } }) {
  const router = useRouter();
  const [sending, startSending] = useTransition();
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<PaymentPlanState & { id?: string }>({ error: "" });
  const [copied, setCopied] = useState("");
  const payments = plan.payments ?? [];
  if (payments.length <= 1 || plan.saved.length !== payments.length) return null;

  const send = (id: string) => {
    setBusy(id);
    startSending(async () => {
      const outcome = await sendPayLinkAction(jobNumber, id);
      setResult({ ...outcome, id });
      setBusy("");
      if (!outcome.error) router.refresh();
    });
  };
  const markDone = (id: string, done: boolean) => {
    setBusy(`done:${id}`);
    startSending(async () => {
      const outcome = await setPaymentWorkDoneAction(jobNumber, id, done);
      setResult({ ...outcome, id });
      setBusy("");
      if (!outcome.error) router.refresh();
    });
  };
  const copy = async (id: string, token: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/pay/${token}`);
      setCopied(id);
    } catch {
      setResult({ error: "Couldn't copy the link on this device.", id });
    }
  };

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-xs font-semibold text-ink-muted">Pay links</p>
      <p className="mt-1 text-xs leading-5 text-ink-faint">
        A deposit due on signing is sent when the customer signs. A progress payment can be asked for only once you mark its work done (California does not allow payments ahead of the work); a dated one then goes out on its date. The balance on completion is on the invoice.
      </p>
      <ul className="mt-2 space-y-2">
        {payments.map((payment, index) => {
          const saved = plan.saved[index];
          if (!saved) return null;
          const byInvoice = payment.kind === "final" && payment.due === "on_completion";
          const progress = payment.kind === "installment" && payment.due !== "on_signing";
          const waitingForWork = progress && !saved.doneAt && !saved.paid;
          return (
            <li key={saved.id} className="rounded-control border border-line p-2">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold">{paymentLabel(payment, index)}</span>
                <span className="font-semibold">{formatCents(payment.cents)}</span>
              </div>
              <p className="mt-0.5 text-xs text-ink-muted" suppressHydrationWarning>
                {saved.paid
                  ? "Paid"
                  : `${saved.owedCents < payment.cents ? `${formatCents(saved.owedCents)} left · ` : ""}${
                      saved.requestedAt
                        ? `Asked for ${new Date(saved.requestedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                        : byInvoice
                          ? "Asked for by the invoice"
                          : "Not asked for yet"
                    }`}
              </p>
              {progress ? (
                <p className="mt-0.5 text-xs text-ink-muted" suppressHydrationWarning>
                  {saved.doneAt
                    ? `Work marked done ${new Date(saved.doneAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                    : "Payable after its work is marked done"}
                </p>
              ) : null}
              {plan.canEdit && progress && !saved.paid ? (
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => markDone(saved.id, !saved.doneAt)}
                  className={`tap-target mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-control px-3 text-sm font-semibold disabled:opacity-60 ${
                    saved.doneAt ? "border border-line" : "bg-brand text-on-brand"
                  }`}
                >
                  {busy === `done:${saved.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                  {saved.doneAt ? "Undo work done" : "Mark work done"}
                </button>
              ) : null}
              {plan.canEdit && !saved.paid && !byInvoice && !waitingForWork ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => send(saved.id)}
                    className="tap-target inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control bg-brand px-3 text-sm font-semibold text-on-brand disabled:opacity-60"
                  >
                    {busy === saved.id ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                    {saved.requestedAt ? "Send again" : "Send pay link"}
                  </button>
                  <button
                    type="button"
                    onClick={() => copy(saved.id, saved.payToken)}
                    className="tap-target inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control border border-line px-3 text-sm font-semibold"
                  >
                    {copied === saved.id ? <Check className="h-4 w-4" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
                    {copied === saved.id ? "Copied" : "Copy link"}
                  </button>
                </div>
              ) : null}
              {result.id === saved.id ? <FormMessage error={result.error} notice={result.notice} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function JobPaymentPlan({ jobNumber, plan, locked }: { jobNumber: string; plan: Plan & { canEdit: boolean }; locked: boolean }) {
  const router = useRouter();
  const start = rowsFrom(plan.items);
  const [rows, setRows] = useState<Row[]>(start.rows);
  const [finalDue, setFinalDue] = useState<PlanDue>(start.finalDue);
  const [finalDate, setFinalDate] = useState(start.finalDate);
  const [state, setState] = useState<PaymentPlanState>({ error: "" });
  const [saving, startSaving] = useTransition();

  const items = useMemo(() => toItems(rows, finalDue, finalDate), [rows, finalDue, finalDate]);
  const preview = useMemo(() => (items.length > 0 ? planAmounts(plan.totalCents, items) : null), [items, plan.totalCents]);
  const editable = plan.canEdit && !locked;
  // California: a down payment of no more than 10% of the price or $1,000.
  const maxDown = maxDownPaymentCents(plan.totalCents);
  const legalDeposit = (maxDown / 100).toFixed(2);

  const preset = (kind: "full" | "deposit" | "installments") => {
    setState({ error: "" });
    if (kind === "full") {
      setRows([]);
      setFinalDue("on_completion");
    } else if (kind === "deposit") {
      setRows([{ kind: "deposit", amountType: "fixed", value: legalDeposit, due: "on_signing", dueDate: "" }]);
      setFinalDue("on_completion");
    } else {
      setRows([
        { kind: "deposit", amountType: "fixed", value: legalDeposit, due: "on_signing", dueDate: "" },
        { kind: "installment", amountType: "percent", value: "40", due: "on_date", dueDate: "" },
      ]);
      setFinalDue("on_date");
    }
  };

  const edit = (index: number, change: Partial<Row>) => setRows((current) => current.map((row, at) => (at === index ? { ...row, ...change } : row)));

  const save = () =>
    startSaving(async () => {
      const result = await savePaymentPlanAction(jobNumber, items);
      setState(result);
      if (!result.error) router.refresh();
    });

  return (
    <section aria-labelledby="payment-plan-heading" className="mt-3 rounded-control border border-line p-3">
      <h3 id="payment-plan-heading" className="text-sm font-semibold">
        Payment plan
      </h3>
      <p className="mt-1 text-xs leading-5 text-ink-muted">
        How the customer pays: in full on completion, a deposit and the balance, or installments. The contract shows it.
      </p>

      {editable ? (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(
            [
              ["full", "Pay in full"],
              ["deposit", "Deposit + balance"],
              ["installments", "Installments"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" onClick={() => preset(value)} className="tap-target min-h-11 rounded-control border border-line px-2 text-xs font-semibold sm:text-sm">
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-3 text-sm">Payment in full on completion{plan.totalCents > 0 ? ` · ${formatCents(plan.totalCents)}` : ""}.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {rows.map((row, index) => (
            <li key={index} className="space-y-2 rounded-control border border-line p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">
                  {row.kind === "deposit" ? "Deposit" : `Payment ${index + 1}`}
                  {row.kind === "deposit" || row.due === "on_signing" ? (
                    <span className="block text-xs font-normal text-ink-muted">Max {formatCents(maxDown)} by California law</span>
                  ) : null}
                </span>
                <span className="text-sm font-semibold">{preview?.ok ? formatCents(preview.payments[index]?.cents ?? 0) : ""}</span>
              </div>
              {editable ? (
                <>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input
                      value={row.value}
                      onChange={(event) => edit(index, { value: event.target.value })}
                      inputMode="decimal"
                      aria-label={row.amountType === "percent" ? "Percent of the total" : "Amount"}
                      placeholder={row.amountType === "percent" ? "25" : "500.00"}
                      className={inputClass}
                    />
                    <div className="flex overflow-hidden rounded-control border border-line" role="group" aria-label="Amount or percent">
                      {(["percent", "fixed"] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          aria-pressed={row.amountType === type}
                          onClick={() => edit(index, { amountType: type, value: "" })}
                          className={`tap-target min-h-11 px-3 text-sm font-semibold ${row.amountType === type ? "bg-brand text-on-brand" : ""}`}
                        >
                          {type === "percent" ? "%" : "$"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <SelectField label="When it is due" value={row.due} onChange={(value) => edit(index, { due: value as PlanDue })} choices={DUE_CHOICES} />
                    {row.due === "on_date" ? (
                      <input type="date" value={row.dueDate} onChange={(event) => edit(index, { dueDate: event.target.value })} aria-label="Due date" className={inputClass} />
                    ) : (
                      <span />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setRows((current) => current.filter((_, at) => at !== index))}
                    className="tap-target inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-critical"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden /> Remove
                  </button>
                </>
              ) : null}
            </li>
          ))}
          <li className="space-y-2 rounded-control border border-line p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">Balance</span>
              <span className="text-sm font-semibold">{preview?.ok ? formatCents(preview.payments.at(-1)?.cents ?? 0) : ""}</span>
            </div>
            {editable ? (
              <div className="grid grid-cols-2 gap-2">
                <SelectField
                  label="When the balance is due"
                  value={finalDue}
                  onChange={(value) => setFinalDue(value as PlanDue)}
                  choices={DUE_CHOICES.filter((choice) => choice.value !== "on_signing")}
                />
                {finalDue === "on_date" ? (
                  <input type="date" value={finalDate} onChange={(event) => setFinalDate(event.target.value)} aria-label="Balance due date" className={inputClass} />
                ) : (
                  <span />
                )}
              </div>
            ) : null}
          </li>
        </ol>
      )}

      {editable && rows.length > 0 ? (
        <button
          type="button"
          onClick={() => setRows((current) => [...current, { kind: "installment", amountType: "fixed", value: "", due: "on_date", dueDate: "" }])}
          className="tap-target mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add a payment
        </button>
      ) : null}

      {preview && !preview.ok ? <p className="mt-2 text-xs text-caution">{preview.reason}</p> : null}
      {plan.problem && !state.notice ? <p className="mt-2 text-xs text-caution">The saved plan no longer fits the job&apos;s price: {plan.problem}</p> : null}

      {editable ? (
        <button
          type="button"
          disabled={saving || Boolean(preview && !preview.ok)}
          onClick={save}
          className="tap-target mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-50"
        >
          {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
          Save payment plan
        </button>
      ) : null}
      <FormMessage error={state.error} notice={state.notice} />

      <PayLinks jobNumber={jobNumber} plan={plan} />

      <div className="mt-3 border-t border-line pt-3">
        <p className="text-xs font-semibold text-ink-muted">Paid before the invoice</p>
        {plan.prepayments.length === 0 ? (
          <p className="mt-1 text-xs text-ink-faint">Nothing yet.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {plan.prepayments.map((payment) => (
              <li key={payment.id} className="flex items-baseline justify-between gap-3">
                <span className="text-ink-muted">
                  {payment.method === "check" ? "Check" : payment.method === "cash" ? "Cash" : payment.method === "card" ? "Card" : payment.method === "ach" ? "Bank" : "Other"}
                  {payment.note ? ` · ${payment.note}` : ""}
                  {payment.applied ? " · on the invoice" : ""}
                </span>
                <span className="font-semibold">{formatCents(payment.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
        {editable ? (
          <details className="mt-2">
            <summary className="tap-target inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-brand">Record a deposit or payment received</summary>
            <div className="mt-2">
              <PrepaymentForm jobNumber={jobNumber} />
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
