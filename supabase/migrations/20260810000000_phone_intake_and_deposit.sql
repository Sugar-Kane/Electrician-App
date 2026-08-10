-- What was asked on the call, and what is owed to hold the appointment.
--
-- The voice agent was booking on two sentences: "my washer is out" and an
-- address. No electrician takes a job that way — they ask whether it is the
-- whole house or one circuit, whether a breaker tripped, how to get in. Those
-- answers decide what goes on the van, and losing them means the first thing
-- the electrician does on site is ask questions that could have been answered
-- on the phone.
--
-- They are stored as asked, question and answer together, rather than parsed
-- into columns. The list will change as the business learns what matters, and a
-- question nobody can answer later is worse than a shape that is slightly loose.

alter table public.sms_booking_requests
  add column if not exists intake_answers jsonb not null default '[]'::jsonb;

alter table public.sms_booking_requests
  drop constraint if exists sms_booking_requests_intake_answers_check;
alter table public.sms_booking_requests
  add constraint sms_booking_requests_intake_answers_check
  check (jsonb_typeof(intake_answers) = 'array');

-- Where the customer asked for their booking link. 'both' is a real answer, not
-- indecision: a text arrives now and an email survives a reformatted phone.
alter table public.sms_booking_requests
  add column if not exists delivery_preference text
  check (delivery_preference is null or delivery_preference in ('text', 'email', 'both'));

-- What the customer was told the deposit was, at the moment they agreed to it.
-- Recorded rather than read from settings later, because a fee that changes next
-- month must not silently change what somebody already agreed to on a call.
alter table public.sms_booking_requests
  add column if not exists deposit_cents integer;

alter table public.sms_booking_requests
  add column if not exists deposit_checkout_session_id text;
alter table public.sms_booking_requests
  add column if not exists deposit_paid_at timestamptz;

create index if not exists sms_booking_requests_deposit_session_idx
  on public.sms_booking_requests(deposit_checkout_session_id)
  where deposit_checkout_session_id is not null;

-- The confirmation page grows the two things the caller now expects to see:
-- what they were asked, and what they owe.
create or replace function public.get_phone_booking_confirmation(p_token uuid)
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
  deposit_paid boolean
)
language sql
stable
security definer
set search_path = ''
as $$
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
    coalesce(settings.diagnostic_fee_cents, 10000),
    coalesce(organization.timezone, 'America/Los_Angeles'),
    request.status,
    request.intake_answers,
    coalesce(request.deposit_cents, settings.diagnostic_fee_cents, 10000),
    request.deposit_paid_at is not null
  from public.sms_booking_requests as request
  join public.organizations as organization
    on organization.id = request.organization_id
  left join public.service_settings as settings
    on settings.organization_id = request.organization_id
  where request.public_token = p_token
    and request.intent = 'visit'
    and organization.archived_at is null
  limit 1;
$$;

revoke all on function public.get_phone_booking_confirmation(uuid) from public;
grant execute on function public.get_phone_booking_confirmation(uuid) to anon, authenticated;

/**
 * Mark a phone booking's deposit as paid.
 *
 * Called after Stripe has confirmed the session, so it takes the session id it
 * was paid under and refuses to move a booking that was never sent to that
 * session. Anonymous callers reach this through a token they already hold; the
 * session id is the part they cannot invent.
 */
create or replace function public.mark_phone_deposit_paid(
  p_token uuid,
  p_checkout_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_id uuid;
begin
  update public.sms_booking_requests
  set deposit_paid_at = coalesce(deposit_paid_at, now())
  where public_token = p_token
    and deposit_checkout_session_id = p_checkout_session_id
  returning id into updated_id;

  return updated_id is not null;
end;
$$;

revoke all on function public.mark_phone_deposit_paid(uuid, text) from public;
grant execute on function public.mark_phone_deposit_paid(uuid, text) to anon, authenticated;
