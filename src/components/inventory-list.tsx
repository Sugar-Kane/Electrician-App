"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, MapPin, Package, Pencil, Plus, Search, Trash2, X } from "lucide-react";

import {
  removeInventoryItem,
  saveInventoryItem,
  type InventoryState,
} from "@/app/inventory/actions";
import { FormMessage, inputClass } from "@/components/ui/field";
import { normalizeName } from "@/lib/inventory-match";

/**
 * The stock list.
 *
 * Searchable first, because the question an electrician has is "do I have one
 * of these" and the list is long. Editing happens in place rather than on a
 * separate page: changing a quantity is the commonest action by a wide margin
 * and it should not cost a navigation.
 */

export type InventoryRow = {
  id: string;
  name: string;
  partNumber: string;
  quantity: number;
  unit: string;
  supplier: string;
  unitCost: number | null;
  location: string;
  notes: string;
  photoUrl: string;
};

const initialState: InventoryState = { error: "" };

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {pending ? "Saving" : label}
    </button>
  );
}

function ItemForm({
  item,
  onDone,
}: {
  item?: InventoryRow;
  onDone: () => void;
}) {
  const [state, action] = useActionState(saveInventoryItem, initialState);

  return (
    <form action={action} className="rounded-control border border-line bg-raised p-4">
      {item ? <input type="hidden" name="id" value={item.id} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-ink-muted">Name</span>
          <input
            name="name"
            required
            defaultValue={item?.name ?? ""}
            placeholder="20 amp AFCI breaker"
            className={`${inputClass} mt-1`}
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink-muted">How many</span>
          <input
            name="quantity"
            inputMode="decimal"
            defaultValue={item ? String(item.quantity) : ""}
            placeholder="4"
            className={`${inputClass} mt-1`}
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink-muted">Counted in</span>
          <input
            name="unit"
            defaultValue={item?.unit ?? "each"}
            placeholder="each, ft, box"
            className={`${inputClass} mt-1`}
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink-muted">Part number</span>
          <input
            name="partNumber"
            defaultValue={item?.partNumber ?? ""}
            placeholder="Optional"
            className={`${inputClass} mt-1`}
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink-muted">What it cost</span>
          <input
            name="unitCost"
            inputMode="decimal"
            defaultValue={item?.unitCost != null ? String(item.unitCost) : ""}
            placeholder="Optional"
            className={`${inputClass} mt-1`}
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink-muted">Where it is</span>
          <input
            name="location"
            defaultValue={item?.location ?? ""}
            placeholder="Van shelf 2"
            className={`${inputClass} mt-1`}
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink-muted">Supplier</span>
          <input
            name="supplier"
            defaultValue={item?.supplier ?? ""}
            placeholder="Optional"
            className={`${inputClass} mt-1`}
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-ink-muted">Photo link</span>
          <input
            name="photoUrl"
            defaultValue={item?.photoUrl ?? ""}
            placeholder="Optional"
            className={`${inputClass} mt-1`}
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-ink-muted">Notes</span>
          <input
            name="notes"
            defaultValue={item?.notes ?? ""}
            placeholder="Optional"
            className={`${inputClass} mt-1`}
          />
        </label>
      </div>

      <div className="mt-3">
        <FormMessage error={state.error} notice={state.notice} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <SaveButton label={item ? "Save changes" : "Add to stock"} />
        <button
          type="button"
          onClick={onDone}
          className="tap-target inline-flex items-center gap-1 rounded-control border border-line px-4 text-sm font-semibold text-ink-muted"
        >
          <X className="h-4 w-4" aria-hidden />
          Cancel
        </button>
      </div>
    </form>
  );
}

function RemoveButton({ id }: { id: string }) {
  const [state, action] = useActionState(removeInventoryItem, initialState);

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        aria-label="Remove from stock"
        className="grid h-9 w-9 place-items-center rounded-control border border-line text-ink-faint"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
      {state.error ? <span className="sr-only">{state.error}</span> : null}
    </form>
  );
}

export function InventoryList({ items }: { items: InventoryRow[] }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const visible = useMemo(() => {
    const needle = normalizeName(query);
    if (!needle) return items;
    // Searched the same way materials are matched, so a search that finds
    // nothing means the materials list will not match it either.
    return items.filter(
      (item) =>
        normalizeName(item.name).includes(needle) ||
        normalizeName(item.partNumber).includes(needle) ||
        normalizeName(item.location).includes(needle),
    );
  }, [items, query]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-12 flex-1 items-center gap-2 rounded-control border border-line bg-raised px-4">
          <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
          <span className="sr-only">Search stock</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search stock…"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-faint"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setAdding((current) => !current);
            setEditing(null);
          }}
          className="tap-target inline-flex items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add item
        </button>
      </div>

      {adding ? <ItemForm onDone={() => setAdding(false)} /> : null}

      <ul className="space-y-2">
        {visible.map((item) => (
          <li key={item.id} className="rounded-control border border-line">
            {editing === item.id ? (
              <ItemForm item={item} onDone={() => setEditing(null)} />
            ) : (
              <div className="flex items-center gap-3 p-3">
                {item.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.photoUrl}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded-control object-cover"
                  />
                ) : (
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-white/5">
                    <Package className="h-5 w-5 text-brand" aria-hidden />
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.name}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {item.quantity} {item.unit}
                    {item.partNumber ? ` · ${item.partNumber}` : ""}
                  </p>
                  {item.location ? (
                    <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-faint">
                      <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                      {item.location}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(item.id);
                      setAdding(false);
                    }}
                    aria-label={`Edit ${item.name}`}
                    className="grid h-9 w-9 place-items-center rounded-control border border-line text-ink-muted"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </button>
                  <RemoveButton id={item.id} />
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {visible.length === 0 ? (
        <p className="rounded-control border border-dashed border-line p-8 text-center text-sm text-ink-muted">
          {items.length === 0
            ? "Nothing in stock yet. Add what is already on the van, and job material lists will show what you have."
            : `Nothing in stock matches “${query}”.`}
        </p>
      ) : null}
    </div>
  );
}
