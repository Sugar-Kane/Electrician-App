# Change orders and invoice discounts

## Change orders

A change order adds, changes or removes work on a job that has a contract. It is optional: a job whose contract never changes only ever shows the "Create change order" button, under the contract.

- **Scope stays in `job_line_items`.** A change order lists items (`change_order_items`): additions, changes to a job line, or removals. Each change or removal keeps a copy of the line as it was (`original_*`), so nothing the customer agreed to is erased.
- **Only the difference is charged.** Two fans become three at $150 each: +$150. Removing a $200 fan: −$200. Worked out in `src/lib/change-order-math.ts`.
- **The customer approves by signing.** "Request customer approval" writes the change order document as a `contracts` row of kind `change_order`. It is sent or signed in person from the contract card, like any contract. The signature approves the change order in the same transaction (trigger `contracts_approve_change_order`). Nothing else can approve one: not the app, not ChatGPT, not the service role. The customer can also decline from their link (`decline_change_order`).
- **Unsigned contract:** "Update the contract" folds the change into the job, keeps the old draft as an earlier version that can no longer be signed, withdraws its signing link, and writes a new draft. Or keep the change order as a separate draft, sendable once the contract is signed.
- **Contract total** = the agreement's figure + every approved change order against it (`contractTotals`). Drafts, pending, declined and withdrawn change orders count for nothing.

## What approval does to invoices

`applyApprovedChangeOrder` (`src/lib/change-orders-server.ts`) builds a plan (`src/lib/change-order-apply.ts`). `apply_change_order` carries it out atomically, after checking nothing in the plan moved; a stale plan is rebuilt.

| Invoice | What happens |
|---|---|
| None yet | Lines change; the first invoice bills them as they are. |
| Draft, never sent | The draft is recounted. Nothing is sent. |
| Sent, not fully paid | Revised in place: the old figures are kept in `invoice_revisions`, payments stay counted, the PDF gets a new version, and the customer is sent the updated invoice once (claimed `pending → sending`, so retries never send twice). The same pay link is kept, so there is only ever one thing to pay. |
| Paid in full, Stripe-hosted, or with a bank payment on its way | Never changed. More work goes on a new invoice for the difference, which is sent. Less work is recorded as a credit owed (`change_orders.credit_due_cents`) and shown on the job. |

A revision that brings a part-paid invoice below what was paid marks it paid and records the overpayment as a credit to refund.

## Discounts

Percentage (basis points) or fixed (cents), one per invoice, set from the invoice page or ChatGPT (`set_invoice_discount`). A discount comes off the subtotal before the diagnostic credit and tax. A percentage is recalculated whenever the subtotal changes; a fixed amount stays as set and is held to the subtotal if the work shrinks below it (flagged on screen). With no discount, no discount line appears anywhere: the invoice page, PDF, customer page or ChatGPT.

Tax is an amount the business enters, not a rate (Volteira has no tax rates). The discount form lets it be corrected in the same save.

Who may: anyone with billing permission (owners and admins always; others unless the owner turned billing off for technicians). Checked in the app and again in `set_invoice_discount`.

## ChatGPT (MCP)

`list_job_change_orders`, `get_change_order`, `create_change_order`, `add_change_order_material`, `add_change_order_labor`, `modify_change_order_item`, `remove_change_order_item`, `update_change_order`, `get_change_order_summary`, `request_change_order_approval`, `set_invoice_discount`, `get_invoice_summary` (`src/lib/mcp-change-order-tools.ts`). `request_change_order_approval` writes the document only; the existing `send_contract_for_signature` texts it. Retried item requests are recognised by a request key.
