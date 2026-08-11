-- Invoices can be created and looked at, but until now they could not be sent.
-- The business printed nothing, mailed nothing, and texted nothing; getting an
-- invoice to a customer happened outside the app entirely, which is also why
-- nothing in here could ever say whether a customer had actually been asked to
-- pay.
--
-- Two columns, mirroring what jobs.customer_notifications already does for
-- cancellations: the full attempt log, and a denormalised timestamp of the last
-- successful send so a list of invoices can show "sent" without unpacking JSON
-- for every row.

alter table public.invoices
  add column if not exists deliveries jsonb not null default '[]'::jsonb,
  add column if not exists last_sent_at timestamptz;

comment on column public.invoices.deliveries is
  'Append-only log of send attempts: [{channel, to, ok, detail, at}]. Failures are '
  'kept deliberately — "we texted a disconnected number three times" is the '
  'answer to why a customer says they never got a bill.';

comment on column public.invoices.last_sent_at is
  'When this invoice last went out successfully on any channel. Null means the '
  'customer has never been sent it, which is different from unpaid.';

-- Reading a "has this been sent" column should not scan the table.
create index if not exists invoices_last_sent_at_idx
  on public.invoices (organization_id, last_sent_at desc nulls last);
