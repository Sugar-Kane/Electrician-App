# Invoices the customer already paid

For a customer who paid in hand (cash on the spot, a check, or a card run outside Volteira): mark the invoice paid, and send them the paid invoice as their record.

## In the app

- **Job → Billing**, on a draft invoice: **Customer already paid?** Choose how they paid and, if you like, text and/or email them the paid invoice. Then **Mark paid**.
  - On a sent invoice, keep using **Record payment**. It also takes part payments.
- **On a paid invoice** (job page or the invoice's own page): **Send the paid invoice**.
- **The invoice's page** has the same **Customer already paid?** control for an unpaid invoice.

What happens:
- The whole balance is recorded as one payment, by the person who marked it, with the method and note.
- The invoice becomes Paid with $0.00 owed, and the job's billing step is done.
- The invoice PDF is rebuilt so it shows the payment.
- **The paid invoice the customer gets** says paid, the amount, how and when, $0.00 owed, and links to their invoice page (which also shows Paid).
  - It has no pay link and no due date.
  - Texts follow the same STOP rules as every invoice text.

Refused:
- a void or already-paid invoice;
- one collected through a Stripe-hosted invoice;
- one with nothing owed;
- an unknown method (cash, check, card or other only).

## Closing out the job

Work that is done and paid on the spot never went through scheduling or Start trip, Arrived and Finish, so it can be closed in one step:

- **Customer already paid?** has "The work is done: close out the job too" ticked by default.
- **On a paid invoice** whose job isn't completed, **Close out job** marks it completed.

A job closes out only when every invoice on it (void ones aside) is paid and nothing on it is left unbilled (`checkCloseOut`). Reserved parts come off the stock count, as when finishing a visit, and nothing is sent to the customer.

## From ChatGPT or Claude

- `mark_invoice_paid`:
  - Find the invoice by `invoice_number` or `job_number`. A job with no unpaid invoice is told to use `create_invoice` first; a job with several is asked which.
  - Needs `method`, plus an optional `note`.
  - `send`: `none` (the default), `sms`, `email` or `both`.
- `send_paid_invoice`: send an already-paid invoice by `sms`, `email` or `both`.
- `mark_invoice_paid` also takes `close_out_job: true` to close the job at the same time.
- `close_out_job`: close out a paid job by its number.

Both answer first with the exact proposal (invoice, customer, amount, method, how it will be sent) and do nothing until called again with `confirmed: true`, after the user says yes. ChatGPT is told to ask how the customer paid, never to assume it.

`send_invoice` now refuses a paid invoice and points to `send_paid_invoice`, so a paid customer is never sent a bill.

## How it is enforced

- **Database:** `record_invoice_paid_in_hand` (migration `20261109010000_invoice_paid_in_hand.sql`) locks the invoice and applies the rules above in one transaction.
  - A signed-in caller must be a member of the invoice's business.
  - The server (the ChatGPT route) must name the invoice's business, and the person it records must be a member of it.
- **App:** the same rules in `checkPaidInHand` (`src/lib/invoice-payment.ts`), so a form error is answered before the round trip.
- **Shared code:** `src/lib/invoice-paid-in-hand.ts`, used by both the app and the ChatGPT tools.
