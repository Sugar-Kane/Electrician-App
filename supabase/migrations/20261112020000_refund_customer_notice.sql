-- Whether the customer has been told about a refund.
--
-- Null until somebody claims it. The server claims it once
-- (`update ... where customer_notice is null`), so a refund is announced
-- once however many times Stripe reports it; 'skipped' when the person
-- giving it chose not to tell the customer.
--
-- Additive: one nullable column.

alter table public.invoice_refunds
  add column if not exists customer_notice text
  check (customer_notice in ('sending', 'sent', 'skipped', 'failed'));
