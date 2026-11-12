-- Refunds on invoice payments.
--
-- A refund is against one payment: a card payment taken online goes back
-- through Stripe (on the business's own connected account), and one taken in
-- hand is recorded as handed back. Only the owner or an admin may refund, and
-- never more than the payment still holds. The invoice is not reopened.
--
-- Rows are written only by the functions below: begin_invoice_refund (the
-- signed-in owner/admin), and settle_invoice_refund / record_stripe_refund
-- (the server, from Stripe's answer or its webhook). Members of the business
-- can read them.
--
-- Additive: a new table and three functions; nothing existing changes.

create table if not exists public.invoice_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  invoice_payment_id uuid references public.invoice_payments(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  method text not null check (method in ('cash', 'check', 'card', 'bank', 'other')),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'canceled')),
  reason text,
  payment_intent_id text,
  stripe_refund_id text unique,
  failure_reason text,
  refunded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists invoice_refunds_organization_id_idx on public.invoice_refunds (organization_id);
create index if not exists invoice_refunds_invoice_id_idx on public.invoice_refunds (invoice_id);
create index if not exists invoice_refunds_invoice_payment_id_idx on public.invoice_refunds (invoice_payment_id);
create index if not exists invoice_refunds_job_id_idx on public.invoice_refunds (job_id);
create index if not exists invoice_refunds_refunded_by_idx on public.invoice_refunds (refunded_by);
create index if not exists invoice_refunds_payment_intent_id_idx on public.invoice_refunds (payment_intent_id);

alter table public.invoice_refunds enable row level security;

drop policy if exists "Organization members can view invoice refunds" on public.invoice_refunds;
create policy "Organization members can view invoice refunds"
  on public.invoice_refunds for select
  to authenticated
  using ((select private.is_org_member(organization_id)));

revoke insert, update, delete on public.invoice_refunds from anon, authenticated;
grant select on public.invoice_refunds to authenticated;

-- Start a refund against one payment, as the signed-in owner or admin.
-- A payment taken in hand is refunded at once; a card payment taken online is
-- left pending for the server to send to Stripe and settle.
create or replace function public.begin_invoice_refund(
  p_payment_id uuid,
  p_amount_cents integer,
  p_reason text default null
)
returns table (refund_id uuid, status text, payment_intent_id text, organization_id uuid, invoice_id uuid)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  payment record;
  intent text;
  already integer;
  left_to_refund integer;
  new_id uuid;
  new_status text;
begin
  select p.id, p.organization_id, p.invoice_id, p.job_id, p.method, p.amount_cents, p.stripe_checkout_session_id
    into payment
  from public.invoice_payments as p
  where p.id = p_payment_id
  for update;

  if payment.id is null or not private.is_org_member(payment.organization_id) then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  if not private.is_org_admin(payment.organization_id) then
    raise exception 'only the owner or an admin can give refunds' using errcode = '42501';
  end if;

  select coalesce(sum(r.amount_cents), 0)::integer into already
  from public.invoice_refunds as r
  where r.invoice_payment_id = payment.id
    and r.status in ('pending', 'succeeded');
  left_to_refund := payment.amount_cents - already;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'the refund must be more than zero' using errcode = '22023';
  end if;
  if left_to_refund <= 0 then
    raise exception 'this payment has already been refunded in full' using errcode = '22023';
  end if;
  if p_amount_cents > left_to_refund then
    raise exception 'that is more than is left to refund on this payment' using errcode = '22023';
  end if;

  if payment.stripe_checkout_session_id is not null then
    select o.payment_intent_id into intent
    from public.invoice_online_payments as o
    where o.checkout_session_id = payment.stripe_checkout_session_id
      and o.organization_id = payment.organization_id
    limit 1;
    if intent is null then
      raise exception 'this card payment cannot be found in Stripe' using errcode = '22023';
    end if;
    new_status := 'pending';
  else
    new_status := 'succeeded';
  end if;

  insert into public.invoice_refunds (
    organization_id, invoice_id, invoice_payment_id, job_id, amount_cents, method, status,
    reason, payment_intent_id, refunded_by, settled_at
  )
  values (
    payment.organization_id, payment.invoice_id, payment.id, payment.job_id, p_amount_cents, payment.method, new_status,
    nullif(trim(coalesce(p_reason, '')), ''), intent, auth.uid(),
    case when new_status = 'succeeded' then now() else null end
  )
  returning id into new_id;

  return query select new_id, new_status, intent, payment.organization_id, payment.invoice_id;
end;
$function$;

revoke all on function public.begin_invoice_refund(uuid, integer, text) from public, anon;
grant execute on function public.begin_invoice_refund(uuid, integer, text) to authenticated;

-- Stripe's answer to a refund this app sent. Server only.
create or replace function public.settle_invoice_refund(
  p_refund_id uuid,
  p_status text,
  p_stripe_refund_id text default null,
  p_failure_reason text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_status not in ('pending', 'succeeded', 'failed', 'canceled') then
    raise exception 'unknown refund status' using errcode = '22023';
  end if;
  update public.invoice_refunds as r
  set status = p_status,
      stripe_refund_id = coalesce(p_stripe_refund_id, r.stripe_refund_id),
      failure_reason = p_failure_reason,
      settled_at = case when p_status in ('succeeded', 'failed', 'canceled') then coalesce(r.settled_at, now()) else r.settled_at end,
      updated_at = now()
  where r.id = p_refund_id;
end;
$function$;

revoke all on function public.settle_invoice_refund(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.settle_invoice_refund(uuid, text, text, text) to service_role;

-- A refund Stripe reports on a business's account: one this app sent (matched
-- by its Stripe id) is updated; one made in the Stripe dashboard is added
-- against the payment it refunds, found by its payment intent. Server only.
-- Returns false when no payment of that business matches.
create or replace function public.record_stripe_refund(
  p_stripe_account_id text,
  p_payment_intent_id text,
  p_stripe_refund_id text,
  p_amount_cents integer,
  p_status text,
  p_failure_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  business uuid;
  online record;
  payment record;
begin
  if p_status not in ('pending', 'succeeded', 'failed', 'canceled') then
    raise exception 'unknown refund status' using errcode = '22023';
  end if;

  update public.invoice_refunds as r
  set status = p_status,
      failure_reason = p_failure_reason,
      settled_at = case when p_status in ('succeeded', 'failed', 'canceled') then coalesce(r.settled_at, now()) else r.settled_at end,
      updated_at = now()
  where r.stripe_refund_id = p_stripe_refund_id;
  if found then
    return true;
  end if;

  select a.organization_id into business
  from public.stripe_connect_accounts as a
  where a.stripe_account_id = p_stripe_account_id;
  if business is null then
    return false;
  end if;

  select o.checkout_session_id, o.invoice_id into online
  from public.invoice_online_payments as o
  where o.organization_id = business
    and o.payment_intent_id = p_payment_intent_id
  limit 1;
  if online.checkout_session_id is null then
    return false;
  end if;

  select p.id, p.invoice_id, p.job_id, p.method into payment
  from public.invoice_payments as p
  where p.organization_id = business
    and p.stripe_checkout_session_id = online.checkout_session_id
  limit 1;
  if payment.id is null then
    return false;
  end if;

  -- One this app sent a moment ago, before Stripe's id was written to it.
  update public.invoice_refunds as r
  set stripe_refund_id = p_stripe_refund_id,
      status = p_status,
      failure_reason = p_failure_reason,
      settled_at = case when p_status in ('succeeded', 'failed', 'canceled') then coalesce(r.settled_at, now()) else r.settled_at end,
      updated_at = now()
  where r.id = (
    select r2.id from public.invoice_refunds as r2
    where r2.invoice_payment_id = payment.id
      and r2.stripe_refund_id is null
      and r2.amount_cents = p_amount_cents
      and r2.status = 'pending'
    order by r2.created_at
    limit 1
  );
  if found then
    return true;
  end if;

  insert into public.invoice_refunds (
    organization_id, invoice_id, invoice_payment_id, job_id, amount_cents, method, status,
    reason, payment_intent_id, stripe_refund_id, failure_reason, settled_at
  )
  values (
    business, payment.invoice_id, payment.id, payment.job_id, p_amount_cents, payment.method, p_status,
    'Refunded in Stripe', p_payment_intent_id, p_stripe_refund_id, p_failure_reason,
    case when p_status in ('succeeded', 'failed', 'canceled') then now() else null end
  )
  on conflict (stripe_refund_id) do nothing;
  return true;
end;
$function$;

revoke all on function public.record_stripe_refund(text, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.record_stripe_refund(text, text, text, integer, text, text) to service_role;
