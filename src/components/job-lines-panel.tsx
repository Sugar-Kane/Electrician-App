"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Clock, LoaderCircle, Lock, Package, Plus, ReceiptText, Trash2 } from "lucide-react";

import {
  addJobLine,
  removeJobLine,
  type LineActionState,
} from "@/app/jobs/[jobId]/line-actions";
import { raiseInvoice, type RaiseInvoiceState } from "@/app/jobs/[jobId]/invoice-actions";
import { StockPicker } from "@/components/stock-picker";
import { inputClass } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import {
  formatCents,
  formatQuantity,
  lineTotalCents,
  parsePriceCents,
  parseQuantity,
  partsCost,
  type JobLine,
  type JobLineTotals,
} from "@/lib/job-lines";
import { invoiceIsLive, lineLockedBecause, nextBillingStep } from "@/lib/job-billing";
import type { JobInvoiceSummary, StockOption } from "@/lib/job-line-data";
import { stockReservedNote, stockShortfall } from "@/lib/stock-choices";
import { PACK_CONTENTS, PACK_UNITS, PART_UNITS, packLabel, unitLabel } from "@/lib/stock-reservation";

/** What a job's stock part has done so far: held for the job, or taken off the count. */
export type LineStock = { reserved: number; taken: number; itemUnit: string };

