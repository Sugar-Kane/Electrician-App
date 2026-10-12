"use client";

import { startTransition, useActionState, useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { LoaderCircle, Plus, ShoppingCart, Trash2 } from "lucide-react";

import {
  addToBuyList,
  removeBuyItem,
  updateBuyItem,
  type BuyListState,
} from "@/app/materials/actions";
import { inputClass } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { BUY_STATUSES, type BuyItem } from "@/lib/buy-list";
import { PART_UNITS } from "@/lib/stock-reservation";

const initial: BuyListState = { error: "" };

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * Adding a line: what, how many, and — only if it is for one — which job.
 *
 * Filled in from wherever it was opened: a search that found nothing keeps
 * what was searched, so nothing is typed twice.
 */
export function AddToBuyList({
  description = "",
  jobs,
  stops,
  heading = "Add to buy list",
}: {
  description?: string;
  jobs: { number: string; label: string }[];
  stops: { id: string; name: string }[];
  heading?: string;
}) {
  const [state, action] = useActionState(addToBuyList, initial);
  const [unit, setUnit] = useState("each");
  const [job, setJob] = useState("");
  const [stop, setStop] = useState("");

  return (
    <form action={action} className="space-y-3 rounded-control border border-line bg-raised p-3">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <ShoppingCart className="h-4 w-4 text-brand" aria-hidden />
        {heading}
      </p>
      <label className="block">
        <span className="text-xs font-semibold text-ink-muted">What</span>
        <input name="description" required defaultValue={description} maxLength={200} className={`mt-1 ${inputClass}`} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs font-semibold text-ink-muted">Quantity</span>
          <input name="quantity" inputMode="decimal" defaultValue="1" className={`mt-1 ${inputClass}`} />
        </label>
        <div>
          <span className="text-xs font-semibold text-ink-muted">Unit</span>
          <input type="hidden" name="unit" value={unit} />
          <div className="mt-1">
            <SelectField label="Unit" choices={PART_UNITS.map((value) => ({ value, label: value }))} value={unit} onChange={setUnit} />
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <span className="text-xs font-semibold text-ink-muted">For a job (optional)</span>
          <input type="hidden" name="jobNumber" value={job} />
          <div className="mt-1">
            <SelectField
              label="For a job"
              placeholder="Not for a job"
              choices={[{ value: "", label: "Not for a job" }, ...jobs.map((entry) => ({ value: entry.number, label: entry.label }))]}
              value={job}
              onChange={setJob}
            />
          </div>
        </div>
        <div>
          <span className="text-xs font-semibold text-ink-muted">Supplier (optional)</span>
          <input type="hidden" name="supplyStopId" value={stop} />
          <div className="mt-1">
            <SelectField
              label="Supplier"
              placeholder="Decide later"
              choices={[{ value: "", label: "Decide later" }, ...stops.map((entry) => ({ value: entry.id, label: entry.name }))]}
              value={stop}
              onChange={setStop}
            />
          </div>
        </div>
      </div>
      {state.error ? (
        <p className="text-xs text-critical" role="alert">
          {state.error}
        </p>
      ) : state.notice ? (
        <p className="text-xs text-positive" role="status">
          {state.notice}
        </p>
      ) : null}
      <SubmitButton label="Add to buy list" pendingLabel="Adding…" />
    </form>
  );
}

/** One tap, from a part a job lists: onto the buy list for that job. */
export function BuyThisForJob({
  description,
  quantity,
  unit,
  jobNumber,
}: {
  description: string;
  quantity: number;
  unit: string;
  jobNumber: string;
}) {
  const [state, action] = useActionState(addToBuyList, initial);
  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="description" value={description} />
      <input type="hidden" name="quantity" value={String(quantity)} />
      <input type="hidden" name="unit" value={unit} />
      <input type="hidden" name="jobNumber" value={jobNumber} />
      <AddButton />
      {state.error ? <p className="mt-1 text-xs text-critical">{state.error}</p> : null}
    </form>
  );
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex min-h-11 items-center gap-1.5 rounded-control border border-line px-3 text-xs font-semibold text-brand disabled:opacity-60"
    >
      {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ShoppingCart className="h-3.5 w-3.5" aria-hidden />}
      Add to buy list
    </button>
  );
}

/**
 * One line of the list: its status set by hand, an order number when there
 * is one, and a way off the list.
 */
export function BuyItemRow({ item }: { item: BuyItem }) {
  const [state, update, pending] = useActionState(updateBuyItem, initial);
  const [removeState, remove, removing] = useActionState(removeBuyItem, initial);
  const [status, setStatus] = useState<string>(item.status);
  const [reference, setReference] = useState(item.orderReference);

  function save(nextStatus: string, nextReference: string) {
    const data = new FormData();
    data.set("id", item.id);
    data.set("status", nextStatus);
    data.set("orderReference", nextReference);
    startTransition(() => update(data));
  }

  const showsReference = status === "ordered" || status === "ready_for_pickup" || Boolean(item.orderReference);

  return (
    <li className="rounded-control border border-line p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${status === "picked_up" ? "text-ink-muted line-through" : ""}`}>
            {item.description}
          </p>
          <p className="text-xs text-ink-muted">
            {Math.round(item.quantity * 100) / 100} {item.unit}
            {item.jobNumber ? (
              <>
                {" · "}
                <Link href={`/jobs/${item.jobNumber}`} className="font-semibold text-brand">
                  job #{item.jobNumber}
                </Link>
              </>
            ) : (
              " · for the van"
            )}
            {item.neededBy ? ` · needed by ${item.neededBy}` : ""}
          </p>
        </div>
        <form
          action={remove}
          onSubmit={(event) => {
            if (!window.confirm(`Take “${item.description}” off the buy list?`)) event.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={item.id} />
          <button
            type="submit"
            disabled={removing}
            aria-label={`Remove ${item.description} from the buy list`}
            className="tap-target grid h-11 w-11 place-items-center rounded-control text-ink-faint disabled:opacity-60"
          >
            {removing ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
          </button>
        </form>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,12rem)_1fr]">
        <SelectField
          label={`Status of ${item.description}`}
          choices={BUY_STATUSES}
          value={status}
          onChange={(next) => {
            setStatus(next);
            save(next, reference);
          }}
          disabled={pending}
        />
        {showsReference ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              save(status, reference);
            }}
          >
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Order or confirmation number"
              aria-label={`Order number for ${item.description}`}
              maxLength={80}
              className={inputClass}
            />
            <button
              type="submit"
              disabled={pending}
              className="tap-target shrink-0 rounded-control border border-line px-3 text-xs font-semibold disabled:opacity-60"
            >
              Save
            </button>
          </form>
        ) : null}
      </div>
      {state.error || removeState.error ? (
        <p className="mt-1 text-xs text-critical" role="alert">
          {state.error || removeState.error}
        </p>
      ) : null}
    </li>
  );
}
