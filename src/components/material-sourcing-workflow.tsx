"use client";

import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import {
  Boxes,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MapPin,
  PackageCheck,
  Route,
  Save,
  Store,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import {
  availabilityLabels,
  buildSelectionRouteHref,
  getSupplierLabel,
  isAllowedSupplierProductUrl,
  type ProductAvailability,
  type SavedProductSelection,
} from "@/lib/material-sourcing";
import {
  buildGoogleSupplierStoreSearchUrl,
  buildHomeDepotSearchUrl,
  buildLowesSearchUrl,
  getPilotSupplyStore,
  type JobMaterial,
  type SupplierId,
} from "@/lib/pilot-data";
import { inputClass } from "@/components/ui/field";
import { createClient } from "@/lib/supabase/client";

const STORAGE_KEY = "volteira:supplier-products:v1";
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type SyncContext = {
  organizationId: string;
  userId: string;
};

function isSavedSelection(value: unknown): value is SavedProductSelection {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SavedProductSelection>;
  return (
    typeof item.id === "string" &&
    typeof item.jobReference === "string" &&
    typeof item.materialName === "string" &&
    (item.supplier === "lowes" || item.supplier === "home-depot") &&
    typeof item.productName === "string" &&
    typeof item.productUrl === "string" &&
    typeof item.retailerSku === "string" &&
    typeof item.quantity === "number" &&
    typeof item.unitPriceCents === "number" &&
    (item.availability === "in_stock" || item.availability === "limited" || item.availability === "out_of_stock" || item.availability === "unknown") &&
    typeof item.storeName === "string" &&
    typeof item.storeNumber === "string" &&
    typeof item.storeAddress === "string" &&
    typeof item.verifiedAt === "string"
  );
}

function readLocalSelections() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isSavedSelection) : [];
  } catch {
    return [];
  }
}

function writeLocalSelection(selection: SavedProductSelection) {
  const current = readLocalSelections();
  const next = [selection, ...current.filter((item) => item.id !== selection.id)];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function removeLocalSelection(id: string) {
  const current = readLocalSelections();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current.filter((item) => item.id !== id)));
}

function mergeSelections(local: SavedProductSelection[], remote: SavedProductSelection[]) {
  const merged = new Map(local.map((item) => [item.id, item]));
  remote.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values()).toSorted((a, b) => b.verifiedAt.localeCompare(a.verifiedAt));
}

function selectionFromRow(row: {
  id: string;
  job_reference: string | null;
  material_name: string;
  supplier: string;
  product_name: string;
  product_url: string;
  retailer_sku: string | null;
  quantity: number;
  unit_price_cents: number;
  availability: string;
  store_name: string | null;
  store_number: string | null;
  store_address: string | null;
  verified_at: string;
}): SavedProductSelection {
  return {
    id: row.id,
    jobReference: row.job_reference ?? "inventory",
    materialName: row.material_name,
    supplier: row.supplier === "home-depot" ? "home-depot" : "lowes",
    productName: row.product_name,
    productUrl: row.product_url,
    retailerSku: row.retailer_sku ?? "",
    quantity: Number(row.quantity),
    unitPriceCents: row.unit_price_cents,
    availability: (Object.hasOwn(availabilityLabels, row.availability) ? row.availability : "unknown") as ProductAvailability,
    storeName: row.store_name ?? "",
    storeNumber: row.store_number ?? "",
    storeAddress: row.store_address ?? "",
    verifiedAt: row.verified_at,
  };
}

