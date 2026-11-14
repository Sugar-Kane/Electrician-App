-- Refunds on diagnostic fees paid online at booking.
--
-- A booking's fee is a row in public.payments, not an invoice payment, so a
-- refund on it (given in Stripe's dashboard and reported by webhook) found no
-- invoice and record_stripe_refund returned false: the refund was recorded
-- nowhere, Paid today kept counting the fee, and the job kept its diagnostic
-- credit, so the customer would have been credited a fee they had already
-- been given back.
--
-- Now such a refund is a row here, and once it succeeds the job's diagnostic
-- credit is what the customer still has paid: diagnostic_fee_cents becomes
-- the fee less every successful refund, and diagnostic_paid goes false (with
-- the fee at 0) when nothing is left, so the job is neither credited nor
-- billed again for a fee the business gave back. The original amount stays
-- in payments.amount_cents.
--
-- Rows are written only by record_stripe_refund (the server, from Stripe's
-- webhook). Members of the business can read them.

create table if not exists public.booking_payment_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  booking_request_id uuid references public.booking_requests(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'canceled')),
  reason text,
  payment_intent_id text,
  stripe_refund_id text unique,
  failure_reason text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists booking_payment_refunds_organization_id_idx on public.booking_payment_refunds (organization_id);
create index if not exists booking_payment_refunds_payment_id_idx on public.booking_payment_refunds (payment_id);
create index if not exists booking_payment_refunds_booking_request_id_idx on public.booking_payment_refunds (booking_request_id);
create index if not exists booking_payment_refunds_job_id_idx on public.booking_payment_refunds (job_id);

alter table public.booking_payment_refunds enable row level security;

drop policy if exists "Organization members can view booking payment refunds" on public.booking_payment_refunds;
create policy "Organization members can view booking payment refunds"
  on public.booking_payment_refunds for select
  to authenticated
  using ((select private.is_org_member(organization_id)));

revoke insert, update, delete on public.booking_payment_refunds from anon, authenticated;
grant select on public.booking_payment_refunds to authenticated;

-- What the customer still has paid for a booking's fee becomes the job's
-- diagnostic credit.
create or replace function private.sync_booking_refund_credit(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  payment record;
  refunded integer;
  remaining integer;
begin
  select p.id, p.job_id, p.amount_cents into payment
  from public.payments as p
  where p.id = p_payment_id;
  if payment.id is null or payment.job_id is null then
    return;
  end if;

  select coalesce(sum(r.amount_cents), 0) into refunded
  from public.booking_payment_refunds as r
  where r.payment_id = payment.id
    and r.status = 'succeeded';

  remaining := greatest(payment.amount_cents - refunded, 0);

  update public.jobs
  set diagnostic_fee_cents = remaining,
      diagnostic_paid = remaining > 0
  where id = payment.job_id
    and diagnostic_paid;
end;
$function$;

revoke all on function private.sync_booking_refund_credit(uuid) from public, anon, authenticated;

create or replace function public.record_stripe_refund(p_stripe_account_id text, p_payment_intent_id text, p_stripe_refund_id text, p_amount_cents integer, p_status text, p_failure_reason text default null::text)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  business uuid;
  online record;
  payment record;
  booking record;
  booking_refund record;
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

  -- A booking fee's refund already on file: Stripe telling us how it ended.
  select r.id, r.payment_id, r.status into booking_refund
  from public.booking_payment_refunds as r
  where r.stripe_refund_id = p_stripe_refund_id
  for update;
  if booking_refund.id is not null then
    update public.booking_payment_refunds as r
    set status = p_status,
        failure_reason = p_failure_reason,
        settled_at = case when p_status in ('succeeded', 'failed', 'canceled') then coalesce(r.settled_at, now()) else r.settled_at end,
        updated_at = now()
    where r.id = booking_refund.id;
    perform private.sync_booking_refund_credit(booking_refund.payment_id);
    if p_status = 'succeeded' and booking_refund.status <> 'succeeded' then
      insert into public.activity_events (organization_id, event_type, label, booking_request_id, job_id, metadata)
      select p.organization_id, 'booking.fee_refunded',
             'Diagnostic fee refunded: $' || pg_catalog.to_char(p_amount_cents / 100.0, 'FM999999990.00'),
             p.booking_request_id, p.job_id,
             pg_catalog.jsonb_build_object('amount_cents', p_amount_cents, 'stripe_refund_id', p_stripe_refund_id)
      from public.payments as p where p.id = booking_refund.payment_id;
    end if;
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
    -- Not an invoice: perhaps a diagnostic fee paid at booking.
    select p.id, p.booking_request_id, p.job_id, p.organization_id into booking
    from public.payments as p
    where p.organization_id = business
      and p.provider_payment_intent_id = p_payment_intent_id
    limit 1;
    if booking.id is null then
      return false;
    end if;

    insert into public.booking_payment_refunds (
      organization_id, payment_id, booking_request_id, job_id, amount_cents, status,
      reason, payment_intent_id, stripe_refund_id, failure_reason, settled_at
    ) values (
      business, booking.id, booking.booking_request_id, booking.job_id, p_amount_cents, p_status,
      'Refunded in Stripe', p_payment_intent_id, p_stripe_refund_id, p_failure_reason,
      case when p_status in ('succeeded', 'failed', 'canceled') then now() else null end
    )
    on conflict (stripe_refund_id) do nothing;

    if found then
      perform private.sync_booking_refund_credit(booking.id);
      if p_status = 'succeeded' then
        insert into public.activity_events (organization_id, event_type, label, booking_request_id, job_id, metadata)
        values (
          business, 'booking.fee_refunded',
          'Diagnostic fee refunded: $' || pg_catalog.to_char(p_amount_cents / 100.0, 'FM999999990.00'),
          booking.booking_request_id, booking.job_id,
          pg_catalog.jsonb_build_object('amount_cents', p_amount_cents, 'stripe_refund_id', p_stripe_refund_id)
        );
      end if;
    end if;
    return true;
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
