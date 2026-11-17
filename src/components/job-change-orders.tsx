"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Ban,
  CheckCircle2,
  ClipboardList,
  Clock,
  LoaderCircle,
  Minus,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";

import {
  addChangeOrderItemAction,
  cancelChangeOrderAction,
  createChangeOrderAction,
  finishChangeOrderAction,
  foldChangeOrderIntoContractAction,
  recordChangeOrderDeclinedAction,
  removeChangeOrderItemAction,
  requestChangeOrderApprovalAction,
  updateChangeOrderAction,
  updateChangeOrderItemAction,
  type ChangeOrderActionState,
} from "@/app/jobs/[jobId]/change-order-actions";
import { resendInvoiceRevisionAction } from "@/app/invoices/actions";
import { FormMessage, inputClass } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { adminFeeLabel } from "@/lib/admin-fee";
import { itemNeedsPrice, signedCents, type ChangeOrderStatus } from "@/lib/change-order-math";
import type { ChangeOrderItemRecord, ChangeOrderRecord, JobChangeOrders as JobChangeOrdersData, JobLineChoice } from "@/lib/change-orders-server";
import type { StockOption } from "@/lib/job-line-data";
import { formatCents, formatQuantity } from "@/lib/job-lines";
import { PART_UNITS } from "@/lib/stock-reservation";

/**
 * Change orders on a job: what the customer has agreed to change, and what is
 * waiting for them.
 *
 * Optional, always. A job whose contract never changes never sees more than a
 * button here. When something does change on site, the electrician writes it
 * down in a few taps — new parts, more hours, a fixture swapped, a fan taken
 * out — sees what it does to the price as they go, and hands it to the
 * customer to sign from the contract card above, the same way the contract was
 * signed. Nothing moves the price the customer owes until they have.
 */

const signed = (cents: number) => signedCents(cents, formatCents);

const STATUS_STYLE: Record<ChangeOrderStatus, { icon: typeof Clock; className: string }> = {
  draft: { icon: Pencil, className: "text-ink-muted" },
  pending_approval: { icon: Clock, className: "text-caution" },
  approved: { icon: CheckCircle2, className: "text-positive" },
  rejected: { icon: Ban, className: "text-critical" },
  canceled: { icon: X, className: "text-ink-faint" },
};

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

/** Runs a server action, shows what it said, and reloads the page's data when it worked. */
function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ChangeOrderActionState>({ error: "" });
  const run = (action: () => Promise<ChangeOrderActionState>, after?: (result: ChangeOrderActionState) => void) => {
    startTransition(async () => {
      const result = await action();
      setState(result);
      if (!result.error) router.refresh();
      after?.(result);
    });
  };
  return { pending, state, setState, run };
}

function Money({ cents, strong = false }: { cents: number; strong?: boolean }) {
  return <span className={`shrink-0 whitespace-nowrap tabular-nums ${strong ? "font-semibold" : ""}`}>{signed(cents)}</span>;
}

/** The contract's money in one place: agreed, approved since, pending, now. */
function ContractTotalsCard({ data }: { data: JobChangeOrdersData }) {
  const { totals } = data;
  const approvedCount = totals.approved.length;
  if (approvedCount === 0 && totals.pendingNetCents === 0 && totals.approvedNetCents === 0) return null;
  return (
    <dl className="mt-3 space-y-1 rounded-control border border-line bg-raised/40 p-3 text-sm">
      {totals.originalCents !== null ? (
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">Original contract</dt>
          <dd className="shrink-0 whitespace-nowrap tabular-nums">{formatCents(totals.originalCents)}</dd>
        </div>
      ) : null}
      {totals.approved.map((order) => (
        <div key={order.id} className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">Change order #{order.number}</dt>
          <dd>
            <Money cents={order.netCents} />
          </dd>
        </div>
      ))}
      {totals.approvedNetCents !== totals.approved.reduce((sum, order) => sum + order.netCents, 0) ? (
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">Earlier signed change orders</dt>
          <dd>
            <Money cents={totals.approvedNetCents - totals.approved.reduce((sum, order) => sum + order.netCents, 0)} />
          </dd>
        </div>
      ) : null}
      <div className="flex items-baseline justify-between gap-3 border-t border-line pt-1.5 font-semibold">
        <dt>Contract total now</dt>
        <dd className="shrink-0 whitespace-nowrap tabular-nums">
          {totals.committedCents !== null ? formatCents(totals.committedCents) : `${signed(totals.approvedNetCents)} on the agreed price`}
        </dd>
      </div>
      {totals.pendingNetCents !== 0 ? (
        <p className="text-xs text-caution">{signed(totals.pendingNetCents)} waiting for the customer to approve. Not counted until they do.</p>
      ) : null}
    </dl>
  );
}

