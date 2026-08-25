import { FieldPageShell } from "@/components/field-page-shell";
import { InventoryList, type InventoryRow } from "@/components/inventory-list";
import { ReceiptScan } from "@/components/receipt-scan";
import { getInventory } from "@/lib/job-data";

export const dynamic = "force-dynamic";

/**
 * Reading a receipt is a vision call over a photograph, which is slower than
 * anything else on this page by an order of magnitude. The default fifteen
 * seconds kills it mid-read, and a killed function returns nothing — so the
 * spinner would sit there with no way out.
 */
export const maxDuration = 90;

/**
 * What the business already owns.
 *
 * Every electrician arriving here has stock — a van with breakers and wire in
 * it — and until this page the app assumed they had none, so a job's material
 * list showed everything as something to buy.
 */
export default async function InventoryPage() {
  const items: InventoryRow[] = await getInventory();

  return (
    <FieldPageShell
      title="Stock"
      eyebrow="Inventory"
      description="What is on the van and on the shelf. Job material lists check against this."
      backHref="/materials"
    >
      <div className="space-y-3">
        {/*
         * Above the list rather than inside it. Scanning a receipt is how stock
         * arrives, and it should not be a thing to go looking for behind a
         * search box that is about what is already there.
         */}
        <ReceiptScan />
        <InventoryList items={items} />
      </div>
    </FieldPageShell>
  );
}
