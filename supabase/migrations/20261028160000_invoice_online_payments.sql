-- Paying an invoice online: by bank (ACH) or card, from the customer's invoice
-- link, through Stripe Checkout.
--
-- Until now invoices were never collected online. The customer was told to
-- call, and the payment was recorded by hand with record_invoice_payment. Now
-- the same invoice link carries a Pay button. A card payment settles at once;
-- a bank payment takes a few business days to clear, and fails if the account
-- comes back short. So each online attempt is tracked on its own, and only a
-- payment that has actually cleared becomes an invoice payment, with the
-- invoice's balance and status moved in the same transaction as for one taken
-- in hand.
--
-- Adds a table and a function. The one change to something existing widens
-- invoice_payments' method check to allow 'bank'; every row it allowed before
-- is still allowed.

create table if not exists public.invoice_online_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  checkout_session_id text not null unique check (checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  payment_intent_id text,
  amount_cents integer not null check (amount_cents > 0),
  method text check (method in ('bank', 'card')),
  status text not null default 'open'
    check (status in ('open', 'processing', 'succeeded', 'failed', 'expired')),
  failure_reason text,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists invoice_online_payments_invoice_idx
  on public.invoice_online_payments (invoice_id, created_at desc);

alter table public.invoice_online_payments enable row level security;

revoke all on public.invoice_online_payments from anon, authenticated;
grant select on public.invoice_online_payments to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'invoice_online_payments'
      and policyname = 'Organization members can view online invoice payments'
  ) then
    create policy "Organization members can view online invoice payments"
      on public.invoice_online_payments for select to authenticated
      using ((select private.is_org_member(organization_id)));
  end if;
end
$$;

comment on table public.invoice_online_payments is
  'Each time a customer starts paying an invoice online (Stripe Checkout). Written only by the server, from the invoice link and Stripe''s webhook.';
comment on column public.invoice_online_payments.status is
  'open: checkout started. processing: a bank payment submitted and clearing. succeeded: cleared and recorded as an invoice payment. failed: the bank payment did not clear. expired: the checkout was abandoned.';

alter table public.invoice_payments
  add column if not exists stripe_checkout_session_id text unique;

comment on column public.invoice_payments.stripe_checkout_session_id is
  'Set when the payment was made online; one invoice payment per Stripe checkout.';

alter table public.invoice_payments drop constraint if exists invoice_payments_method_check;
alter table public.invoice_payments
  add constraint invoice_payments_method_check check (method in ('cash', 'check', 'card', 'bank', 'other'));

comment on table public.invoice_payments is
  'Payments against an invoice: taken in hand (record_invoice_payment) or made online (settle_invoice_online_payment).';

-- An online payment that has cleared, recorded once however many times Stripe
-- says so. The payment row, the invoice's balance and its status move together,
-- as for a payment taken in hand. The money has already been taken, so it is
-- recorded even when it is more than is now owed (somebody paid in hand while a
-- bank payment was clearing); what is over comes back as overpaid_cents for the
-- business to refund.
create or replace function public.settle_invoice_online_payment(
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_method text,
  p_amount_cents integer
)
returns table (status text, balance_due_cents integer, overpaid_cents integer, newly_recorded boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  attempt record;
  invoice record;
  owed integer;
  remaining integer;
  next_status text;
begin
  select o.id, o.organization_id, o.invoice_id, o.job_id, o.status
    into attempt
  from public.invoice_online_payments as o
  where o.checkout_session_id = p_checkout_session_id
  for update;

  if attempt.id is null then
    raise exception 'online payment not found' using errcode = 'P0002';
  end if;
  if p_method is null or p_method not in ('bank', 'card') then
    raise exception 'unknown payment method' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'the amount must be more than zero' using errcode = '22023';
  end if;

  select i.id, i.status, i.total_cents, i.balance_due_cents
    into invoice
  from public.invoices as i
  where i.id = attempt.invoice_id
  for update;

  -- Already recorded: Stripe sends an event more than once.
  if attempt.status = 'succeeded' then
    return query select invoice.status, coalesce(invoice.balance_due_cents, 0), 0, false;
    return;
  end if;

  owed := case when invoice.status in ('paid', 'void') then 0
               else greatest(coalesce(invoice.balance_due_cents, invoice.total_cents, 0), 0) end;

  insert into public.invoice_payments (organization_id, invoice_id, job_id, method, amount_cents, note, stripe_checkout_session_id)
  values (
    attempt.organization_id, attempt.invoice_id, attempt.job_id, p_method, p_amount_cents,
    case when p_method = 'bank' then 'Paid online by bank transfer (ACH)' else 'Paid online by card' end,
    p_checkout_session_id
  );

  update public.invoice_online_payments as o
  set status = 'succeeded',
      method = p_method,
      payment_intent_id = coalesce(nullif(p_payment_intent_id, ''), o.payment_intent_id),
      failure_reason = null,
      settled_at = now(),
      updated_at = now()
  where o.id = attempt.id;

  if invoice.status = 'void' then
    return query select invoice.status, 0, p_amount_cents, true;
    return;
  end if;

  remaining := greatest(owed - p_amount_cents, 0);
  next_status := case when remaining = 0 then 'paid' else 'partially_paid' end;

  update public.invoices as i
  set balance_due_cents = remaining,
      status = next_status,
      paid_at = case when remaining = 0 then coalesce(i.paid_at, now()) else i.paid_at end
  where i.id = invoice.id;

  return query select next_status, remaining, greatest(p_amount_cents - owed, 0), true;
end;
$function$;

revoke all on function public.settle_invoice_online_payment(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.settle_invoice_online_payment(text, text, text, integer) to service_role;