function itemLine(item: ChangeOrderItemRecord): { title: string; detail: string } {
  const unit = (value: string) => (value && value !== "each" ? ` ${value}` : "");
  if (item.action === "remove") {
    const from = item.original;
    return { title: from?.description ?? item.description, detail: from ? `Remove ${formatQuantity(from.quantity)}${unit(from.unit)}` : "Remove" };
  }
  if (item.action === "modify") {
    const from = item.original;
    const pieces: string[] = [];
    if (from && from.quantity !== item.quantity) pieces.push(`${formatQuantity(from.quantity)} → ${formatQuantity(item.quantity)}${unit(item.unit)}`);
    if (from && item.unitPriceCents !== null && from.unitPriceCents !== item.unitPriceCents) {
      pieces.push(`${formatCents(from.unitPriceCents)} → ${formatCents(item.unitPriceCents)} each`);
    }
    if (from && from.description !== item.description) pieces.push(`was "${from.description}"`);
    return { title: item.description, detail: pieces.join(" · ") || "Changed" };
  }
  const price = item.unitPriceCents === null ? "needs a price" : `${formatCents(item.unitPriceCents)}${item.kind === "labor" ? "/hr" : " each"}`;
  return {
    title: item.description,
    detail: `${item.kind === "labor" ? "Labor" : "Material"} · ${formatQuantity(item.quantity)}${unit(item.unit)} · ${price}${item.existingLine ? " · already on the job" : ""}`,
  };
}

