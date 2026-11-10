/**
 * Who may change billing: raise, edit, send or delete an invoice, or record a
 * payment. Every role may, except a technician in a business whose owner has
 * turned `technicians_can_edit_billing` off. Technicians can still see it all.
 *
 * The database applies the same rule to the rows (RLS and the payment
 * functions, migration 20261111020000). This copy lets an action refuse with
 * a plain message, and it is the only guard on sending, which runs with the
 * service role.
 *
 * Import-free so it can be tested on its own.
 */

export const BILLING_LOCKED_MESSAGE =
  "Your business owner has turned off billing changes for technicians. Ask an owner or admin to do this.";

export function canEditBilling(role: string, techniciansCanEditBilling: boolean): boolean {
  if (!role) return false;
  return role !== "technician" || techniciansCanEditBilling;
}
