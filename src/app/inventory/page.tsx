import { FieldPageShell } from "@/components/field-page-shell";
import { InventoryList, type InventoryRow } from "@/components/inventory-list";
import { getInventory } from "@/lib/job-data";

export const dynamic = "force-dynamic";

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
      <InventoryList items={items} />
    </FieldPageShell>
  );
}
