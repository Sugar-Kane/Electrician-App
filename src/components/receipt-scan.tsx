"use client";

import { useActionState, useRef, useState } from "react";
import { LoaderCircle, Plus, ReceiptText, TriangleAlert, X } from "lucide-react";

import {
  createReceiptUpload,
  saveReceipt,
  scanReceipt,
  type ReceiptSaveState,
} from "@/app/inventory/receipt-actions";
import { FormMessage, inputClass } from "@/components/ui/field";
import { centsToInput, keepMoneyCharacters, keepQuantityCharacters } from "@/lib/money-input";
import { checkReceiptTotals, linesTotalCents, type ReceiptPlanLine } from "@/lib/receipt-lines";
import { createClient } from "@/lib/supabase/client";

/**
 * The receipt, read back before it is believed.
 *
 * Every figure here is editable, and that is the feature rather than a caveat.
 * A photograph of a thermal receipt taken on a van seat is genuinely hard to
 * read, and the difference between a scanner worth having and one worth
 * switching off is whether the person gets to correct it before it becomes the
 * count on their shelf.
 *
 * Laid out as cards rather than a table because it is used at 390px with one
 * thumb. A four-column table at that width is a horizontal scroll, and a
 * horizontal scroll is where quantities get edited by accident.
 */

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,image/*";

const initialState: ReceiptSaveState = { error: "" };

/** A line while somebody is editing it: numbers as text, so typing works. */
type EditableLine = {
  key: string;
  name: string;
  quantity: string;
  unit: string;
  unitCost: string;
  partNumber: string;
  matchId: string;
  matchName: string;
  onHand: number;
  receiptUnit: string;
};

function toEditable(line: ReceiptPlanLine, index: number): EditableLine {
  return {
    key: `${index}-${line.name}`,
    name: line.name,
    quantity: String(line.quantity),
    unit: line.unit,
    unitCost: centsToInput(line.unitCostCents),
    partNumber: line.partNumber,
    matchId: line.matchId,
    matchName: line.matchName,
    onHand: line.onHand,
    receiptUnit: line.receiptUnit,
  };
}

/** What a line is worth right now, for the running total. */
function centsOf(line: EditableLine): { quantity: number; unitCostCents: number } {
  const quantity = Number(line.quantity);
  const cost = Number(line.unitCost);
  return {
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 0,
    unitCostCents: Number.isFinite(cost) && cost > 0 ? Math.round(cost * 100) : 0,
  };
}

