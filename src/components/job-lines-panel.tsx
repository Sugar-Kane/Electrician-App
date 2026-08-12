"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Clock, LoaderCircle, Package, Plus, ReceiptText, Trash2 } from "lucide-react";

import {
  addJobLine,
  removeJobLine,
  type LineActionState,
} from "@/app/jobs/[jobId]/line-actions";
import { raiseInvoice, type RaiseInvoiceState } from "@/app/jobs/[jobId]/invoice-actions";
import { inputClass } from "@/components/ui/field";
import {
  formatCents,
  formatQuantity,
  lineTotalCents,
  type JobLine,
  type JobLineTotals,
} from "@/lib/job-lines";
import type { StockOption } from "@/lib/job-line-data";

/**
 * What the job is made of, and what it comes to.
 *
 * The old Materials section rendered `job.materials`, which was hardcoded to an
 * empty array for every real job — so an electrician saw "nothing listed for
 * this job yet" whatever they did, forever. Labour had no home at all, and the
 * invoice subtotal was a number somebody typed in from memory.
 *
 * Labour and parts are one list because they are one bill. The split is shown
 * in the totals, where it is useful, rather than as two sections to fill in.
 */

const initialState: LineActionState = { error: "" };
const invoiceInitialState: RaiseInvoiceState = { error: "" };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand text-sm font-semibold text-on-brand disabled:opacity-60"
    >
      {pending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Plus className="h-4 w-4" aria-hidden />
      )}
      {label}
    </button>
  );
}

function RemoveButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Remove line"
      className="tap-target grid h-11 w-11 shrink-0 place-items-center rounded-control text-ink-faint disabled:opacity-60"
    >
      {pending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Trash2 className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}

function AddLineForm({
  jobNumber,
  kind,
  stock,
  onDone,
}: {
  jobNumber: string;
  kind: "labour" | "material";
  stock: StockOption[];
  onDone: () => void;
}) {
  const [state, action] = useActionState(addJobLine, initialState);

  // Picking from stock fills the name, unit and price, so the common case is
  // one tap and a quantity. Typing over any of it afterwards is fine — the
  // fields stay editable, because the price on the van is not always the price.
  const [chosen, setChosen] = useState<StockOption | null>(null);

  const labour = kind === "labour";

  return (
    <form action={action} className="mt-3 space-y-2 rounded-control border border-line p-3">
      <input type="hidden" name="jobNumber" value={jobNumber} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="inventoryItemId" value={chosen?.id ?? ""} />

      {!labour && stock.length > 0 ? (
        <label className="block">
          <span className="text-xs font-semibold text-ink-muted">From stock</span>
          <select
            value={chosen?.id ?? ""}
            onChange={(event) => {
              const found = stock.find((item) => item.id === event.target.value);
              setChosen(found ?? null);
            }}
            className={`mt-1 ${inputClass}`}
          >
            <option value="">Not from stock</option>
            {stock.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.quantityOnHand > 0 ? ` · ${item.quantityOnHand} on hand` : " · none on hand"}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block">
        <span className="text-xs font-semibold text-ink-muted">
          {labour ? "What was done" : "Part"}
        </span>
        <input
          name="description"
          required
          // Keyed to the chosen item so picking from stock refills an
          // uncontrolled input that the technician may already have typed in.
          key={chosen?.id ?? "blank"}
          defaultValue={chosen?.name ?? ""}
          placeholder={labour ? "Traced and replaced backstabbed receptacle" : "20A AFCI breaker"}
          className={`mt-1 ${inputClass}`}
        />
      </label>

      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="text-xs font-semibold text-ink-muted">
            {labour ? "Hours" : "Qty"}
          </span>
          <input
            name="quantity"
            inputMode="decimal"
            defaultValue="1"
            className={`mt-1 ${inputClass}`}
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-ink-muted">Unit</span>
          <input
            name="unit"
            key={`unit-${chosen?.id ?? "blank"}`}
            defaultValue={labour ? "hr" : (chosen?.unit ?? "each")}
            className={`mt-1 ${inputClass}`}
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-ink-muted">Each</span>
          <input
            name="unitPrice"
            inputMode="decimal"
            key={`price-${chosen?.id ?? "blank"}`}
            defaultValue={
              chosen && chosen.unitPriceCents > 0
                ? (chosen.unitPriceCents / 100).toFixed(2)
                : ""
            }
            placeholder="0.00"
            className={`mt-1 ${inputClass}`}
          />
        </label>
      </div>

      {state.error ? <p className="text-xs text-critical">{state.error}</p> : null}

      <div className="flex gap-2">
        <SubmitButton label={labour ? "Add labour" : "Add part"} />
        <button
          type="button"
          onClick={onDone}
          className="tap-target inline-flex min-h-12 items-center justify-center rounded-control border border-line px-4 text-sm font-semibold"
        >
          Done
        </button>
      </div>
    </form>
  );
}

/**
 * Billing what the lines add up to.
 *
 * `raiseInvoice` has existed since the diagnostic-credit work and no component
 * ever called it — there was no honest number to send it, because a job had no
 * lines. Now there is, so the amount is left out of the form entirely and the
 * action sums the job itself. One number, derived once, on the server.
 */
function RaiseInvoiceForm({ jobNumber, subtotalCents }: { jobNumber: string; subtotalCents: number }) {
  const [state, action] = useActionState(raiseInvoice, invoiceInitialState);

  return (
    <form action={action} className="mt-3 border-t border-line pt-3">
      <input type="hidden" name="jobNumber" value={jobNumber} />

      {state.error ? <p className="mb-2 text-xs text-critical">{state.error}</p> : null}
      {state.notice ? <p className="mb-2 text-xs text-positive">{state.notice}</p> : null}

      <InvoiceButton subtotalCents={subtotalCents} />
      <p className="mt-1.5 text-center text-xs text-ink-muted">
        Creates a draft. Nothing is sent to the customer until you send it.
      </p>
    </form>
  );
}

function InvoiceButton({ subtotalCents }: { subtotalCents: number }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-brand text-sm font-semibold text-brand disabled:opacity-60"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : (
        <ReceiptText className="h-4 w-4" aria-hidden />
      )}
      Invoice {formatCents(subtotalCents)}
    </button>
  );
}