/**
 * What the job is made of, and what it comes to.
 *
 * The old Materials section rendered `job.materials`, which was hardcoded to an
 * empty array for every real job — so an electrician saw "nothing listed for
 * this job yet" whatever they did, forever. Labor had no home at all, and the
 * invoice subtotal was a number somebody typed in from memory.
 *
 * Labor and parts are one list because they are one bill. The split is shown
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
  kind: "labor" | "material";
  stock: StockOption[];
  onDone: () => void;
}) {
  const [state, action] = useActionState(addJobLine, initialState);

  // Picking from stock fills the name, unit and price, so the common case is
  // one tap and a quantity. Typing over any of it afterwards is fine — the
  // fields stay editable, because the price on the van is not always the price.
  //
  // Held by id and looked up in `stock` each time, so the count beside it is
  // the one the page last drew. Adding a part redraws the page with the new
  // count; a copy of the item taken before would go on saying there were six.
  const [chosenId, setChosenId] = useState("");
  const chosen = stock.find((item) => item.id === chosenId) ?? null;

  // Controlled, unlike the boxes around it, because the warning below reads
  // it. Left uncontrolled with an onChange, it went quiet after an add: React
  // resets the form behind its own back, so typing the same number again
  // looked like no change at all.
  const [quantityText, setQuantityText] = useState("1");

  // Controlled for the same reason: React empties uncontrolled boxes after
  // every action, and a refused line should not lose its name.
  const [descriptionText, setDescriptionText] = useState("");

  // Read for the line total under the boxes. Cleared with the quantity after
  // an add. Never filled from stock: what a part cost is not what to charge.
  const [priceText, setPriceText] = useState("");

  // What one cost the business. Worked out from the stock item until somebody
  // types over it; left blank, it is recorded as unknown rather than as free.
  const [costText, setCostText] = useState("");
  const [costTyped, setCostTyped] = useState(false);

  // Counted in a trade unit; a box, roll or stick can say what it holds.
  const [unit, setUnit] = useState(kind === "labor" ? "hr" : "each");
  const [packText, setPackText] = useState("");
  const [packUnit, setPackUnit] = useState<string>("ft");

  // The stock item the last added part came from, for the count it left.
  const [takenId, setTakenId] = useState("");
  const taken = stock.find((item) => item.id === takenId) ?? null;

  // Bumped each time an add finishes, so the search starts empty again.
  const [round, setRound] = useState(0);

  /*
   * Once the action is done React puts every uncontrolled box back the way it
   * started, whatever the action said. What is kept in state goes back with
   * them, and a part that was added is let go — left picked, the boxes would
   * refill with it and the next tap would take another off the shelf.
   */
  const [settled, setSettled] = useState(state);
  if (state !== settled) {
    setSettled(state);
    // A refused line keeps everything typed, so fixing the one box named in
    // the message is all it takes. Only a line that was added clears.
    if (!state.error) {
      setDescriptionText("");
      setQuantityText("1");
      setPriceText("");
      setCostText("");
      setCostTyped(false);
      setPackText("");
      setUnit(kind === "labor" ? "hr" : "each");
      setRound(round + 1);
      setTakenId(chosenId);
      setChosenId("");
    }
  }

  const labor = kind === "labor";
  const packSize = parseQuantity(packText);
  // How many of the stock item's units one of this line's units is: 1 in its
  // own unit, the pack size when a stick holds feet of conduit counted in feet.
  const perUnit = chosen
    ? unit === chosen.unit
      ? 1
      : PACK_UNITS.has(unit) && packSize && packUnit === chosen.unit
        ? packSize
        : null
    : null;
  const cost =
    costTyped || !chosen
      ? costText
      : perUnit && chosen.unitCostCents > 0
        ? ((chosen.unitCostCents * perUnit) / 100).toFixed(2)
        : "";
  const stockNeeded =
    chosen && perUnit !== null ? (parseQuantity(quantityText) ?? 0) * perUnit : parseQuantity(quantityText);
  const shortfall = chosen ? stockShortfall(chosen, stockNeeded) : "";

  return (
    <form action={action} className="mt-3 space-y-2 rounded-control border border-line p-3">
      <input type="hidden" name="jobNumber" value={jobNumber} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="inventoryItemId" value={chosen?.id ?? ""} />

      {labor ? null : stock.length > 0 ? (
        <StockPicker
          key={round}
          stock={stock}
          picked={chosen}
          onPick={(item) => {
            setChosenId(item.id);
            setTakenId("");
            setDescriptionText(item.name);
            setUnit(item.unit || "each");
            setCostTyped(false);
          }}
          onClear={() => {
            setChosenId("");
            setCostTyped(false);
          }}
        />
      ) : (
        // Said, rather than the picker quietly not being there. Without it
        // nothing on this form says parts can come from inventory at all.
        <p className="flex flex-wrap items-center gap-x-1 text-xs leading-5 text-ink-muted">
          <span>Nothing in inventory yet, so type the part below.</span>
          <Link
            href="/inventory"
            className="tap-target -my-2 inline-flex min-h-11 items-center px-1 font-semibold text-brand"
          >
            Add stock
          </Link>
        </p>
      )}

      <label className="block">
        <span className="text-xs font-semibold text-ink-muted">
          {labor ? "What was done" : "Part"}
        </span>
        <input
          name="description"
          required
          value={descriptionText}
          onChange={(event) => setDescriptionText(event.target.value)}
          placeholder={labor ? "Traced and replaced backstabbed receptacle" : "20A AFCI breaker"}
          className={`mt-1 ${inputClass}`}
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs font-semibold text-ink-muted">{labor ? "Hours" : "Quantity"}</span>
          <input
            name="quantity"
            inputMode="decimal"
            value={quantityText}
            onChange={(event) => setQuantityText(event.target.value)}
            className={`mt-1 ${inputClass}`}
          />
        </label>

        {labor ? (
          <input type="hidden" name="unit" value="hr" />
        ) : (
          <div className="block">
            <span className="text-xs font-semibold text-ink-muted">Unit</span>
            <input type="hidden" name="unit" value={unit} />
            <div className="mt-1">
              <SelectField
                label="Unit"
                choices={[...PART_UNITS, ...(PART_UNITS.includes(unit as never) ? [] : [unit])].map((value) => ({
                  value,
                  label: value,
                }))}
                value={unit}
                onChange={setUnit}
              />
            </div>
          </div>
        )}
      </div>

      {/* A box, roll or stick says what it holds, so the conversion is written
          down rather than worked out in somebody's head at the counter. */}
      {!labor && PACK_UNITS.has(unit) ? (
        <div className="rounded-control border border-line p-2">
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <label className="block">
              <span className="text-xs font-semibold text-ink-muted">Each {unit} holds (optional)</span>
              <input
                name="packSize"
                inputMode="decimal"
                value={packText}
                onChange={(event) => setPackText(event.target.value)}
                placeholder="10"
                className={`mt-1 ${inputClass}`}
              />
            </label>
            <div className="w-24">
              <input type="hidden" name="packUnit" value={packUnit} />
              <SelectField
                label={`What one ${unit} holds is counted in`}
                choices={PACK_CONTENTS.map((value) => ({ value, label: value }))}
                value={packUnit}
                onChange={setPackUnit}
              />
            </div>
          </div>
          {packLabel({ quantity: parseQuantity(quantityText) ?? 0, unit, packSize, packUnit }) ? (
            <p className="mt-1.5 text-sm font-semibold" aria-live="polite">
              {packLabel({ quantity: parseQuantity(quantityText) ?? 0, unit, packSize, packUnit })}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        {labor ? null : (
          <label className="block">
            <span className="text-xs font-semibold text-ink-muted">Your cost each</span>
            <input
              name="unitCost"
              inputMode="decimal"
              value={cost}
              onChange={(event) => {
                setCostTyped(true);
                setCostText(event.target.value);
              }}
              placeholder="Not recorded"
              className={`mt-1 ${inputClass}`}
            />
          </label>
        )}

        <label className={labor ? "col-span-2 block" : "block"}>
          <span className="text-xs font-semibold text-ink-muted">
            {labor ? "Customer rate per hour" : "Customer price each"}
          </span>
          <input
            name="unitPrice"
            inputMode="decimal"
            value={priceText}
            onChange={(event) => setPriceText(event.target.value)}
            placeholder="0.00"
            aria-describedby={`price-note-${kind}`}
            className={`mt-1 ${inputClass}`}
          />
        </label>
      </div>
      <p id={`price-note-${kind}`} className="text-xs text-ink-faint">
        {labor
          ? "What the customer pays. Type 0 if there is no charge."
          : "Your cost is never shown to the customer. Type 0 for no charge."}
      </p>

      <p className="text-right text-sm text-ink-muted" aria-live="polite">
        Line total{" "}
        <span className="font-semibold text-ink">
          {formatCents(
            lineTotalCents({
              quantity: parseQuantity(quantityText) ?? 0,
              unitPriceCents: parsePriceCents(priceText) ?? 0,
            }),
          )}
        </span>
        {!labor && parsePriceCents(cost) !== null && (parseQuantity(quantityText) ?? 0) > 0 ? (
          <span className="block text-xs">
            Costs you{" "}
            {formatCents(
              lineTotalCents({ quantity: parseQuantity(quantityText) ?? 0, unitPriceCents: parsePriceCents(cost) ?? 0 }),
            )}
          </span>
        ) : null}
      </p>

      {shortfall ? (
        <p className="text-xs leading-5 text-caution" role="status">
          {shortfall}
        </p>
      ) : null}

      {state.error ? (
        <p className="text-xs text-critical" role="alert">
          {state.error}
        </p>
      ) : taken && state.notice?.includes("reserved") ? (
        <p className="text-xs text-positive" role="status">
          Added. {stockReservedNote(taken)}
        </p>
      ) : state.notice && state.notice !== "Added." ? (
        <p className="text-xs text-positive" role="status">
          {state.notice}
        </p>
      ) : null}

      <div className="flex gap-2">
        <SubmitButton label={labor ? "Add labor" : "Add part"} />
        <button
          type="button"
          onClick={onDone}
          className="tap-target inline-flex min-h-12 shrink-0 items-center justify-center whitespace-nowrap rounded-control border border-line px-4 text-sm font-semibold"
        >
          Done
        </button>
      </div>
    </form>
  );
}

/**
 * Billing what the lines add up to, and only what has not been billed.
 *
 * Every line remembers the invoice that billed it. So this section names the
 * job's invoices, and offers one thing to do with whatever is left over — and
 * what that is depends on where the newest invoice stands:
 *
 * - none yet: generate the first, for everything;
 * - a draft the customer has never seen: add the new lines to it;
 * - sent or paid: an invoice of their own, for the difference. A bill the
 *   customer already holds is never changed underneath them.
 *
 * The amount is never typed here. The action sums the lines itself, on the
 * server, from the same rows this was drawn from.
 */
function BillingSection({
  jobNumber,
  lines,
  invoices,
}: {
  jobNumber: string;
  lines: JobLine[];
  invoices: JobInvoiceSummary[];
}) {
  const [state, action] = useActionState(raiseInvoice, invoiceInitialState);

  const live = invoices.filter(invoiceIsLive);
  const step = nextBillingStep(
    lines.map((line) => ({ invoiceId: line.invoiceId ?? null, quantity: line.quantity, unitPriceCents: line.unitPriceCents })),
    invoices,
  );

  // A button offering to invoice $0.00 is a button that creates a draft nobody
  // wanted, and a job with nothing billed has no invoices to list.
  if (live.length === 0 && step.kind === "nothing") return null;

  const items = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;

  return (
    <div id="billing" className="mt-3 scroll-mt-24 border-t border-line pt-3">
      {state.error ? <p className="mb-2 text-xs text-critical">{state.error}</p> : null}
      {state.notice ? (
        <p className="mb-2 text-xs text-positive" role="status">
          {state.notice}
        </p>
      ) : null}

      {live.length > 0 ? (
        <ul className="space-y-2">
          {live.map((invoice) => (
            <li key={invoice.id}>
              <Link
                href={`/invoices/${invoice.id}`}
                className="tap-target flex min-h-12 items-center justify-between gap-3 rounded-control border border-line px-3 text-sm"
              >
                <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-brand">
                  <ReceiptText className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">Open invoice {invoice.label}</span>
                </span>
                <span className="shrink-0 text-xs text-ink-muted">
                  {formatCents(invoice.totalCents)} · {invoice.statusLabel}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {step.kind === "nothing" ? null : (
        <form action={action} className={live.length > 0 ? "mt-3" : ""}>
          <input type="hidden" name="jobNumber" value={jobNumber} />

          {step.kind === "add_to_draft" ? (
            <p className="mb-2 text-xs leading-5 text-ink-muted">
              {items(step.count)} not on an invoice yet. {`INV-${step.invoice.number}`} has not been sent, so
              they go on it.
            </p>
          ) : step.kind === "bill_difference" ? (
            <p className="mb-2 text-xs leading-5 text-ink-muted">
              {items(step.count)} added after {`INV-${step.after.number}`}{" "}
              {step.after.paidAt || step.after.status === "paid" ? "was paid" : "went to the customer"}. They go
              on an invoice of their own; {`INV-${step.after.number}`} stays as it is.
            </p>
          ) : null}

          <InvoiceButton
            label={
              step.kind === "add_to_draft"
                ? `Add ${formatCents(step.cents)} to INV-${step.invoice.number}`
                : step.kind === "bill_difference"
                  ? `Invoice the ${formatCents(step.cents)} added since`
                  : "Generate invoice"
            }
            pendingLabel={step.kind === "add_to_draft" ? "Adding…" : "Generating invoice…"}
          />

          {step.kind === "first" ? (
            <p className="mt-1.5 text-center text-xs text-ink-muted">
              Makes the PDF. Nothing is sent to the customer until you send it.
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}

function InvoiceButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-brand px-3 text-sm font-semibold text-brand disabled:opacity-60"
    >
      {pending ? (
        <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
      ) : (
        <ReceiptText className="h-4 w-4 shrink-0" aria-hidden />
      )}
      {/* The button says what it is doing while it does it. A slow response
          that looks like nothing happened is what makes people tap twice. */}
      {pending ? pendingLabel : label}
    </button>
  );
}

/** Where a part came from and what it has done to the count, in a few words. */
function stockWords(line: JobLine, stock: LineStock | undefined): string {
  if (line.kind !== "material") return "";
  if (!line.inventoryItemId) return "bought for this job";
  if (!stock) return "from stock";
  const unit = stock.itemUnit && stock.itemUnit !== "each" ? ` ${stock.itemUnit}` : "";
  if (stock.reserved > 0 && stock.taken > 0) {
    return `${formatQuantity(stock.taken)}${unit} used, ${formatQuantity(stock.reserved)}${unit} reserved`;
  }
  if (stock.reserved > 0) return `reserved from stock`;
  if (stock.taken > 0) return `used from stock`;
  return "from stock, none used";
}

function LineRow({
  jobNumber,
  line,
  invoices,
  stock,
}: {
  jobNumber: string;
  line: JobLine;
  invoices: JobInvoiceSummary[];
  stock?: LineStock;
}) {
  const [state, action] = useActionState(removeJobLine, initialState);
  const Icon = line.kind === "labor" ? Clock : Package;

  const billedOn = invoices.find((invoice) => invoice.id === line.invoiceId && invoiceIsLive(invoice));
  // On an invoice the customer has been sent or has paid: part of that bill,
  // so it stays. Said, rather than a remove button that refuses when tapped.
  const locked = lineLockedBecause({ invoiceId: line.invoiceId ?? null }, invoices);

  return (
    <li className="flex items-center gap-2 border-b border-line py-2 last:border-b-0">
      <Icon className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{line.description}</span>
        <span className="block text-xs text-ink-muted">
          {formatQuantity(line.quantity)} {unitLabel(line.unit, line.quantity)} × {formatCents(line.unitPriceCents)}
          {/* Where it came from and what it did to the count: held for this
              job, taken off it, or bought for the job and never on the shelf. */}
          {stockWords(line, stock) ? ` · ${stockWords(line, stock)}` : null}
          {billedOn ? ` · ${billedOn.label}` : null}
          {state.error ? <span className="text-critical"> · {state.error}</span> : null}
        </span>
        {packLabel(line) ? <span className="block text-xs text-ink-muted">{packLabel(line)}</span> : null}
        {line.kind === "material" ? (
          <span className="block text-xs text-ink-faint">
            {typeof line.unitCostCents === "number"
              ? `Your cost ${formatCents(line.unitCostCents)} each`
              : "Your cost not recorded"}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-sm font-semibold">{formatCents(lineTotalCents(line))}</span>
      {locked ? (
        <span title={locked} className="grid h-11 w-11 shrink-0 place-items-center text-ink-faint">
          <Lock className="h-4 w-4" aria-hidden />
          <span className="sr-only">{locked}</span>
        </span>
      ) : (
        <form action={action}>
          <input type="hidden" name="jobNumber" value={jobNumber} />
          <input type="hidden" name="lineId" value={line.id} />
          <RemoveButton />
        </form>
      )}
    </li>
  );
}

export function JobLinesPanel({
  jobNumber,
  lines,
  totals,
  invoices = [],
  stock,
  lineStock = {},
}: {
  jobNumber: string;
  lines: JobLine[];
  totals: JobLineTotals;
  /** The job's invoices, newest first, so the panel can tell billed from not. */
  invoices?: JobInvoiceSummary[];
  stock: StockOption[];
  /** What each stock part has reserved or taken, by line id. */
  lineStock?: Record<string, LineStock>;
}) {
  const [adding, setAdding] = useState<"labor" | "material" | null>(null);
  const cost = partsCost(lines);
  const parts = lines.filter((line) => line.kind === "material").length;

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
              <LineRow key={line.id} jobNumber={jobNumber} line={line} invoices={invoices} stock={lineStock[line.id]} />
            ))}
          </ul>

          {/* Split out only when there is something in both. On a parts-only
              job a "Labor $0.00" row is a line that says nothing. */}
          {totals.laborCents > 0 && totals.materialCents > 0 ? (
            <dl className="mt-3 space-y-1 text-xs text-ink-muted">
              <div className="flex justify-between">
                <dt>Labor</dt>
                <dd>{formatCents(totals.laborCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Parts</dt>
                <dd>{formatCents(totals.materialCents)}</dd>
              </div>
            </dl>
          ) : null}

          {/* For the business only: what the parts cost, said as unknown when
              any part has no cost, so a margin is never better than the facts. */}
          {parts > 0 ? (
            <p className="mt-2 text-xs text-ink-faint">
              {cost.unknownCount === parts
                ? "Your cost for these parts is not recorded."
                : `Parts cost you ${formatCents(cost.knownCents)}${
                    cost.unknownCount > 0
                      ? `, plus ${cost.unknownCount} ${cost.unknownCount === 1 ? "part" : "parts"} with no cost recorded`
                      : ""
                  }.`}
            </p>
          ) : null}
        </>
      )}

      <BillingSection jobNumber={jobNumber} lines={lines} invoices={invoices} />

      {adding ? (
        <AddLineForm
          // Remounted per kind so switching between labor and parts does not
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
            onClick={() => setAdding("labor")}
            className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line text-sm font-semibold"
          >
            <Clock className="h-4 w-4" aria-hidden />
            Add labor
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