function ProductConfirmationForm({
  material,
  jobReference,
  nearAddress,
  onCancel,
  onSave,
}: {
  material: JobMaterial;
  jobReference: string;
  nearAddress: string;
  onCancel: () => void;
  onSave: (selection: SavedProductSelection) => void;
}) {
  const initialStore = getPilotSupplyStore("lowes");
  const shortage = Math.max(1, material.quantity - material.truckStock);
  const [supplier, setSupplier] = useState<SupplierId>("lowes");
  const [productName, setProductName] = useState(material.name);
  const [productUrl, setProductUrl] = useState("");
  const [retailerSku, setRetailerSku] = useState("");
  const [quantity, setQuantity] = useState(String(shortage));
  const [unitPrice, setUnitPrice] = useState(material.estimatedUnitPrice.toFixed(2));
  const [availability, setAvailability] = useState<ProductAvailability>("unknown");
  const [storeName, setStoreName] = useState(initialStore.name);
  const [storeNumber, setStoreNumber] = useState(initialStore.storeNumber ?? "");
  const [storeAddress, setStoreAddress] = useState(initialStore.address);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  function chooseSupplier(nextSupplier: SupplierId) {
    const store = getPilotSupplyStore(nextSupplier);
    setSupplier(nextSupplier);
    setStoreName(store.name);
    setStoreNumber(store.storeNumber ?? "");
    setStoreAddress(store.address);
    setProductUrl("");
    setConfirmed(false);
    setError("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedQuantity = Number(quantity);
    const parsedPrice = Number(unitPrice);

    if (!isAllowedSupplierProductUrl(productUrl, supplier)) {
      setError(`Paste a secure ${getSupplierLabel(supplier)} product link.`);
      return;
    }
    if (!productName.trim()) {
      setError("Enter the product name you selected.");
      return;
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError("Enter a quantity greater than zero.");
      return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setError("Enter the unit price shown by the retailer.");
      return;
    }
    if (!confirmed) {
      setError("Confirm that you checked the retailer page before saving.");
      return;
    }

    onSave({
      id: crypto.randomUUID(),
      jobReference,
      materialName: material.name,
      supplier,
      productName: productName.trim(),
      productUrl: productUrl.trim(),
      retailerSku: retailerSku.trim(),
      quantity: parsedQuantity,
      unitPriceCents: Math.round(parsedPrice * 100),
      availability,
      storeName: storeName.trim(),
      storeNumber: storeNumber.trim(),
      storeAddress: storeAddress.trim(),
      verifiedAt: new Date().toISOString(),
    });
  }

  const retailerSearchUrl = supplier === "lowes" ? buildLowesSearchUrl(material.searchTerm) : buildHomeDepotSearchUrl(material.searchTerm);

  return (
    <form onSubmit={handleSubmit} className="mt-4 rounded-panel border border-brand/30 bg-on-brand p-4" noValidate>
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-xs font-semibold text-brand">Save the product you chose</p><p className="mt-1 text-[11px] leading-5 text-ink-muted">Volteira stores only the values you personally confirm.</p></div>
        <button type="button" onClick={onCancel} className="tap-target min-h-11 rounded-chip px-3 text-xs text-ink-muted">Cancel</button>
      </div>

      <fieldset className="mt-4">
        <legend className="text-xs font-semibold text-ink-muted">Retailer</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["lowes", "home-depot"] as const).map((supplierId) => (
            <button key={supplierId} type="button" onClick={() => chooseSupplier(supplierId)} aria-pressed={supplier === supplierId} className={`tap-target min-h-12 rounded-control border px-3 text-sm font-semibold ${supplier === supplierId ? "border-brand/60 bg-brand/10 text-brand" : "border-line text-ink-muted"}`}>{getSupplierLabel(supplierId)}</button>
          ))}
        </div>
      </fieldset>

      <a href={retailerSearchUrl} target="_blank" rel="noreferrer" className="tap-target mt-3 flex min-h-12 items-center justify-between rounded-control border border-line px-4 text-sm font-semibold">
        <span className="flex items-center gap-2"><Store className="h-4 w-4 text-brand" aria-hidden /> Open {getSupplierLabel(supplier)} results</span><ExternalLink className="h-4 w-4 text-ink-faint" aria-hidden />
      </a>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className="text-xs font-semibold text-ink-muted">Product link</span><input type="url" inputMode="url" value={productUrl} onChange={(event) => setProductUrl(event.target.value)} placeholder={`Paste the ${getSupplierLabel(supplier)} product URL`} className="mt-1.5 min-h-12 w-full rounded-control border border-line bg-raised px-4 text-base text-white outline-none placeholder:text-ink-faint" /></label>
        <label className="sm:col-span-2"><span className="text-xs font-semibold text-ink-muted">Product name</span><input value={productName} onChange={(event) => setProductName(event.target.value)} className={`mt-1.5 ${inputClass}`} /></label>
        <label><span className="text-xs font-semibold text-ink-muted">Retailer SKU <span className="font-normal text-ink-faint">(optional)</span></span><input value={retailerSku} onChange={(event) => setRetailerSku(event.target.value)} className={`mt-1.5 ${inputClass}`} /></label>
        <label><span className="text-xs font-semibold text-ink-muted">Quantity</span><input type="number" min="0.01" step="0.01" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={`mt-1.5 ${inputClass}`} /></label>
        <label><span className="text-xs font-semibold text-ink-muted">Unit price</span><span className="mt-1.5 flex min-h-12 items-center rounded-control border border-line bg-raised px-4"><span className="text-ink-muted">$</span><input type="number" min="0" step="0.01" inputMode="decimal" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className="min-w-0 flex-1 bg-transparent pl-1 text-base text-white outline-none" /></span></label>
        <label><span className="text-xs font-semibold text-ink-muted">Availability shown</span><select value={availability} onChange={(event) => setAvailability(event.target.value as ProductAvailability)} className={`mt-1.5 ${inputClass}`}>{Object.entries(availabilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>

      <div className="mt-4 rounded-control border border-line bg-white/[0.025] p-3">
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold">Pickup store</p><p className="mt-1 text-[10px] text-ink-faint">Edit this if you selected a different location.</p></div><a href={buildGoogleSupplierStoreSearchUrl(supplier, nearAddress)} target="_blank" rel="noreferrer" className="tap-target inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-brand"><MapPin className="h-4 w-4" aria-hidden /> Find nearby</a></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label><span className="text-[11px] text-ink-muted">Store name</span><input value={storeName} onChange={(event) => setStoreName(event.target.value)} className="mt-1 min-h-12 w-full rounded-control border border-line bg-raised px-4 text-base text-white outline-none" /></label>
          <label><span className="text-[11px] text-ink-muted">Store number</span><input value={storeNumber} onChange={(event) => setStoreNumber(event.target.value)} className="mt-1 min-h-12 w-full rounded-control border border-line bg-raised px-4 text-base text-white outline-none" /></label>
          <label className="sm:col-span-2"><span className="text-[11px] text-ink-muted">Store address used for routing</span><input value={storeAddress} onChange={(event) => setStoreAddress(event.target.value)} className="mt-1 min-h-12 w-full rounded-control border border-line bg-raised px-4 text-base text-white outline-none" /></label>
        </div>
      </div>

      <label className="tap-row mt-4 flex min-h-14 cursor-pointer items-start gap-3 rounded-control border border-line p-3"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 h-5 w-5 accent-brand" /><span className="text-xs leading-5 text-ink-muted">I checked this product, price, availability, and store on the retailer’s live page.</span></label>
      {error ? <p role="alert" className="mt-3 flex items-start gap-2 text-xs text-critical"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p> : null}
      <button type="submit" className="tap-target mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand"><Save className="h-5 w-5" aria-hidden /> Save verified product</button>
    </form>
  );
}

export function MaterialSourcingWorkflow({
  materials,
  jobReference = "inventory",
  nearAddress,
}: {
  materials: JobMaterial[];
  jobReference?: string;
  nearAddress: string;
}) {
  const [openMaterial, setOpenMaterial] = useState<string | null>(null);
  const [selections, setSelections] = useState<SavedProductSelection[]>([]);
  const [syncContext, setSyncContext] = useState<SyncContext | null>(null);
  const [saveMessage, setSaveMessage] = useState("Selections save on this device and sync when you are signed in.");
  const [isSyncing, startSync] = useTransition();

  useEffect(() => {
    let cancelled = false;

    async function loadBusinessSelections(localForJob: SavedProductSelection[]) {
      try {
        const supabase = createClient();
        const { data: authData } = await supabase.auth.getUser();
        if (!authData.user || cancelled) return;
        const { data: membership } = await supabase.from("organization_members").select("organization_id").eq("user_id", authData.user.id).limit(1).maybeSingle();
        if (!membership || cancelled) return;

        setSyncContext({ organizationId: membership.organization_id, userId: authData.user.id });
        const { data, error } = await supabase
          .from("supplier_product_selections")
          .select("id,job_reference,material_name,supplier,product_name,product_url,retailer_sku,quantity,unit_price_cents,availability,store_name,store_number,store_address,verified_at")
          .eq("organization_id", membership.organization_id)
          .eq("job_reference", jobReference)
          .is("archived_at", null)
          .order("verified_at", { ascending: false });
        if (error) throw error;
        if (cancelled) return;

        const remoteSelections = (data ?? []).map(selectionFromRow);
        const merged = mergeSelections(localForJob, remoteSelections);
        merged.forEach(writeLocalSelection);
        setSelections(merged);
        setSaveMessage("Connected to your business account. Product confirmations sync securely.");
      } catch {
        if (!cancelled) setSaveMessage("Saved selections stay on this device until account sync is available.");
      }
    }

    const timer = window.setTimeout(() => {
      const localForJob = readLocalSelections().filter((selection) => selection.jobReference === jobReference);
      setSelections(localForJob);
      void loadBusinessSelections(localForJob);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [jobReference]);

  const selectionsByMaterial = useMemo(() => {
    const grouped = new Map<string, SavedProductSelection[]>();
    selections.forEach((selection) => grouped.set(selection.materialName, [...(grouped.get(selection.materialName) ?? []), selection]));
    return grouped;
  }, [selections]);

  function saveSelection(candidate: SavedProductSelection) {
    const existing = selections.find((selection) => selection.materialName === candidate.materialName && selection.supplier === candidate.supplier && selection.productUrl === candidate.productUrl);
    const selection = existing ? { ...candidate, id: existing.id } : candidate;
    writeLocalSelection(selection);
    setSelections((current) => [selection, ...current.filter((item) => item.id !== selection.id)]);
    setOpenMaterial(null);
    setSaveMessage(syncContext ? "Saved locally. Syncing with your business account…" : "Saved on this device. Sign in to sync it with the business.");

    if (!syncContext) return;
    startSync(async () => {
      try {
        const supabase = createClient();
        const { error } = await supabase.from("supplier_product_selections").upsert({
          id: selection.id,
          organization_id: syncContext.organizationId,
          job_reference: selection.jobReference,
          material_name: selection.materialName,
          supplier: selection.supplier,
          product_name: selection.productName,
          product_url: selection.productUrl,
          retailer_sku: selection.retailerSku || null,
          quantity: selection.quantity,
          unit_price_cents: selection.unitPriceCents,
          availability: selection.availability,
          store_name: selection.storeName || null,
          store_number: selection.storeNumber || null,
          store_address: selection.storeAddress || null,
          verified_at: selection.verifiedAt,
          verified_by: syncContext.userId,
        }, { onConflict: "id" });
        if (error) throw error;
        setSaveMessage("Product confirmation saved to your business account.");
      } catch {
        setSaveMessage("Saved on this device; business sync will retry when the connection is available.");
      }
    });
  }

  function removeSelection(selection: SavedProductSelection) {
    removeLocalSelection(selection.id);
    setSelections((current) => current.filter((item) => item.id !== selection.id));
    setSaveMessage(syncContext ? "Selection removed. Updating your business account…" : "Selection removed from this device.");
    if (!syncContext) return;

    startSync(async () => {
      try {
        const supabase = createClient();
        const { error } = await supabase.from("supplier_product_selections").delete().eq("id", selection.id).eq("organization_id", syncContext.organizationId);
        if (error) throw error;
        setSaveMessage("Selection removed from your business account.");
      } catch {
        setSaveMessage("Removed on this device, but business sync needs another attempt.");
      }
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-start gap-3 rounded-control border border-line bg-white/[0.025] p-3" aria-live="polite"><PackageCheck className="mt-0.5 h-5 w-5 shrink-0 text-positive" aria-hidden /><div><p className="text-xs font-semibold">User-confirmed sourcing</p><p className="mt-1 text-[11px] leading-5 text-ink-muted">{isSyncing ? "Syncing…" : saveMessage}</p></div></div>
      <div className="space-y-3">
        {materials.map((material) => {
          const shortage = Math.max(0, material.quantity - material.truckStock);
          const estimatedTotal = shortage * material.estimatedUnitPrice;
          const materialSelections = selectionsByMaterial.get(material.name) ?? [];
          const isOpen = openMaterial === material.name;

          return (
            <article key={material.name} className="rounded-panel border border-line bg-white/[0.025] p-4">
              <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold">{material.name}</h2><p className="mt-1 text-xs text-ink-muted">Need {material.quantity} {material.unit} · Truck has {material.truckStock}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${shortage > 0 ? "bg-caution-bg text-caution" : "bg-positive-bg text-positive"}`}>{shortage > 0 ? `Buy ${shortage}` : "On truck"}</span></div>
              <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-control bg-white/[0.035] p-3"><p className="text-[10px] text-ink-faint">Pilot unit estimate</p><p className="mt-1 text-lg font-semibold">{money.format(material.estimatedUnitPrice)}</p></div><div className="rounded-control bg-white/[0.035] p-3"><p className="text-[10px] text-ink-faint">Estimated shortage cost</p><p className="mt-1 text-lg font-semibold">{money.format(estimatedTotal)}</p></div></div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <a href={buildLowesSearchUrl(material.searchTerm)} target="_blank" rel="noreferrer" className="tap-target flex min-h-12 items-center justify-between rounded-control border border-line px-4 text-sm font-semibold"><span className="flex items-center gap-2"><Store className="h-4 w-4 text-brand" aria-hidden /> Lowe’s live results</span><ExternalLink className="h-4 w-4 text-ink-faint" aria-hidden /></a>
                <a href={buildHomeDepotSearchUrl(material.searchTerm)} target="_blank" rel="noreferrer" className="tap-target flex min-h-12 items-center justify-between rounded-control border border-line px-4 text-sm font-semibold"><span className="flex items-center gap-2"><Store className="h-4 w-4 text-orange-400" aria-hidden /> Home Depot live results</span><ExternalLink className="h-4 w-4 text-ink-faint" aria-hidden /></a>
              </div>
              <button type="button" onClick={() => setOpenMaterial(isOpen ? null : material.name)} aria-expanded={isOpen} className="tap-target mt-3 flex min-h-12 w-full items-center justify-between rounded-control border border-brand/25 bg-brand/[0.06] px-4 text-sm font-semibold text-brand"><span className="flex items-center gap-2"><PackageCheck className="h-4 w-4" aria-hidden /> Save the product I chose</span>{isOpen ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}</button>

              {isOpen ? <ProductConfirmationForm material={material} jobReference={jobReference} nearAddress={nearAddress} onCancel={() => setOpenMaterial(null)} onSave={saveSelection} /> : null}

              {materialSelections.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Saved products</p>
                  {materialSelections.map((selection) => (
                    <div key={selection.id} className="rounded-control border border-positive/20 bg-positive-bg p-3">
                      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{selection.productName}</p><p className="mt-1 text-[11px] text-ink-muted">{getSupplierLabel(selection.supplier)} · {money.format(selection.unitPriceCents / 100)} each · Qty {selection.quantity}</p></div><span className="shrink-0 rounded-full bg-white/5 px-2 py-1 text-[9px] text-positive">{availabilityLabels[selection.availability]}</span></div>
                      <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-4 text-ink-faint"><MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />{selection.storeAddress || "Store not selected"}</p>
                      <p className="mt-1 text-[10px] text-ink-faint">Checked {dateTime.format(new Date(selection.verifiedAt))}</p>
                      <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                        <a href={selection.productUrl} target="_blank" rel="noreferrer" className="tap-target flex min-h-11 items-center justify-center gap-1.5 rounded-chip border border-line text-xs font-semibold"><ExternalLink className="h-3.5 w-3.5" aria-hidden /> Product</a>
                        <Link href={buildSelectionRouteHref(selection)} className="tap-target flex min-h-11 items-center justify-center gap-1.5 rounded-chip bg-brand px-2 text-xs font-semibold text-on-brand"><Route className="h-3.5 w-3.5" aria-hidden /> Route</Link>
                        <button type="button" onClick={() => removeSelection(selection)} className="tap-target grid min-h-11 min-w-11 place-items-center rounded-chip border border-line text-ink-muted" aria-label={`Remove ${selection.productName}`}><Trash2 className="h-4 w-4" aria-hidden /></button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
        {materials.length === 0 ? <p className="rounded-panel border border-dashed border-line p-8 text-center text-sm text-ink-muted">No material matches found.</p> : null}
      </div>

      {selections.length > 0 ? <Link href={buildSelectionRouteHref(selections[0])} className="tap-target mt-4 flex min-h-14 items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-semibold text-on-brand"><Boxes className="h-5 w-5" aria-hidden /> Build route with latest supply stop</Link> : null}
    </div>
  );
}
