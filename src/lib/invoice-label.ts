/**
 * An invoice's number as people see it: after its job, "24" for job #24's
 * first invoice and "24-2" for the next (supabase/migrations/
 * 20261111070000_invoice_number_label.sql). Older invoices keep the number
 * they were sent with. Shown with "INV-" in front.
 *
 * Import-free, so anything can share one reading.
 */

/** The label without "INV-": the stored label, else the old running number. */
export function invoiceLabel(row: { number_label?: unknown; invoice_number?: unknown } | null | undefined): string {
  const label = typeof row?.number_label === "string" ? row.number_label.trim() : "";
  if (label) return label;
  const number = row?.invoice_number;
  return number === null || number === undefined ? "" : String(number);
}

/** What somebody typed or said ("INV-24-2", "#24", "24") as a label to look up. */
export function invoiceRef(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^#/, "")
    .replace(/^inv[-\s#]*/i, "")
    .trim();
}
