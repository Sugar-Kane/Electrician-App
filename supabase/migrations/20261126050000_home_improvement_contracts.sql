-- California home improvement contracts (compliance CSLB-002-001, CSLB-002-009,
-- CSLB-003-016/017/025, CSLB-008-001, CSLB-007-001/002/003/004/007,
-- CA-005-007/008, CSLB-007-011).
--
-- 1. A contract type. Residential work is a home improvement contract unless
--    the office picks service and repair, commercial or new construction.
-- 2. The statutory notices a home improvement contract carries, frozen with
--    the contract (legal_notices, written by src/lib/ca-home-improvement.ts
--    from the 2026 CSLB Law Book text) and covered by the signature's hash.
-- 3. The buyer's right to cancel: the deadline is worked out when they sign
--    (midnight after the third business day, the fifth for a buyer 65 or
--    older), deposits and pay links wait until it passes, the customer can
--    cancel from their link, and a cancellation starts a 10-day refund clock.
--
-- The business-day rule mirrors cancellationDeadline in
-- src/lib/ca-home-improvement.ts (tested there). Counsel must confirm the
-- holiday list; Civil Code 1689.5 was not read from an official source.

alter table public.contracts
  add column if not exists contract_type text,
  add column if not exists legal_notices jsonb,
  add column if not exists senior_buyer boolean,
  add column if not exists negotiated_at_business boolean not null default false,
  add column if not exists cancel_deadline timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_channel text,
  add column if not exists cancellation_note text,
  add column if not exists refund_due_by timestamptz,
  add column if not exists refunds_completed_at timestamptz;

alter table public.contracts drop constraint if exists contracts_contract_type_check;
alter table public.contracts add constraint contracts_contract_type_check
  check (contract_type is null or contract_type in ('home_improvement', 'service_repair', 'commercial', 'new_construction'));

alter table public.contracts drop constraint if exists contracts_cancellation_channel_check;
alter table public.contracts add constraint contracts_cancellation_channel_check
  check (cancellation_channel is null or cancellation_channel in ('customer_link', 'email', 'mail', 'fax', 'in_person', 'other'));

alter table public.contracts drop constraint if exists contracts_status_check;
alter table public.contracts add constraint contracts_status_check
  check (status in ('draft', 'sent', 'signed', 'void', 'cancelled'));

alter table public.contracts drop constraint if exists contracts_cancellation_complete;
alter table public.contracts add constraint contracts_cancellation_complete
  check ((status = 'cancelled') = (cancelled_at is not null and cancellation_channel is not null and refund_due_by is not null));

comment on column public.contracts.legal_notices is
  'The statutory notices this contract carries (version, sections, cancellation form facts), frozen when drafted and covered by signed_body_hash.';
comment on column public.contracts.cancel_deadline is
  'When the buyer''s right to cancel ends: midnight after the 3rd business day (5th for a buyer 65+) after signing. Set by sign_contract_in_app.';
comment on column public.contracts.refund_due_by is
  'Ten days after the cancellation was received: everything the buyer paid must be returned by then.';

