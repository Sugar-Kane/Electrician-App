import type { SupplierId } from "@/lib/pilot-data";

export type ProductAvailability = "in_stock" | "limited" | "out_of_stock" | "unknown";

export type SavedProductSelection = {
  id: string;
  jobReference: string;
  materialName: string;
  supplier: SupplierId;
  productName: string;
  productUrl: string;
  retailerSku: string;
  quantity: number;
  unitPriceCents: number;
  availability: ProductAvailability;
  storeName: string;
  storeNumber: string;
  storeAddress: string;
  verifiedAt: string;
};

export const availabilityLabels: Record<ProductAvailability, string> = {
  in_stock: "In stock",
  limited: "Limited stock",
  out_of_stock: "Out of stock",
  unknown: "Confirm at retailer",
};

export function getSupplierLabel(supplier: SupplierId) {
  return supplier === "lowes" ? "Lowe’s" : "Home Depot";
}

export function isAllowedSupplierProductUrl(value: string, supplier: SupplierId) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    const allowedHost = supplier === "lowes" ? "lowes.com" : "homedepot.com";
    return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`);
  } catch {
    return false;
  }
}

export function buildSelectionRouteHref(selection: SavedProductSelection) {
  const params = new URLSearchParams({
    job: selection.jobReference,
    supplier: selection.supplier,
  });

  if (selection.storeName.trim()) params.set("storeName", selection.storeName.trim());
  if (selection.storeAddress.trim()) params.set("storeAddress", selection.storeAddress.trim());
  if (selection.storeNumber.trim()) params.set("storeNumber", selection.storeNumber.trim());

  return `/route?${params.toString()}`;
}
