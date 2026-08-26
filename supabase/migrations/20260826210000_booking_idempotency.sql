-- One call must not be able to book thirteen times.
--
-- An inbound call on 2026-08-26 produced thirteen byte-identical `book_visit`
-- calls in 1.5 seconds, each on its own freshly-initialised MCP session. Every
-- one of them ran `findOrCreateCustomerByPhone` (read, then write, with no
-- constraint behind it) and `recordBookingRequest` (an unconditional insert).
-- All thirteen read "nothing there" and all thirteen wrote: thirteen customer
-- rows, thirteen bookings, thirteen texts to the owner.
--
-- An application-level check could not have stopped it. Thirteen concurrent
-- readers all read the same empty result before any of them wrote, so the
-- database has to be the one that says no.
--
-- Two indexes and one function. The indexes are the guarantee; the function is
-- how the customer path can use one, because a partial unique index can only
-- arbitrate `on conflict` when the statement carries a matching predicate, and
-- PostgREST cannot emit one.

-- One live customer per phone number, per business.
--
-- Matched on the last ten digits, which is how every lookup in this codebase
-- already compares numbers: `+1 (209) 626-9313` and `2096269313` are one
-- person. Numbers with fewer than ten digits are left outside the index
-- deliberately — `613432210` is what speech-to-text made of somebody's mobile,
-- and pretending nine digits identify a person would merge strangers.
create unique index if not exists customers_org_phone_digits_idx
  on public.customers (
    organization_id,
    pg_catalog.right(pg_catalog.regexp_replace(phone, '[^0-9]', '', 'g'), 10)
  )
  where archived_at is null
    and pg_catalog.length(pg_catalog.regexp_replace(phone, '[^0-9]', '', 'g')) >= 10;

-- One live booking per customer, per arrival window.
--
-- Restricted to the statuses that mean the appointment is still real, so a
-- customer who cancels and rebooks the same window is unaffected. Two live
-- bookings for one customer at one time is not a duplicate to be tolerated, it
-- is a double booking — this is a data-integrity rule that happens to also be
-- the retry guard.
create unique index if not exists booking_requests_one_live_slot_idx
  on public.booking_requests (
    organization_id, customer_id, arrival_window_start, arrival_window_end
  )
  where arrival_window_start is not null
    and status in ('new', 'needs_review', 'awaiting_payment', 'confirmed', 'scheduled');

/*
 * Find the customer on this number, or make one, in a single statement.
 *
 * Replaces a client-side scan that pulled up to 5000 customer rows into the
 * application and matched them in JavaScript — which was both the concurrency
 * hole above and a real part of the five seconds each `book_visit` took.
 *
 * `security definer` for the same reason `schedule_sms_booking_request` is: the
 * intake webhooks run with the service role and no JWT. A signed-in caller is
 * still checked for membership, so this cannot be used to read across
 * businesses from the browser.
 */
create or replace function public.find_or_create_customer_by_phone(
  p_organization_id uuid,
  p_phone text,
  p_first_name text,
  p_last_name text default null,
  p_preferred_contact text default 'sms',
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  digits text;
  found_id uuid;
begin
  if (select auth.uid()) is not null
    and not (select private.is_org_member(p_organization_id)) then
    raise exception using errcode = '42501', message = 'Not a member of this business.';
  end if;

  digits := pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');

  -- Below ten digits there is nothing to match on, so the caller gets a fresh
  -- row every time. That is the honest answer: the number is unusable, and the
  -- tool layer refuses to book on one.
  if pg_catalog.length(digits) >= 10 then
    select customer.id into found_id
    from public.customers as customer
    where customer.organization_id = p_organization_id
      and customer.archived_at is null
      and pg_catalog.right(
            pg_catalog.regexp_replace(coalesce(customer.phone, ''), '[^0-9]', '', 'g'), 10
          ) = pg_catalog.right(digits, 10)
    order by customer.created_at
    limit 1;

    if found_id is not null then
      return found_id;
    end if;
  end if;

  insert into public.customers (
    organization_id, customer_type, first_name, last_name, phone, preferred_contact, notes
  ) values (
    p_organization_id, 'residential',
    coalesce(nullif(pg_catalog.btrim(coalesce(p_first_name, '')), ''), 'Caller'),
    nullif(pg_catalog.btrim(coalesce(p_last_name, '')), ''),
    p_phone,
    case when p_preferred_contact = 'phone' then 'phone' else 'sms' end,
    p_notes
  )
  on conflict (
    organization_id,
    pg_catalog.right(pg_catalog.regexp_replace(phone, '[^0-9]', '', 'g'), 10)
  )
  where archived_at is null
    and pg_catalog.length(pg_catalog.regexp_replace(phone, '[^0-9]', '', 'g')) >= 10
  do nothing
  returning id into found_id;

  -- The insert lost the race. Whoever won holds the row this caller wanted.
  if found_id is null then
    select customer.id into found_id
    from public.customers as customer
    where customer.organization_id = p_organization_id
      and customer.archived_at is null
      and pg_catalog.right(
            pg_catalog.regexp_replace(coalesce(customer.phone, ''), '[^0-9]', '', 'g'), 10
          ) = pg_catalog.right(digits, 10)
    order by customer.created_at
    limit 1;
  end if;

  return found_id;
end;
$function$;

revoke all on function public.find_or_create_customer_by_phone(uuid, text, text, text, text, text) from public;
grant execute on function public.find_or_create_customer_by_phone(uuid, text, text, text, text, text)
  to authenticated, service_role;
