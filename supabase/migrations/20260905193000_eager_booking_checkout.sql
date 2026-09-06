-- A voice/text booking now creates Stripe Checkout before sending its link.
-- Reopening that link must retrieve the same session, not create another or
-- extend the slot hold. The attach function therefore treats attaching the
-- same session twice as success, and the intent reader returns that session ID.

create or replace function public.attach_public_booking_checkout(
  p_booking_token uuid,
  p_checkout_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  updated_count integer;
begin
  if p_checkout_session_id !~ '^cs_(test_|live_)[A-Za-z0-9]+' then
    return false;
  end if;

  update public.booking_requests
  set deposit_checkout_session_id = p_checkout_session_id
  where public_token = p_booking_token
    and status = 'awaiting_payment'
    and expires_at > pg_catalog.now()
    and (
      deposit_checkout_session_id is null
      or deposit_checkout_session_id = p_checkout_session_id
    );

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$function$;

drop function if exists public.get_booking_payment_intent(uuid);

create function public.get_booking_payment_intent(p_booking_token uuid)
returns table (
  organization_id uuid,
  organization_slug text,
  business_name text,
  status text,
  fee_cents integer,
  email text,
  diagnostic_minutes integer,
  priority text,
  already_paid boolean,
  checkout_session_id text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    request.organization_id,
    organization.slug,
    organization.name,
    request.status,
    coalesce(request.deposit_cents, 0),
    request.email,
    coalesce(settings.diagnostic_minutes, 120),
    coalesce(request.priority, 'standard'),
    request.deposit_paid_at is not null or request.created_job_id is not null,
    request.deposit_checkout_session_id,
    request.expires_at
  from public.booking_requests as request
  join public.organizations as organization
    on organization.id = request.organization_id
  left join public.service_settings as settings
    on settings.organization_id = request.organization_id
  where request.public_token = p_booking_token
  limit 1;
$function$;

revoke all on function public.attach_public_booking_checkout(uuid, text) from public;
grant execute on function public.attach_public_booking_checkout(uuid, text) to anon, authenticated;

revoke all on function public.get_booking_payment_intent(uuid) from public;
grant execute on function public.get_booking_payment_intent(uuid) to anon, authenticated;

-- Older rows can have a hold without a Checkout session. A customer opening
-- one after its deadline should release its stale queue state without needing
-- to invent a Stripe session ID.
create or replace function public.expire_public_booking_hold(p_booking_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  updated_count integer;
begin
  update public.booking_requests
  set status = 'expired'
  where public_token = p_booking_token
    and status = 'awaiting_payment'
    and expires_at <= pg_catalog.now()
    and deposit_paid_at is null
    and created_job_id is null;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$function$;

revoke all on function public.expire_public_booking_hold(uuid) from public;
grant execute on function public.expire_public_booking_hold(uuid) to anon, authenticated;

-- The customer page also needs the deadline so it never claims an elapsed
-- slot is still being held while a background cleanup has not run yet.
drop function if exists public.get_phone_booking_confirmation(uuid);

create function public.get_phone_booking_confirmation(p_token uuid)
returns table (
  business_name text,
  business_phone text,
  contact_name text,
  description text,
  address_line_1 text,
  city text,
  postal_code text,
  arrival_window_start timestamptz,
  arrival_window_end timestamptz,
  diagnostic_fee_cents integer,
  time_zone text,
  status text,
  intake_answers jsonb,
  deposit_cents integer,
  deposit_paid boolean,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    organization.name,
    organization.phone,
    request.contact_name,
    request.description,
    request.address_line_1,
    request.city,
    request.postal_code,
    request.arrival_window_start,
    request.arrival_window_end,
    coalesce(settings.diagnostic_fee_cents, 18000),
    coalesce(organization.timezone, 'America/Los_Angeles'),
    request.status,
    request.intake_answers,
    coalesce(request.deposit_cents, settings.diagnostic_fee_cents, 18000),
    request.deposit_paid_at is not null,
    request.expires_at
  from public.booking_requests as request
  join public.organizations as organization
    on organization.id = request.organization_id
  left join public.service_settings as settings
    on settings.organization_id = request.organization_id
  where request.public_token = p_token
    and request.intent = 'visit'
    and organization.archived_at is null
  limit 1;
$function$;

revoke all on function public.get_phone_booking_confirmation(uuid) from public;
grant execute on function public.get_phone_booking_confirmation(uuid) to anon, authenticated;