function LineRow({ jobNumber, line }: { jobNumber: string; line: JobLine }) {
  const [state, action] = useActionState(removeJobLine, initialState);
  const Icon = line.kind === "labour" ? Clock : Package;

  return (
    <li className="flex items-center gap-2 border-b border-line py-2 last:border-b-0">
      <Icon className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{line.description}</span>
        <span className="block text-xs text-ink-muted">
          {formatQuantity(line.quantity)} {line.unit} × {formatCents(line.unitPriceCents)}
          {state.error ? <span className="text-critical"> · {state.error}</span> : null}
        </span>
      </span>
      <span className="shrink-0 text-sm font-semibold">{formatCents(lineTotalCents(line))}</span>
      <form action={action}>
        <input type="hidden" name="jobNumber" value={jobNumber} />
        <input type="hidden" name="lineId" value={line.id} />
        <RemoveButton />
      </form>
    </li>
  );
}

export function JobLinesPanel({
  jobNumber,
  lines,
  totals,
  stock,
}: {
  jobNumber: string;
  lines: JobLine[];
  totals: JobLineTotals;
  stock: StockOption[];
}) {
  const [adding, setAdding] = useState<"labour" | "material" | null>(null);

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Work &amp; materials</h2>
        {totals.subtotalCents > 0 ? (
          <span className="text-sm font-semibold">{formatCents(totals.subtotalCents)}</span>
        ) : null}
      </div>

      {lines.length === 0 ? (
        // "What goes here is what the invoice bills for" was true and was read
        // by the same person forty times a week. The Invoice button appearing
        // the moment a line exists says it better than a sentence does.
        <p className="mt-2 text-sm text-ink-muted">No items yet.</p>
      ) : (
        <>
          <ul className="mt-2">
            {lines.map((line) => (
              <LineRow key={line.id} jobNumber={jobNumber} line={line} />
            ))}
          </ul>

          {/* Split out only when there is something in both. On a parts-only
              job a "Labour $0.00" row is a line that says nothing. */}
          {totals.labourCents > 0 && totals.materialCents > 0 ? (
            <dl className="mt-3 space-y-1 text-xs text-ink-muted">
              <div className="flex justify-between">
                <dt>Labour</dt>
                <dd>{formatCents(totals.labourCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Parts</dt>
                <dd>{formatCents(totals.materialCents)}</dd>
              </div>
            </dl>
          ) : null}
        </>
      )}

      {/* Only once there is something to bill. A button offering to invoice
          $0.00 is a button that creates a draft nobody wanted. */}
      {totals.subtotalCents > 0 ? (
        <RaiseInvoiceForm jobNumber={jobNumber} subtotalCents={totals.subtotalCents} />
      ) : null}

      {adding ? (
        <AddLineForm
          // Remounted per kind so switching between labour and parts does not
          // carry the other one's half-typed line across.
          key={adding}
          jobNumber={jobNumber}
          kind={adding}
          stock={stock}
          onDone={() => setAdding(null)}
        />
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setAdding("labour")}
            className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line text-sm font-semibold"
          >
            <Clock className="h-4 w-4" aria-hidden />
            Add labour
          </button>
          <button
            type="button"
            onClick={() => setAdding("material")}
            className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line text-sm font-semibold"
          >
            <Package className="h-4 w-4" aria-hidden />
            Add part
          </button>
        </div>
      )}
    </section>
  );
}