function LineCard({
  line,
  onChange,
  onRemove,
}: {
  line: EditableLine;
  onChange: (next: EditableLine) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<EditableLine>) => onChange({ ...line, ...patch });

  return (
    <li className="rounded-control border border-line bg-raised p-3">
      <div className="flex items-start gap-2">
        <input
          value={line.name}
          onChange={(event) => set({ name: event.target.value })}
          aria-label="What it is"
          className={`${inputClass} min-w-0 flex-1`}
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Leave ${line.name || "this line"} off`}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-control border border-line text-ink-faint"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <label className="block min-w-0">
          <span className="text-[11px] font-medium text-ink-muted">How many</span>
          <input
            value={line.quantity}
            onChange={(event) => set({ quantity: keepQuantityCharacters(event.target.value) })}
            inputMode="decimal"
            className={`${inputClass} mt-1`}
          />
        </label>

        <label className="block min-w-0">
          <span className="text-[11px] font-medium text-ink-muted">Counted in</span>
          <input
            value={line.unit}
            onChange={(event) => set({ unit: event.target.value })}
            className={`${inputClass} mt-1`}
          />
        </label>

        <label className="block min-w-0">
          <span className="text-[11px] font-medium text-ink-muted">Each</span>
          <input
            value={line.unitCost}
            onChange={(event) => set({ unitCost: keepMoneyCharacters(event.target.value) })}
            inputMode="decimal"
            placeholder="0.00"
            className={`${inputClass} mt-1`}
          />
        </label>
      </div>

      <p className="mt-2 text-[11px] leading-4 text-ink-faint">
        {line.matchId ? (
          <>
            Adds to <span className="text-ink-muted">{line.matchName}</span> — {line.onHand} on hand
            now.
          </>
        ) : (
          <>New to your stock list.</>
        )}
      </p>

      {/*
       * A unit the receipt disagrees with, said rather than converted.
       *
       * One "roll" cannot be added to 250 ft, and there is no conversion here
       * worth inventing — so the row is counted the way the shelf is counted
       * and the paper's word for it is shown for the person to reconcile.
       */}
      {line.receiptUnit ? (
        <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-4 text-caution">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          The receipt says {line.receiptUnit}, and you count these in {line.unit}. Check the number.
        </p>
      ) : null}
    </li>
  );
}

export function ReceiptScan() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const [documentId, setDocumentId] = useState("");
  const [supplier, setSupplier] = useState("");
  const [purchasedOn, setPurchasedOn] = useState("");
  const [printedTotalCents, setPrintedTotalCents] = useState(0);
  const [summary, setSummary] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([]);

  const [state, action, saving] = useActionState(saveReceipt, initialState);
  const picker = useRef<HTMLInputElement>(null);

  function clear() {
    setDocumentId("");
    setSupplier("");
    setPurchasedOn("");
    setPrintedTotalCents(0);
    setSummary("");
    setLines([]);
    setProblem("");
  }

  async function read(file: File) {
    setProblem("");
    setBusy(true);

    try {
      const ticket = await createReceiptUpload({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });

      if (!ticket.ok) {
        setProblem(ticket.error);
        return;
      }

      // Straight from the phone to storage. The token is good for this one
      // object, so nothing else can be written with it.
      const sent = await createClient()
        .storage.from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, file, {
          contentType: file.type || "application/octet-stream",
        });

      if (sent.error) {
        setProblem("That receipt did not upload. Try again.");
        return;
      }

      const scanned = await scanReceipt({
        path: ticket.path,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });

      if (!scanned.ok) {
        setProblem(scanned.error);
        return;
      }

      setDocumentId(scanned.documentId);
      setSupplier(scanned.supplier);
      setPurchasedOn(scanned.purchasedOn);
      setPrintedTotalCents(scanned.printedTotalCents);
      setSummary(scanned.summary);
      setLines(scanned.lines.map(toEditable));

      if (scanned.lines.length === 0) {
        setProblem("Nothing on that receipt read as a part. Add them by hand, or try a clearer photo.");
      }
    } catch {
      setProblem("That receipt could not be read. Try again.");
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  }

  const lineTotal = linesTotalCents(lines.map(centsOf));
  const check = checkReceiptTotals(lineTotal, printedTotalCents);

  // A saved receipt closes the panel rather than leaving the same rows sitting
  // there looking unsaved, which is how somebody taps Save twice.
  const saved = Boolean(state.savedId);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tap-target inline-flex items-center gap-2 rounded-control border border-line px-4 text-sm font-semibold text-ink"
      >
        <ReceiptText className="h-4 w-4" aria-hidden />
        Scan a receipt
      </button>
    );
  }

  return (
    <div className="rounded-panel border border-line bg-raised p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Scan a receipt</h2>
          <p className="mt-1 text-xs leading-5 text-ink-muted">
            Photograph the receipt from the supply house. What it bought goes on the shelf at what
            you actually paid — check the lines before saving.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            clear();
          }}
          aria-label="Close"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-control border border-line text-ink-faint"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void read(file);
        }}
      />

      {saved ? (
        <div className="mt-3">
          <FormMessage error="" notice={state.notice} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                clear();
              }}
              className="tap-target inline-flex items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand"
            >
              Back to the list
            </button>
            <button
              type="button"
              onClick={() => {
                clear();
                picker.current?.click();
              }}
              className="tap-target inline-flex items-center gap-2 rounded-control border border-line px-4 text-sm font-semibold text-ink"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Another receipt
            </button>
          </div>
        </div>
      ) : lines.length === 0 ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={busy}
            className="tap-target inline-flex items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60"
          >
            {busy ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ReceiptText className="h-4 w-4" aria-hidden />
            )}
            {busy ? "Reading the receipt" : "Choose a photo"}
          </button>

          {busy ? (
            <p className="mt-2 text-xs text-ink-faint">
              This takes a few seconds. Do not close the page.
            </p>
          ) : null}

          {problem ? <p className="mt-2 text-xs leading-5 text-critical">{problem}</p> : null}
        </div>
      ) : (
        <form action={action} className="mt-3">
          <input type="hidden" name="documentId" value={documentId} />

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-medium text-ink-muted">Bought from</span>
              <input
                name="supplier"
                value={supplier}
                onChange={(event) => setSupplier(event.target.value)}
                placeholder="The supply house"
                className={`${inputClass} mt-1`}
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-medium text-ink-muted">When</span>
              <input
                name="purchasedOn"
                value={purchasedOn}
                onChange={(event) => setPurchasedOn(event.target.value)}
                placeholder="YYYY-MM-DD"
                className={`${inputClass} mt-1`}
              />
            </label>
          </div>

          <p className="mt-3 text-xs font-medium text-ink-muted">{summary}</p>

          <ul className="mt-2 space-y-2">
            {lines.map((line, index) => (
              <LineCard
                key={line.key}
                line={line}
                onChange={(next) =>
                  setLines((current) =>
                    current.map((entry, at) => (at === index ? next : entry)),
                  )
                }
                onRemove={() =>
                  setLines((current) => current.filter((_, at) => at !== index))
                }
              />
            ))}
          </ul>

          {/* One hidden field per line, so the server reads exactly what is on
              the screen rather than what the model first said. */}
          {lines.map((line) => (
            <input
              key={`posted-${line.key}`}
              type="hidden"
              name="line"
              value={JSON.stringify({
                name: line.name,
                quantity: line.quantity,
                unit: line.unit,
                unitCost: line.unitCost,
                partNumber: line.partNumber,
                matchId: line.matchId,
              })}
            />
          ))}

          {check.message ? (
            <p
              className={`mt-3 flex items-start gap-1.5 text-xs leading-5 ${
                check.worthChecking ? "text-caution" : "text-ink-faint"
              }`}
            >
              {check.worthChecking ? (
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              ) : null}
              {check.message}
            </p>
          ) : null}

          <div className="mt-3">
            <FormMessage error={state.error} notice="" />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={saving || lines.length === 0}
              className="tap-target inline-flex items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60"
            >
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {saving ? "Saving" : "Add to stock"}
            </button>
            <button
              type="button"
              onClick={clear}
              className="tap-target inline-flex items-center gap-1 rounded-control border border-line px-4 text-sm font-semibold text-ink-muted"
            >
              <X className="h-4 w-4" aria-hidden />
              Start again
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