-- Business days for the right to cancel: every day but Sunday and the listed holidays.
create or replace function private.is_cancellation_business_day(p_day date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select extract(isodow from p_day) <> 7
     and not (
          (extract(month from p_day) = 1 and extract(day from p_day) = 1)
       or (extract(month from p_day) = 7 and extract(day from p_day) = 4)
       or (extract(month from p_day) = 11 and extract(day from p_day) = 11)
       or (extract(month from p_day) = 12 and extract(day from p_day) = 25)
       or (extract(month from p_day) = 2 and extract(isodow from p_day) = 1 and extract(day from p_day) between 15 and 21)
       or (extract(month from p_day) = 5 and extract(isodow from p_day) = 1 and extract(day from p_day) >= 25)
       or (extract(month from p_day) = 9 and extract(isodow from p_day) = 1 and extract(day from p_day) <= 7)
       or (extract(month from p_day) = 10 and extract(isodow from p_day) = 1 and extract(day from p_day) between 8 and 14)
       or (extract(month from p_day) = 11 and extract(isodow from p_day) = 4 and extract(day from p_day) between 22 and 28)
     );
$$;

create or replace function private.cancellation_deadline(p_received timestamptz, p_time_zone text, p_senior boolean)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  day date := (p_received at time zone p_time_zone)::date;
  counted integer := 0;
  needed integer := case when p_senior then 5 else 3 end;
begin
  loop
    day := day + 1;
    if private.is_cancellation_business_day(day) then
      counted := counted + 1;
    end if;
    exit when counted >= needed;
  end loop;
  return ((day + 1)::timestamp at time zone p_time_zone);
end;
$$;

revoke all on function private.is_cancellation_business_day(date) from public, anon, authenticated;
revoke all on function private.cancellation_deadline(timestamptz, text, boolean) from public, anon, authenticated;

-- Whether a contract carries a right to cancel.
create or replace function private.contract_cancellable(p_notices jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_notices -> 'cancellationForm') = 'object', false);
$$;

revoke all on function private.contract_cancellable(jsonb) from public, anon, authenticated;

-- Signing: the hash now covers the notices too (unchanged for a contract
-- without them), and a contract with a right to cancel gets its deadline.
create or replace function public.sign_contract_in_app(p_token uuid, p_method text, p_name text, p_image text, p_ip text, p_user_agent text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  signed_id uuid;
begin
  if p_method is null or p_method not in ('drawn', 'typed') then
    return null;
  end if;

  if coalesce(pg_catalog.btrim(p_name), '') = '' then
    return null;
  end if;

  if p_method = 'drawn' and coalesce(pg_catalog.btrim(p_image), '') = '' then
    return null;
  end if;

  update public.contracts as contract
  set status = 'signed',
      signature_provider = 'in_app',
      signed_at = pg_catalog.now(),
      signature_method = p_method,
      signature_name = pg_catalog.btrim(p_name),
      signature_image = case when p_method = 'drawn' then p_image else null end,
      signed_ip = nullif(pg_catalog.btrim(coalesce(p_ip, '')), ''),
      signed_user_agent = nullif(pg_catalog.btrim(coalesce(p_user_agent, '')), ''),
      -- Hashed here, from the row, and never taken from the caller. The
      -- statutory notices are part of what was signed.
      signed_body_hash = pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(
          contract.body || case when contract.legal_notices is null then '' else E'\n\n' || contract.legal_notices::text end,
          'UTF8')), 'hex'
      ),
      cancel_deadline = case
        when private.contract_cancellable(contract.legal_notices) then private.cancellation_deadline(
          pg_catalog.now(),
          coalesce((select organization.timezone from public.organizations as organization where organization.id = contract.organization_id), 'America/Los_Angeles'),
          coalesce(contract.senior_buyer, (contract.legal_notices ->> 'seniorBuyer')::boolean, false))
        else null
      end,
      updated_at = pg_catalog.now()
  where contract.public_token = p_token
    and contract.signed_at is null
    and contract.status <> 'void'
    and pg_catalog.cardinality(contract.unfilled) = 0
    and contract.signature_provider is distinct from 'documenso'
    and not exists (
      select 1
      from public.contracts as newer
      where newer.job_id = contract.job_id
        and newer.id <> contract.id
        and newer.status <> 'void'
        and newer.created_at > contract.created_at
    )
  returning contract.id into signed_id;

  return signed_id;
end;
$function$;

