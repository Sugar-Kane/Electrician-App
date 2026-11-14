-- Refunds on diagnostic fees paid online at booking.
--
-- A booking's fee is a row in public.payments, not an invoice payment, so a
-- refund on it (given in Stripe's dashboard and reported by webhook) found no
-- invoice and record_stripe_refund returned false: the refund was recorded
-- nowhere, Paid today kept counting the fee, and the job kept its diagnostic
-- credit, so the customer would have been credited a fee they had already
-- been given back. There was also no way to give one from Volteira.
--
-- Now:
-- - booking_payment_refunds holds them, given in Volteira (begin_booking_refund
--   as the signed-in owner/admin, then settle_booking_refund from Stripe's
--   answer) or in Stripe (record_stripe_refund, from the webhook).
-- - Once one succeeds, the job's diagnostic credit is what the customer still
--   has paid: diagnostic_fee_cents becomes the fee less every successful
--   refund, and diagnostic_paid goes false (with the fee at 0) when nothing is
--   left, so the job is neither credited nor billed again for a fee the
--   business gave back. The original amount stays in payments.amount_cents.
-- - The job's activity notes it.
--
-- Members of the business can read the rows; only these functions write them.

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
  refunded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists booking_payment_refunds_organization_id_idx on public.booking_payment_refunds (organization_id);
create index if not exists booking_payment_refunds_payment_id_idx on public.booking_payment_refunds (payment_id);
create index if not exists booking_payment_refunds_booking_request_id_idx on public.booking_payment_refunds (booking_request_id);
create index if not exists booking_payment_refunds_job_id_idx on public.booking_payment_refunds (job_id);
create index if not exists booking_payment_refunds_refunded_by_idx on public.booking_payment_refunds (refunded_by);

alter table public.booking_payment_refunds enable row level security;

drop policy if exists "Organization members can view booking payment refunds" on public.booking_payment_refunds;
create policy "Organization members can view booking payment refunds"
  on public.booking_payment_refunds for select
  to authenticated
  using ((select private.is_org_member(organization_id)));

revoke insert, update, delete on public.booking_payment_refunds from anon, authenticated;
grant select on public.booking_payment_refunds to authenticated;

-- After a booking refund changes: the job's credit becomes what the customer
-- still has paid, and a refund that has just gone through is noted on the job.
create or replace function private.after_booking_refund(p_refund_id uuid, p_was_status text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  refund record;
  payment record;
  refunded integer;
  remaining integer;
begin
  select r.id, r.payment_id, r.status, r.amount_cents, r.stripe_refund_id into refund
  from public.booking_payment_refunds as r
  where r.id = p_refund_id;
  if refund.id is null then
    return;
  end if;

  select p.id, p.organization_id, p.booking_request_id, p.job_id, p.amount_cents into payment
  from public.payments as p
  where p.id = refund.payment_id;
  if payment.id is null then
    return;
  end if;

  if payment.job_id is not null then
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
  end if;

  if refund.status = 'succeeded' and coalesce(p_was_status, '') <> 'succeeded' then
    insert into public.activity_events (organization_id, event_type, label, booking_request_id, job_id, metadata)
    values (
      payment.organization_id, 'booking.fee_refunded',
      'Diagnostic fee refunded: $' || pg_catalog.to_char(refund.amount_cents / 100.0, 'FM999999990.00'),
      payment.booking_request_id, payment.job_id,
      pg_catalog.jsonb_build_object('amount_cents', refund.amount_cents, 'refund_id', refund.id, 'stripe_refund_id', refund.stripe_refund_id)
    );
  end if;
end;
$function$;

revoke all on function private.after_booking_refund(uuid, text) from public, anon, authenticated;

-- Start a refund of a booking's diagnostic fee, as the signed-in owner or
-- admin. Left pending for the server to send to Stripe and settle.
create or replace function public.begin_booking_refund(
  p_payment_id uuid,
  p_amount_cents integer,
  p_reason text default null
)
returns table (refund_id uuid, status text, payment_intent_id text, organization_id uuid, job_id uuid)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  payment record;
  already integer;
  left_to_refund integer;
  new_id uuid;
begin
  select p.id, p.organization_id, p.booking_request_id, p.job_id, p.amount_cents, p.status, p.provider_payment_intent_id
    into payment
  from public.payments as p
  where p.id = p_payment_id
  for update;

  if payment.id is null or not private.is_org_member(payment.organization_id) then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  if not private.is_org_admin(payment.organization_id) then
    raise exception 'only the owner or an admin can give refunds' using errcode = '42501';
  end if;
  if payment.status <> 'succeeded' then
    raise exception 'this payment did not go through, so there is nothing to refund' using errcode = '22023';
  end if;
  if payment.provider_payment_intent_id is null then
    raise exception 'this card payment cannot be found in Stripe' using errcode = '22023';
  end if;

  select coalesce(sum(r.amount_cents), 0)::integer into already
  from public.booking_payment_refunds as r
  where r.payment_id = payment.id
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

  insert into public.booking_payment_refunds (
    organization_id, payment_id, booking_request_id, job_id, amount_cents, status,
    reason, payment_intent_id, refunded_by
  ) values (
    payment.organization_id, payment.id, payment.booking_request_id, payment.job_id, p_amount_cents, 'pending',
    nullif(pg_catalog.btrim(coalesce(p_reason, '')), ''), payment.provider_payment_intent_id, auth.uid()
  )
  returning id into new_id;

  return query select new_id, 'pending'::text, payment.provider_payment_intent_id, payment.organization_id, payment.job_id;
end;
$function$;

revoke all on function public.begin_booking_refund(uuid, integer, text) from public, anon;
grant execute on function public.begin_booking_refund(uuid, integer, text) to authenticated;

-- Stripe's answer to a booking refund this app sent. Server only.
create or replace function public.settle_booking_refund(
  p_refund_id uuid,
  p_status text,
  p_stripe_refund_id text default null,
  p_failure_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  was text;
begin
  if p_status not in ('pending', 'succeeded', 'failed', 'canceled') then
    raise exception 'unknown refund status' using errcode = '22023';
  end if;

  select r.status into was
  from public.booking_payment_refunds as r
  where r.id = p_refund_id
  for update;
  if was is null then
    return false;
  end if;

  update public.booking_payment_refunds as r
  set status = p_status,
      stripe_refund_id = coalesce(r.stripe_refund_id, p_stripe_refund_id),
      failure_reason = p_failure_reason,
      settled_at = case when p_status in ('succeeded', 'failed', 'canceled') then coalesce(r.settled_at, now()) else r.settled_at end,
      updated_at = now()
  where r.id = p_refund_id;

  perform private.after_booking_refund(p_refund_id, was);
  return true;
end;
$function$;

revoke all on function public.settle_booking_refund(uuid, text, text, text) from public, anon, authenticated;

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
  new_id uuid;
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
  select r.id, r.status into booking_refund
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
    perform private.after_booking_refund(booking_refund.id, booking_refund.status);
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
    select p.id, p.booking_request_id, p.job_id into booking
    from public.payments as p
    where p.organization_id = business
      and p.provider_payment_intent_id = p_payment_intent_id
    limit 1;
    if booking.id is null then
      return false;
    end if;

    -- One this app sent a moment ago, before Stripe's id was written to it.
    select r.id, r.status into booking_refund
    from public.booking_payment_refunds as r
    where r.payment_id = booking.id
      and r.stripe_refund_id is null
      and r.amount_cents = p_amount_cents
      and r.status = 'pending'
    order by r.created_at
    limit 1
    for update;
    if booking_refund.id is not null then
      update public.booking_payment_refunds as r
      set stripe_refund_id = p_stripe_refund_id,
          status = p_status,
          failure_reason = p_failure_reason,
          settled_at = case when p_status in ('succeeded', 'failed', 'canceled') then coalesce(r.settled_at, now()) else r.settled_at end,
          updated_at = now()
      where r.id = booking_refund.id;
      perform private.after_booking_refund(booking_refund.id, booking_refund.status);
      return true;
    end if;

    insert into public.booking_payment_refunds (
      organization_id, payment_id, booking_request_id, job_id, amount_cents, status,
      reason, payment_intent_id, stripe_refund_id, failure_reason, settled_at
    ) values (
      business, booking.id, booking.booking_request_id, booking.job_id, p_amount_cents, p_status,
      'Refunded in Stripe', p_payment_intent_id, p_stripe_refund_id, p_failure_reason,
      case when p_status in ('succeeded', 'failed', 'canceled') then now() else null end
    )
    on conflict (stripe_refund_id) do nothing
    returning id into new_id;

    if new_id is not null then
      perform private.after_booking_refund(new_id, null);
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
