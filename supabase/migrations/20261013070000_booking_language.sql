-- The language a booking was made in.
--
-- A customer who booked by text in Spanish was sent an English confirmation
-- page, and would have been sent English receipts. The customer's record can't
-- answer this on its own: it changes later (the owner can pin it), and a
-- confirmation is a record of the conversation that actually happened.
--
-- Adds only. Nothing is dropped or rewritten.

alter table public.booking_requests
  add column if not exists language text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.booking_requests'::regclass
      and conname = 'booking_requests_language_check'
  ) then
    alter table public.booking_requests
      add constraint booking_requests_language_check
      check (language is null or language in ('en', 'es'));
  end if;
end
$$;

comment on column public.booking_requests.language is
  'The language the customer booked in (en or es). Their confirmation page, texts and emails are written in it. Null for bookings made before it was recorded.';

-- What the confirmation page needs beside get_phone_booking_confirmation: the
-- language to show it in, how the booking was made (a call or a text), and the
-- customer's name for a request that has none of its own. Reached by the same
-- unguessable token and limited the same way.
create or replace function public.get_booking_confirmation_locale(p_token uuid)
returns table (
  language text,
  channel text,
  customer_name text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    coalesce(request.language, customer.preferred_language, 'en'),
    coalesce(request.communication_channel, request.source),
    nullif(trim(concat_ws(' ', nullif(customer.first_name, 'Text'), customer.last_name)), '')
  from public.booking_requests as request
  join public.organizations as organization
    on organization.id = request.organization_id
  left join public.customers as customer
    on customer.id = request.customer_id
  where request.public_token = p_token
    and request.intent = 'visit'
    and organization.archived_at is null
  limit 1;
$function$;

revoke all on function public.get_booking_confirmation_locale(uuid) from public;
grant execute on function public.get_booking_confirmation_locale(uuid) to anon, authenticated;