-- What was signed stays as it was: the notices, the type, and the facts the
-- right to cancel was worked out from. A cancellation may be recorded once.
create or replace function private.keep_signed_contract_text()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if old.signed_at is null then
    return new;
  end if;

  if new.body is distinct from old.body
     or new.legal_notices is distinct from old.legal_notices
     or new.contract_type is distinct from old.contract_type
     or new.senior_buyer is distinct from old.senior_buyer
     or new.negotiated_at_business is distinct from old.negotiated_at_business then
    raise exception 'A signed contract cannot be reworded. Draft a new one alongside it.'
      using errcode = 'check_violation';
  end if;

  if new.cancel_deadline is distinct from old.cancel_deadline and old.cancel_deadline is not null then
    raise exception 'The right-to-cancel deadline of a signed contract cannot be changed.'
      using errcode = 'check_violation';
  end if;

  if old.cancelled_at is not null and (
    new.cancelled_at is distinct from old.cancelled_at
    or new.cancellation_channel is distinct from old.cancellation_channel
    or new.refund_due_by is distinct from old.refund_due_by
    or new.status is distinct from old.status
  ) then
    raise exception 'A cancellation cannot be changed once it has been recorded.'
      using errcode = 'check_violation';
  end if;

  -- This app's own record of who signed, when and from where. Documenso's rows
  -- are left to Documenso's flow, which owns those fields.
  if old.signature_provider = 'in_app' and (
    new.signature_provider is distinct from old.signature_provider
    or new.signed_at is distinct from old.signed_at
    or new.signature_method is distinct from old.signature_method
    or new.signature_name is distinct from old.signature_name
    or new.signature_image is distinct from old.signature_image
    or new.signed_ip is distinct from old.signed_ip
    or new.signed_user_agent is distinct from old.signed_user_agent
    or new.signed_body_hash is distinct from old.signed_body_hash
  ) then
    raise exception 'A signature cannot be changed once it has been given.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

-- The customer cancelling from their link, within the right to cancel.
create or replace function public.cancel_contract_by_customer(p_token uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  cancelled_id uuid;
begin
  update public.contracts as contract
  set status = 'cancelled',
      cancelled_at = pg_catalog.now(),
      cancellation_channel = 'customer_link',
      cancellation_note = nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_note, '')), 1000), ''),
      refund_due_by = pg_catalog.now() + interval '10 days',
      updated_at = pg_catalog.now()
  where contract.public_token = p_token
    and contract.status = 'signed'
    and contract.signed_at is not null
    and contract.cancelled_at is null
    and private.contract_cancellable(contract.legal_notices)
    and (contract.cancel_deadline is null or pg_catalog.now() < contract.cancel_deadline)
  returning contract.id into cancelled_id;
  return cancelled_id;
end;
$function$;

revoke all on function public.cancel_contract_by_customer(uuid, text) from public;
grant execute on function public.cancel_contract_by_customer(uuid, text) to anon, authenticated;

-- The office recording a cancellation the customer sent another way (email,
-- mail, fax, in person), with when it was received. Billing editors only.
create or replace function public.record_contract_cancellation(p_contract_id uuid, p_channel text, p_received_at timestamptz, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_org uuid;
  cancelled_id uuid;
  received timestamptz := least(coalesce(p_received_at, pg_catalog.now()), pg_catalog.now());
begin
  if p_channel is null or p_channel not in ('email', 'mail', 'fax', 'in_person', 'other') then
    return null;
  end if;
  select contract.organization_id into target_org from public.contracts as contract where contract.id = p_contract_id;
  if target_org is null or not private.can_edit_billing(target_org) then
    return null;
  end if;

  update public.contracts as contract
  set status = 'cancelled',
      cancelled_at = received,
      cancellation_channel = p_channel,
      cancellation_note = nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_note, '')), 1000), ''),
      refund_due_by = received + interval '10 days',
      updated_at = pg_catalog.now()
  where contract.id = p_contract_id
    and contract.organization_id = target_org
    and contract.status = 'signed'
    and contract.cancelled_at is null
    and private.contract_cancellable(contract.legal_notices)
  returning contract.id into cancelled_id;
  return cancelled_id;
end;
$function$;