function ItemList({
  items,
  editable,
  onRemove,
  onPrice,
  canSetPrices,
  busy,
}: {
  items: ChangeOrderItemRecord[];
  editable: boolean;
  onRemove?: (item: ChangeOrderItemRecord) => void;
  onPrice?: (item: ChangeOrderItemRecord, price: string) => void;
  canSetPrices: boolean;
  busy: boolean;
}) {
  const groups: [string, ChangeOrderItemRecord[]][] = [
    ["Added", items.filter((item) => item.action === "add")],
    ["Changed", items.filter((item) => item.action === "modify")],
    ["Removed", items.filter((item) => item.action === "remove")],
  ];
  if (items.length === 0) return <p className="text-sm text-ink-muted">No changes yet. Add what is changing below.</p>;
  return (
    <div className="space-y-3">
      {groups
        .filter(([, list]) => list.length > 0)
        .map(([heading, list]) => (
          <div key={heading}>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{heading}</p>
            <ul className="mt-1 divide-y divide-line rounded-control border border-line">
              {list.map((item) => {
                const { title, detail } = itemLine(item);
                return (
                  <li key={item.id} className="flex items-start gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold">{title}</p>
                      <p className="break-words text-xs text-ink-muted">{detail}</p>
                      {editable && itemNeedsPrice(item) && canSetPrices && onPrice ? (
                        <PriceInline item={item} busy={busy} onSave={(price) => onPrice(item, price)} />
                      ) : null}
                      {item.notes ? <p className="mt-0.5 break-words text-xs text-ink-faint">{item.notes}</p> : null}
                    </div>
                    <div className="flex shrink-0 items-start gap-1">
                      <span className="shrink-0 pt-0.5 text-sm">
                        {itemNeedsPrice(item) ? <span className="text-caution">—</span> : <Money cents={item.netCents} />}
                      </span>
                      {editable && onRemove && !item.existingLine ? (
                        <button
                          type="button"
                          onClick={() => onRemove(item)}
                          disabled={busy}
                          aria-label={`Take "${title}" off this change order`}
                          className="tap-target -mr-2 -mt-2 inline-flex min-h-11 min-w-11 items-center justify-center text-ink-faint hover:text-critical disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
    </div>
  );
}

function PriceInline({ item, busy, onSave }: { item: ChangeOrderItemRecord; busy: boolean; onSave: (price: string) => void }) {
  const [price, setPrice] = useState("");
  return (
    <div className="mt-2 flex flex-col gap-2 min-[360px]:flex-row">
      <input
        value={price}
        onChange={(event) => setPrice(event.target.value)}
        inputMode="decimal"
        placeholder={item.kind === "labor" ? "Rate per hour" : "Price each"}
        aria-label={`Price for ${item.description}`}
        className={`${inputClass} min-h-11`}
      />
      <button
        type="button"
        disabled={busy || !price.trim()}
        onClick={() => onSave(price)}
        className="tap-target inline-flex min-h-11 shrink-0 items-center rounded-control bg-brand px-3 text-sm font-semibold text-on-brand disabled:opacity-50"
      >
        Set price
      </button>
    </div>
  );
}

/** The financial summary, as the customer will be asked to approve it. */
function Summary({ order, contractBefore }: { order: ChangeOrderRecord; contractBefore: number | null }) {
  const { summary } = order;
  const rows: [string, number][] = [
    ["Additional materials", summary.addedMaterialsCents],
    ["Additional labor", summary.addedLaborCents],
    ["Changed work", summary.modifiedCents],
    ["Removed work", summary.removedCents],
  ];
  return (
    <dl className="space-y-1 rounded-control border border-line bg-raised/40 p-3 text-sm" aria-live="polite">
      {contractBefore !== null ? (
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">Contract before this change</dt>
          <dd className="shrink-0 whitespace-nowrap tabular-nums">{formatCents(contractBefore)}</dd>
        </div>
      ) : null}
      {rows
        .filter(([, cents]) => cents !== 0)
        .map(([label, cents]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-ink-muted">{label}</dt>
            <dd>
              <Money cents={cents} />
            </dd>
          </div>
        ))}
      <div className="flex justify-between gap-3 border-t border-line pt-1.5 font-semibold">
        <dt>Net change order</dt>
        <dd>
          <Money cents={summary.netCents} strong />
        </dd>
      </div>
      {contractBefore !== null ? (
        <div className="flex justify-between gap-3 font-semibold">
          <dt>Revised contract total</dt>
          <dd className="shrink-0 whitespace-nowrap tabular-nums">{formatCents(Math.max(0, contractBefore + summary.netCents))}</dd>
        </div>
      ) : null}
      {summary.unpricedCount > 0 ? (
        <p className="text-xs text-caution">
          {summary.unpricedCount} {summary.unpricedCount === 1 ? "item needs" : "items need"} a price before the customer can be asked.
        </p>
      ) : null}
    </dl>
  );
}

type Mode = "material" | "labor" | "custom" | "modify" | "remove";

/** One form for each way the work can change. */
function AddChange({
  mode,
  lines,
  stock,
  laborRates,
  canSetPrices,
  adminFeeBps,
  busy,
  onAdd,
  onClose,
}: {
  mode: Mode;
  lines: JobLineChoice[];
  stock: StockOption[];
  laborRates: number[];
  canSetPrices: boolean;
  adminFeeBps: number;
  busy: boolean;
  onAdd: (item: Parameters<typeof addChangeOrderItemAction>[2]) => void;
  onClose: () => void;
}) {
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(mode === "labor" ? "1" : "1");
  const [unit, setUnit] = useState("each");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [kind, setKind] = useState<"material" | "labor">("material");
  const [lineId, setLineId] = useState("");
  const [search, setSearch] = useState("");
  const [stockId, setStockId] = useState("");
  const line = lines.find((entry) => entry.id === lineId) ?? null;

  // Choosing a line to change starts from what it says now.
  const chooseLine = (id: string) => {
    setLineId(id);
    const chosen = lines.find((entry) => entry.id === id);
    if (mode === "modify" && chosen) {
      setDescription(chosen.description);
      setQuantity(formatQuantity(chosen.quantity));
      setPrice("");
    }
  };

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return stock
      .filter((part) => part.name.toLowerCase().includes(needle) || part.partNumber.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [search, stock]);

  const title: Record<Mode, string> = {
    material: "Add material",
    labor: "Add labor",
    custom: "Add custom item",
    modify: "Change an item on the contract",
    remove: "Remove an item from the contract",
  };
  const feeNote = adminFeeBps > 0 ? ` Your ${adminFeeLabel(adminFeeBps)} admin fee is added, as on every job line.` : "";
  const lineChoices = lines.map((entry) => ({
    value: entry.id,
    label: `${entry.description} — ${formatQuantity(entry.quantity)}${entry.unit !== "each" ? ` ${entry.unit}` : ""} · ${formatCents(Math.round(entry.quantity * entry.unitPriceCents))}`,
    description: entry.billedNote || undefined,
  }));

  const submit = () => {
    if (mode === "modify" || mode === "remove") {
      onAdd({ action: mode, lineId, description: mode === "modify" ? description : undefined, quantity: mode === "modify" ? quantity : undefined, unitPrice: mode === "modify" ? price : undefined, notes });
      return;
    }
    onAdd({
      action: "add",
      kind: mode === "labor" ? "labor" : mode === "material" ? "material" : kind,
      description,
      quantity,
      unit: mode === "labor" || (mode === "custom" && kind === "labor") ? "hr" : unit,
      unitPrice: price,
      unitCost: cost,
      inventoryItemId: mode === "material" ? stockId || undefined : undefined,
      notes,
    });
  };

  const isLabor = mode === "labor" || (mode === "custom" && kind === "labor");
  return (
    <div className="space-y-3 rounded-control border border-brand/30 bg-brand/[0.04] p-3" role="group" aria-label={title[mode]}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{title[mode]}</p>
        <button type="button" onClick={onClose} className="tap-target -mr-2 inline-flex min-h-11 items-center px-2 text-sm font-semibold text-ink-muted">
          Close
        </button>
      </div>

      {mode === "modify" || mode === "remove" ? (
        <>
          {lines.length === 0 ? (
            <p className="text-sm text-ink-muted">This job has no items on it to {mode === "modify" ? "change" : "remove"}.</p>
          ) : (
            <div>
              <span className="text-xs font-semibold text-ink-muted">Item on the contract</span>
              <div className="mt-1">
                <SelectField label="Item on the contract" choices={lineChoices} value={lineId} onChange={chooseLine} placeholder="Choose an item" />
              </div>
              {line?.billedNote ? <p className="mt-1 text-xs text-ink-muted">{line.billedNote}</p> : null}
            </div>
          )}
          {mode === "modify" && line ? (
            <>
              <label className="block">
                <span className="text-xs font-semibold text-ink-muted">Description</span>
                <input value={description} onChange={(event) => setDescription(event.target.value)} className={`mt-1 ${inputClass}`} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs font-semibold text-ink-muted">New {line.kind === "labor" ? "hours" : "quantity"}</span>
                  <input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" className={`mt-1 ${inputClass}`} />
                </label>
                {canSetPrices ? (
                  <label className="block">
                    <span className="text-xs font-semibold text-ink-muted">New price each</span>
                    <input
                      value={price}
                      onChange={(event) => setPrice(event.target.value)}
                      inputMode="decimal"
                      placeholder={`Keep ${formatCents(line.unitPriceCents)}`}
                      className={`mt-1 ${inputClass}`}
                    />
                  </label>
                ) : null}
              </div>
              <p className="text-xs text-ink-faint">Only the difference is charged. Leave the price blank to keep it.{feeNote}</p>
            </>
          ) : null}
        </>
      ) : (
        <>
          {mode === "material" ? (
            <label className="block">
              <span className="text-xs font-semibold text-ink-muted">Search your stock</span>
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setStockId("");
                }}
                placeholder="Breaker, 12/2 Romex, part number"
                className={`mt-1 ${inputClass}`}
              />
              {matches.length > 0 && !stockId ? (
                <ul className="mt-1 divide-y divide-line rounded-control border border-line">
                  {matches.map((part) => (
                    <li key={part.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setStockId(part.id);
                          setDescription(part.name);
                          setUnit(part.unit || "each");
                          setSearch(part.name);
                          setCost(part.unitCostCents > 0 ? (part.unitCostCents / 100).toFixed(2) : "");
                        }}
                        className="tap-target flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm"
                      >
                        <span className="min-w-0 truncate">{part.name}</span>
                        <span className="shrink-0 text-xs text-ink-faint">{part.quantityOnHand} {part.unit} on hand</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <span className="mt-1 block text-xs text-ink-faint">Or type a part that is not in stock below. Nothing is bought by adding it here.</span>
            </label>
          ) : null}

          {mode === "custom" ? (
            <div>
              <span className="text-xs font-semibold text-ink-muted">Kind</span>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {(["material", "labor"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={kind === value}
                    onClick={() => setKind(value)}
                    className={`tap-target min-h-11 rounded-control border px-3 text-sm font-semibold ${kind === value ? "border-brand bg-brand/10" : "border-line"}`}
                  >
                    {value === "labor" ? "Labor" : "Material"}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <label className="block">
            <span className="text-xs font-semibold text-ink-muted">{isLabor ? "What the work is" : "Item"}</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={isLabor ? "Additional troubleshooting" : "Duplex outlet, 20A"}
              className={`mt-1 ${inputClass}`}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-semibold text-ink-muted">{isLabor ? "Hours" : "Quantity"}</span>
              <input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" className={`mt-1 ${inputClass}`} />
            </label>
            {isLabor ? null : (
              <div>
                <span className="text-xs font-semibold text-ink-muted">Unit</span>
                <div className="mt-1">
                  <SelectField
                    label="Unit"
                    choices={[...PART_UNITS, ...(PART_UNITS.includes(unit as never) ? [] : [unit])].map((value) => ({ value, label: value }))}
                    value={unit}
                    onChange={setUnit}
                  />
                </div>
              </div>
            )}
          </div>

          {canSetPrices ? (
            <>
              {isLabor && laborRates.length > 0 ? (
                <div className="flex flex-wrap gap-2" aria-label="Rates used on this job">
                  {laborRates.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setPrice((rate / 100).toFixed(2))}
                      className="tap-target min-h-11 rounded-chip border border-line px-3 text-sm"
                    >
                      {formatCents(rate)}/hr
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {isLabor ? null : (
                  <label className="block">
                    <span className="text-xs font-semibold text-ink-muted">Your cost each</span>
                    <input value={cost} onChange={(event) => setCost(event.target.value)} inputMode="decimal" placeholder="Not recorded" className={`mt-1 ${inputClass}`} />
                  </label>
                )}
                <label className={isLabor ? "col-span-2 block" : "block"}>
                  <span className="text-xs font-semibold text-ink-muted">{isLabor ? "Customer rate per hour" : "Customer price each"}</span>
                  <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder="0.00" className={`mt-1 ${inputClass}`} />
                </label>
              </div>
              <p className="text-xs text-ink-faint">
                {(() => {
                  const hours = Number(quantity) || 0;
                  const each = Number(price.replace(/[$,]/g, "")) || 0;
                  return hours > 0 && each > 0 ? `${formatQuantity(hours)} × ${formatCents(Math.round(each * 100))} = ${formatCents(Math.round(hours * Math.round(each * 100)))}.` : "Leave the price blank to price it later.";
                })()}
                {feeNote}
              </p>
            </>
          ) : (
            <p className="text-xs text-ink-muted">Your business has turned off billing changes for technicians, so an owner or admin prices this before the customer is asked.</p>
          )}
        </>
      )}

      <label className="block">
        <span className="text-xs font-semibold text-ink-muted">{mode === "remove" ? "Why (optional)" : "Notes (optional)"}</span>
        <input value={notes} onChange={(event) => setNotes(event.target.value)} className={`mt-1 ${inputClass}`} />
      </label>

      <button
        type="button"
        onClick={submit}
        disabled={busy || ((mode === "modify" || mode === "remove") && !lineId)}
        className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60"
      >
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
        {mode === "remove" ? "Add removal" : mode === "modify" ? "Add change" : "Add to change order"}
      </button>
    </div>
  );
}

/** Writing a change order: what is changing, the items, the money, and sending it. */
function Editor({
  order,
  data,
  stock,
  canSetPrices,
  onClose,
}: {
  order: ChangeOrderRecord;
  data: JobChangeOrdersData;
  stock: StockOption[];
  canSetPrices: boolean;
  onClose: () => void;
}) {
  const { pending, state, run, setState } = useAction();
  const [mode, setMode] = useState<Mode | null>(null);
  const [description, setDescription] = useState(order.description);
  const [reason, setReason] = useState(order.reason);
  const panel = useRef<HTMLDivElement>(null);
  const job = data.jobNumber;
  const agreementSigned = Boolean(data.agreement?.signed);

  useEffect(() => {
    panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const detailsChanged = description.trim() !== order.description || reason.trim() !== order.reason;
  const ready = order.items.length > 0 && order.summary.unpricedCount === 0;

  return (
    <div ref={panel} className="mt-3 scroll-mt-20 space-y-4 rounded-panel border border-brand/40 bg-surface p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Change order #{order.number} · Draft</p>
          <p className="text-sm text-ink-muted">
            {data.agreement ? `Changes the ${agreementSigned ? "signed" : "unsigned"} contract` : "No contract"}
            {data.totals.originalCents !== null ? ` (${formatCents(data.totals.originalCents)})` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="tap-target -mr-2 inline-flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap px-2 text-sm font-semibold text-ink-muted"
        >
          <X className="h-4 w-4" aria-hidden /> Close
        </button>
      </div>

      <div className="space-y-2">
        <label className="block">
          <span className="text-xs font-semibold text-ink-muted">What is changing</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} maxLength={2000} className={`mt-1 ${inputClass} py-3`} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink-muted">Why (optional)</span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} placeholder="Customer request" className={`mt-1 ${inputClass}`} />
        </label>
        {detailsChanged ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => updateChangeOrderAction(job, order.id, { description, reason, expectedVersion: order.version }))}
            className="tap-target inline-flex min-h-11 items-center rounded-control border border-line px-4 text-sm font-semibold disabled:opacity-60"
          >
            Save description
          </button>
        ) : null}
      </div>

      <ItemList
        items={order.items}
        editable
        canSetPrices={canSetPrices}
        busy={pending}
        onRemove={(item) => run(() => removeChangeOrderItemAction(job, order.id, item.id, order.version))}
        onPrice={(item, price) => run(() => updateChangeOrderItemAction(job, order.id, item.id, { action: item.action, unitPrice: price, expectedVersion: order.version }))}
      />

      {mode ? (
        <AddChange
          key={mode}
          mode={mode}
          lines={data.lines}
          stock={stock}
          laborRates={data.laborRates}
          canSetPrices={canSetPrices}
          adminFeeBps={data.adminFeeBps}
          busy={pending}
          onClose={() => setMode(null)}
          onAdd={(item) =>
            run(
              () => addChangeOrderItemAction(job, order.id, { ...item, expectedVersion: order.version }),
              (result) => {
                if (!result.error) setMode(null);
              },
            )
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(
            [
              ["material", "Material", Package],
              ["labor", "Labor", Wrench],
              ["custom", "Custom item", Plus],
              ["modify", "Change item", Pencil],
              ["remove", "Remove item", Minus],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setState({ error: "" });
                setMode(value);
              }}
              className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line px-3 text-sm font-semibold"
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      )}

      <Summary order={order} contractBefore={data.totals.committedCents} />

      <div className="space-y-2">
        {agreementSigned ? (
          <button
            type="button"
            disabled={pending || !ready}
            onClick={() => run(() => requestChangeOrderApprovalAction(job, order.id, order.version), (result) => !result.error && onClose())}
            className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60"
          >
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            Request customer approval
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={pending || !ready || !data.agreement}
              onClick={() => run(() => foldChangeOrderIntoContractAction(job, order.id), (result) => !result.error && onClose())}
              className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60"
            >
              {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
              Update the contract
            </button>
            <p className="text-xs text-ink-muted">
              The customer has not signed yet, so the contract can simply include this. The current draft is kept as an earlier
              version and can no longer be signed. Or keep this as a separate change order: it stays here as a draft and can be
              sent for signature once the contract is signed.
            </p>
          </>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="tap-target inline-flex min-h-12 items-center justify-center rounded-control border border-line px-4 text-sm font-semibold"
          >
            {agreementSigned ? "Save draft" : "Keep as separate change order"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => cancelChangeOrderAction(job, order.id), (result) => !result.error && onClose())}
            aria-label="Cancel this change order"
            className="tap-target inline-flex min-h-12 items-center justify-center rounded-control border border-line px-4 text-sm font-semibold text-critical disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
        {!ready && order.items.length > 0 ? <p className="text-xs text-caution">Price every item before asking the customer.</p> : null}
        <FormMessage error={state.error} notice={state.notice} />
      </div>
    </div>
  );
}

function OrderRow({
  order,
  data,
  canSetPrices,
  onEdit,
}: {
  order: ChangeOrderRecord;
  data: JobChangeOrdersData;
  canSetPrices: boolean;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { pending, state, run } = useAction();
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [resendState, setResendState] = useState<{ error: string; notice?: string }>({ error: "" });
  const [resending, startResend] = useTransition();
  const router = useRouter();
  const style = STATUS_STYLE[order.status];
  const Icon = style.icon;
  const job = data.jobNumber;
  const unapplied = order.status === "approved" && !order.appliedAt;
  const owing = order.resends.filter((entry) => entry.status === "pending" || entry.status === "failed");

  const approval =
    order.status === "approved"
      ? order.approvalMethod === "contract_revision"
        ? `Included in a revised contract · ${dateLabel(order.approvedAt)}`
        : `Approved by ${order.approvedByName || "the customer"} · ${dateLabel(order.approvedAt)}`
      : order.status === "pending_approval"
        ? `Sent for signature · ${dateLabel(order.requestedAt)}`
        : order.status === "rejected"
          ? `Declined · ${dateLabel(order.rejectedAt)}`
          : order.status === "canceled"
            ? `Withdrawn · ${dateLabel(order.canceledAt)}`
            : "Not sent to the customer";

  return (
    <li className="rounded-control border border-line">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="tap-target flex w-full items-start justify-between gap-3 px-3 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">
            #{order.number} · {order.description}
          </span>
          <span className={`mt-0.5 flex items-center gap-1.5 text-xs ${style.className}`}>
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {order.statusLabel} · {dateLabel(order.createdAt)}
            </span>
          </span>
          <span className="mt-0.5 block text-xs text-ink-faint">{approval}</span>
        </span>
        <span className="shrink-0 text-sm">
          <Money cents={order.netCents} strong />
        </span>
      </button>

      {unapplied ? (
        <div className="mx-3 mb-3 rounded-control border border-caution/30 bg-caution-bg p-3 text-sm">
          <p className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-caution" aria-hidden />
            <span>Approved, but the job and its invoice have not been updated yet.</span>
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => finishChangeOrderAction(job, order.id))}
            className="tap-target mt-2 inline-flex min-h-11 items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60"
          >
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
            Update the job now
          </button>
        </div>
      ) : null}

      {owing.map((entry) => (
        <div key={entry.revisionId} className="mx-3 mb-3 rounded-control border border-caution/30 bg-caution-bg p-3 text-sm">
          <p>
            Updated INV-{entry.invoiceNumber} {entry.status === "failed" ? `was not sent: ${entry.detail}` : "is waiting to be sent."}
          </p>
          <form
            action={(form) =>
              startResend(async () => {
                const result = await resendInvoiceRevisionAction({ error: "" }, form);
                setResendState(result);
                if (!result.error) router.refresh();
              })
            }
          >
            <input type="hidden" name="revisionId" value={entry.revisionId} />
            <button
              type="submit"
              disabled={resending}
              className="tap-target mt-2 inline-flex min-h-11 items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60"
            >
              <Send className="h-4 w-4" aria-hidden /> Send updated invoice
            </button>
          </form>
        </div>
      ))}

      {order.creditDueCents > 0 ? (
        <p className="mx-3 mb-3 rounded-control border border-info/30 bg-info-bg p-3 text-sm">
          The customer is owed {formatCents(order.creditDueCents)} because of this change. Refund it from the invoice&apos;s payments.
        </p>
      ) : null}

      {open ? (
        <div className="space-y-3 border-t border-line p-3">
          {order.reason ? <p className="text-sm text-ink-muted">Why: {order.reason}</p> : null}
          {order.rejectionReason ? <p className="text-sm text-critical">Customer said: {order.rejectionReason}</p> : null}
          <ItemList items={order.items} editable={false} canSetPrices={canSetPrices} busy={pending} />
          <Summary order={order} contractBefore={order.status === "draft" ? data.totals.committedCents : order.originalContractCents} />

          {order.status === "draft" ? (
            <button
              type="button"
              onClick={onEdit}
              className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand"
            >
              <Pencil className="h-4 w-4" aria-hidden /> Edit change order
            </button>
          ) : null}

          {order.status === "pending_approval" ? (
            <div className="space-y-2">
              <p className="text-sm text-ink-muted">
                The customer signs it from the contract card above — by text, or on this phone. It changes nothing until they do.
              </p>
              {declining ? (
                <div className="space-y-2 rounded-control border border-line p-3">
                  <label className="block">
                    <span className="text-xs font-semibold text-ink-muted">What the customer said (optional)</span>
                    <input value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} className={`mt-1 ${inputClass}`} />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => recordChangeOrderDeclinedAction(job, order.id, declineReason))}
                      className="tap-target min-h-11 rounded-control bg-brand px-3 text-sm font-semibold text-on-brand disabled:opacity-60"
                    >
                      Record declined
                    </button>
                    <button type="button" onClick={() => setDeclining(false)} className="tap-target min-h-11 rounded-control border border-line px-3 text-sm font-semibold">
                      Back
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDeclining(true)}
                    className="tap-target min-h-11 rounded-control border border-line px-3 text-sm font-semibold"
                  >
                    Customer declined
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => cancelChangeOrderAction(job, order.id))}
                    className="tap-target min-h-11 rounded-control border border-line px-3 text-sm font-semibold text-critical disabled:opacity-60"
                  >
                    Withdraw
                  </button>
                </div>
              )}
            </div>
          ) : null}
          <FormMessage error={state.error || resendState.error} notice={state.notice || resendState.notice} />
        </div>
      ) : state.error || state.notice || resendState.error || resendState.notice ? (
        <div className="px-3 pb-3">
          <FormMessage error={state.error || resendState.error} notice={state.notice || resendState.notice} />
        </div>
      ) : null}
    </li>
  );
}

function CreateForm({ jobNumber, onCreated, onCancel }: { jobNumber: string; onCreated: (id: string) => void; onCancel: () => void }) {
  const { pending, state, run } = useAction();
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="mt-3 space-y-3 rounded-panel border border-brand/40 bg-surface p-3 sm:p-4">
      <p className="text-sm font-semibold">Create change order</p>
      <label className="block">
        <span className="text-xs font-semibold text-ink-muted">What is changing</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Customer requested two more outlets in the garage"
          className={`mt-1 ${inputClass} py-3`}
        />
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-ink-muted">Why (optional)</span>
        <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} placeholder="Customer request" className={`mt-1 ${inputClass}`} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={pending || !description.trim()}
          onClick={() =>
            run(
              () => createChangeOrderAction(jobNumber, { description, reason }),
              (result) => result.changeOrderId && onCreated(result.changeOrderId),
            )
          }
          className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60"
        >
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Start
        </button>
        <button type="button" onClick={onCancel} className="tap-target min-h-12 rounded-control border border-line px-4 text-sm font-semibold">
          Cancel
        </button>
      </div>
      <FormMessage error={state.error} notice={state.notice} />
    </div>
  );
}

export function JobChangeOrders({
  data,
  stock,
}: {
  data: JobChangeOrdersData & { canSetPrices: boolean };
  stock: StockOption[];
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? data.changeOrders.find((order) => order.id === editingId && order.status === "draft") ?? null : null;
  // The one open in the editor is shown there, not a second time in the list.
  const active = data.changeOrders.filter((order) => order.status !== "canceled" && order.id !== editing?.id);
  const closed = data.changeOrders.filter((order) => order.status === "canceled");

  return (
    <section aria-labelledby="change-orders-heading" className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="change-orders-heading" className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardList className="h-4 w-4 text-ink-muted" aria-hidden />
          Change orders
        </h3>
        {!creating && !editing ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={!data.agreement}
            className="tap-target inline-flex min-h-11 items-center gap-2 rounded-control border border-line px-4 text-sm font-semibold disabled:opacity-60"
          >
            <Plus className="h-4 w-4" aria-hidden /> Create change order
          </button>
        ) : null}
      </div>
      {!data.agreement ? (
        <p className="mt-1 text-xs text-ink-faint">Generate the contract first. A change order changes what it says.</p>
      ) : data.changeOrders.length === 0 && !creating ? (
        <p className="mt-1 text-xs text-ink-faint">Only if something changes on site. Most jobs never need one.</p>
      ) : null}

      <ContractTotalsCard data={data} />

      {creating ? (
        <CreateForm
          jobNumber={data.jobNumber}
          onCreated={(id) => {
            setCreating(false);
            setEditingId(id);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <Editor key={editing.id} order={editing} data={data} stock={stock} canSetPrices={data.canSetPrices} onClose={() => setEditingId(null)} />
      ) : null}

      {active.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {active.map((order) => (
            <OrderRow key={order.id} order={order} data={data} canSetPrices={data.canSetPrices} onEdit={() => setEditingId(order.id)} />
          ))}
        </ul>
      ) : null}

      {closed.length > 0 ? (
        <details className="group mt-2">
          <summary className="tap-target flex min-h-11 cursor-pointer list-none items-center text-xs text-ink-faint [&::-webkit-details-marker]:hidden">
            {closed.length} withdrawn
          </summary>
          <ul className="mt-1 space-y-2">
            {closed.map((order) => (
              <OrderRow key={order.id} order={order} data={data} canSetPrices={data.canSetPrices} onEdit={() => undefined} />
            ))}
          </ul>
        </details>
      ) : null}

      {data.changeOrders.some((order) => order.creditDueCents > 0) ? (
        <p className="mt-2 text-xs text-ink-muted">
          Credits are refunded from the invoice: open it from{" "}
          <Link href="/invoices" className="font-semibold text-brand">
            Invoices
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}
