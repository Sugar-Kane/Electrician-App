-- Whether the customer was told about a diagnostic fee refund.
--
-- Invoice refunds have had this since they were built (invoice_refunds
-- .customer_notice); refunds of a diagnostic fee paid when booking had no
-- notice at all, so a customer refunded $180 heard nothing. The column is the
-- claim that makes the notice go once: null until someone sends it, then
-- 'sending' and finally 'sent', 'failed' or 'skipped' (the person refunding
-- chose not to tell them).

alter table public.booking_payment_refunds
  add column if not exists customer_notice text
  check (customer_notice is null or customer_notice in ('sending', 'sent', 'failed', 'skipped'));