revoke all on function public.record_contract_cancellation(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.record_contract_cancellation(uuid, text, timestamptz, text) to authenticated;

-- No pay link or hand-recorded payment while the buyer may still cancel, or
-- after they did. Card and bank payments Stripe already took are recorded
-- regardless (refusing them would lose track of money received).
create or replace function private.job_cancellation_hold(p_job_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when contract.status = 'cancelled' then 'The customer cancelled this contract. Nothing more can be collected; refund what they paid.'
    when contract.signed_at is not null
     and private.contract_cancellable(contract.legal_notices)
     and (contract.cancel_deadline is null or pg_catalog.now() < contract.cancel_deadline)
      then 'The customer can still cancel this contract. Payments wait until their right to cancel ends.'
    else null
  end
  from public.contracts as contract
  where contract.job_id = p_job_id
    and contract.kind = 'agreement'
    and contract.status in ('signed', 'cancelled')
  order by contract.signed_at desc nulls last
  limit 1;
$$;

revoke all on function private.job_cancellation_hold(uuid) from public, anon, authenticated;

create or replace function private.guard_cancellation_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hold text;
begin
  if tg_table_name = 'job_prepayments' and new.method in ('card', 'ach') then
    return new;
  end if;
  hold := private.job_cancellation_hold(new.job_id);
  if hold is not null then
    raise exception '%', hold using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_cancellation_hold() from public, anon, authenticated;

drop trigger if exists guard_cancellation_hold on public.job_prepayments;
create trigger guard_cancellation_hold
  before insert on public.job_prepayments
  for each row execute function private.guard_cancellation_hold();

drop trigger if exists guard_cancellation_hold on public.job_prepayment_checkouts;
create trigger guard_cancellation_hold
  before insert on public.job_prepayment_checkouts
  for each row execute function private.guard_cancellation_hold();

-- The public contract read: the facts the customer's page needs for the
-- right to cancel.
drop function if exists public.get_public_contract(uuid);
create function public.get_public_contract(p_token uuid)
returns table(contract_id uuid, organization_id uuid, business_name text, business_phone text, body text, unfilled text[], status text,
  signature_provider text, created_at timestamptz, signed_at timestamptz, signature_name text, customer_name text, job_number bigint,
  time_zone text, superseded boolean, legal_notices jsonb, cancel_deadline timestamptz, cancelled_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  return query
  select
    contract.id,
    contract.organization_id,
    organization.name,
    coalesce(organization.phone, ''),
    contract.body,
    contract.unfilled,
    contract.status,
    contract.signature_provider,
    contract.created_at,
    contract.signed_at,
    contract.signature_name,
    pg_catalog.btrim(pg_catalog.concat_ws(' ', customer.first_name, customer.last_name)),
    job.job_number,
    coalesce(organization.timezone, 'America/Los_Angeles'),
    -- Whether a newer contract has been drafted for the same job. Only the
    -- newest can be signed.
    exists (
      select 1
      from public.contracts as newer
      where newer.job_id = contract.job_id
        and newer.id <> contract.id
        and newer.status <> 'void'
        and newer.created_at > contract.created_at
    ),
    contract.legal_notices,
    contract.cancel_deadline,
    contract.cancelled_at
  from public.contracts as contract
  join public.organizations as organization
    on organization.id = contract.organization_id
  left join public.jobs as job on job.id = contract.job_id
  left join public.customers as customer on customer.id = job.customer_id
  where contract.public_token = p_token
    and organization.archived_at is null
    and contract.status <> 'void'
  limit 1;
end;
$function$;

revoke all on function public.get_public_contract(uuid) from public;
grant execute on function public.get_public_contract(uuid) to anon, authenticated;

-- Each progress payment says what work it pays for (B&P 7159(d)(9)(B)).
alter table public.job_payment_plan_items add column if not exists phase text;
comment on column public.job_payment_plan_items.phase is
  'The phase of work, and the materials or equipment, this progress payment is for (B&P 7159(d)(9)(B)).';
