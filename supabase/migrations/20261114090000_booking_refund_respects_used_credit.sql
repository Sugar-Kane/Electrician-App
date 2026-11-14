-- A diagnostic fee refund never gives back money an invoice already took off.
--
-- Raised by the Codex review on #277:
--
-- 1. Once a paid diagnostic fee has come off a repair invoice (its
--    diagnostic_credit_cents), refunding that fee too gave the customer the
--    money twice: back to their card, and off the invoice, which keeps its
--    credit. begin_booking_refund now refuses that part: what can be refunded
--    is the fee, less refunds already given, less credit already taken off
--    any invoice that is not void on the diagnostic or a job booked from it
--    (the same rule as creditGivenCents in follow-up-jobs.ts). A refund made
--    in Stripe's own dashboard cannot be refused, so when one overlaps credit
--    already used, the job's activity says the invoice needs adjusting.
--
-- 2. Two refunds of the same fee settling at once could each total the
--    refunds before the other committed, leaving too much credit on the job.
--    after_booking_refund now locks the payment first, so every path that
--    settles a refund (the app's answer from Stripe and the webhook) totals
--    them one at a time.

-- Diagnostic credit already taken off invoices that are not void, on this job
-- and every job booked from it.
create or replace function private.booking_credit_used(p_job_id uuid)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(sum(greatest(invoice.diagnostic_credit_cents, 0)), 0)::integer
  from public.invoices as invoice
  where invoice.status <> 'void'
    and invoice.job_id in (
      select job.id from public.jobs as job
      where job.id = p_job_id or job.follow_up_of = p_job_id
    );
$function$;

revoke all on function private.booking_credit_used(uuid) from public, anon, authenticated;

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
  used integer;
begin
  select r.id, r.payment_id, r.status, r.amount_cents, r.stripe_refund_id into refund
  from public.booking_payment_refunds as r
  where r.id = p_refund_id;
  if refund.id is null then
    return;
  end if;

  -- One refund of this fee at a time from here, whichever path settled it.
  select p.id, p.organization_id, p.booking_request_id, p.job_id, p.amount_cents into payment
  from public.payments as p
  where p.id = refund.payment_id
  for update;
  if payment.id is null then
    return;
  end if;

  select coalesce(sum(r.amount_cents), 0) into refunded
  from public.booking_payment_refunds as r
  where r.payment_id = payment.id
    and r.status = 'succeeded';
  remaining := greatest(payment.amount_cents - refunded, 0);

  if payment.job_id is not null then
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

    -- A refund given in Stripe's dashboard cannot be refused; say so when it
    -- gave back money an invoice had already taken off.
    if payment.job_id is not null then
      used := private.booking_credit_used(payment.job_id);
      if refunded + used > payment.amount_cents then
        insert into public.activity_events (organization_id, event_type, label, booking_request_id, job_id, metadata)
        values (
          payment.organization_id, 'booking.fee_refund_overlaps_credit',
          'Refund overlaps the diagnostic credit already on an invoice: adjust the invoice by $'
            || pg_catalog.to_char(least(refunded + used - payment.amount_cents, used) / 100.0, 'FM999999990.00'),
          payment.booking_request_id, payment.job_id,
          pg_catalog.jsonb_build_object('refunded_cents', refunded, 'credit_used_cents', used, 'fee_cents', payment.amount_cents)
        );
      end if;
    end if;
  end if;
end;
$function$;

revoke all on function private.after_booking_refund(uuid, text) from public, anon, authenticated;

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
  used integer;
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
  used := case when payment.job_id is null then 0 else private.booking_credit_used(payment.job_id) end;
  left_to_refund := payment.amount_cents - already - used;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'the refund must be more than zero' using errcode = '22023';
  end if;
  if left_to_refund <= 0 then
    if used > 0 then
      raise exception 'the diagnostic fee has already come off an invoice, so there is nothing left to refund here; adjust the invoice instead' using errcode = '22023';
    end if;
    raise exception 'this payment has already been refunded in full' using errcode = '22023';
  end if;
  if p_amount_cents > left_to_refund then
    raise exception 'that is more than is left to refund on this payment (part of it has already come off an invoice or been refunded)' using errcode = '22023';
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
