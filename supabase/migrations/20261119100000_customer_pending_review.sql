-- New contacts wait for the owner before they become customers.
--
-- Every unknown number that called or texted the business became a customer
-- straight away: "Caller 0142", "Text 7731". Spam calls, robotexts and wrong
-- numbers filled the Customers list and the New job picker with people the
-- business has never worked for.
--
-- A contact that arrives on its own (a call, a text, the phone assistant)
-- is now saved with pending_review = true. It still gets a conversation, so
-- the owner can read what they said and reply, but it stays out of the
-- Customers list and the pickers until the owner taps Keep, or Delete
-- (which archives it). Booking a job for them keeps them too: a job is the
-- owner's answer.
--
-- Contacts the owner adds from the app are never pending.

alter table public.customers
  add column if not exists pending_review boolean not null default false;

create index if not exists customers_pending_review_idx
  on public.customers (organization_id)
  where pending_review and archived_at is null;

-- The same function as before, with two changes:
--   * a contact created with no signed-in person (calls, texts, the phone
--     assistant) is pending; one created from the app is not;
--   * a signed-in member who picks an existing pending contact (the New job
--     form) keeps them.
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
set search_path = ''
as $$
declare
  digits text;
  found_id uuid;
  signed_in boolean := (select auth.uid()) is not null;
begin
  if signed_in
    and not (select private.is_org_member(p_organization_id)) then
    raise exception using errcode = '42501', message = 'Not a member of this business.';
  end if;

  digits := pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');

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
      if signed_in then
        update public.customers set pending_review = false
        where id = found_id and pending_review;
      end if;
      return found_id;
    end if;
  end if;

  insert into public.customers (
    organization_id, customer_type, first_name, last_name, phone, preferred_contact, notes, pending_review
  ) values (
    p_organization_id, 'residential',
    coalesce(nullif(pg_catalog.btrim(coalesce(p_first_name, '')), ''), 'Caller'),
    nullif(pg_catalog.btrim(coalesce(p_last_name, '')), ''),
    p_phone,
    case when p_preferred_contact = 'phone' then 'phone' else 'sms' end,
    p_notes,
    not signed_in
  )
  on conflict (
    organization_id,
    pg_catalog.right(pg_catalog.regexp_replace(phone, '[^0-9]', '', 'g'), 10)
  )
  where archived_at is null
    and pg_catalog.length(pg_catalog.regexp_replace(phone, '[^0-9]', '', 'g')) >= 10
  do nothing
  returning id into found_id;

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
$$;

-- A job booked for a pending contact keeps them, however the job was made.
-- Only the job's own customer, in the job's own business.
create or replace function public.jobs_keep_pending_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.customer_id is not null then
    update public.customers
       set pending_review = false
     where id = new.customer_id
       and organization_id = new.organization_id
       and pending_review;
  end if;
  return new;
end;
$$;

revoke execute on function public.jobs_keep_pending_customer() from public, anon, authenticated;

create or replace trigger jobs_keep_pending_customer
  after insert on public.jobs
  for each row
  execute function public.jobs_keep_pending_customer();
