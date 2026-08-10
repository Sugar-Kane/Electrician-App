-- Telling the customer, after a booking taken over the phone.
--
-- A caller who books by voice currently hears "you're booked" and then gets
-- nothing. Nothing to check the window against, nothing with the address in it,
-- nothing to show they were not imagining it. The web booking form has had a
-- confirmation page since it was built; the phone had no equivalent because it
-- had no way to name one booking to a stranger.
--
-- `public_token` is that name: a random, unguessable handle for one booking,
-- safe to put in a text message. It is deliberately not the row id — a booking
-- id appears in the app, in logs, and in exports, and none of those should
-- double as a credential.

alter table public.sms_booking_requests
  add column if not exists public_token uuid not null default gen_random_uuid();

-- Where to send an email confirmation, when the caller gave one. Nullable: most
-- callers will not, and a booking must never depend on it.
alter table public.sms_booking_requests
  add column if not exists email text;

-- So a retry, or a second tool call for the same booking, cannot text somebody
-- twice about the same appointment.
alter table public.sms_booking_requests
  add column if not exists confirmed_notified_at timestamptz;

create unique index if not exists sms_booking_requests_public_token_idx
  on public.sms_booking_requests(public_token);

/**
 * One booking, as much of it as the person who booked it may see.
 *
 * Security definer because the caller is anonymous — they hold a token, not a
 * session. It returns only what that person already knows (they said the
 * address out loud) plus what the business wants them to have: the window, the
 * fee, and a number to call. No customer id, no job id, no internal status, and
 * nothing about any other booking.
 */
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
  status text
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
    request.status
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
