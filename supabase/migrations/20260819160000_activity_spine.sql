-- ---------------------------------------------------------------------------
-- The spine: what the customer agreed to, and what has happened since.
--
-- Two gaps, both of which stop the app answering a question somebody asks.
--
-- 1. Nothing records that the customer was told the diagnostic fee and said
--    yes. `deposit_cents` freezes what they were quoted and `deposit_paid_at`
--    records that money arrived, but the agreement in between — the thing that
--    makes charging them fair — was never written down. A booking taken by
--    phone is exactly where that matters: there is no checkout page standing in
--    for consent.
--
-- 2. `activity_events` has the right shape and three rows in it. It is meant to
--    be the authoritative history of a customer, and nothing can read it that
--    way, because an event knows which job it belongs to and not which customer
--    — and a customer's history spans inquiries, payments and jobs.
-- ---------------------------------------------------------------------------

-- The fee, agreed rather than merely quoted -----------------------------------

alter table public.booking_requests
  add column if not exists fee_accepted_at timestamptz,
  add column if not exists fee_accepted_via text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'booking_requests_fee_accepted_via_check'
  ) then
    alter table public.booking_requests
      add constraint booking_requests_fee_accepted_via_check
      check (fee_accepted_via is null or fee_accepted_via in ('web', 'sms', 'voice'));
  end if;
end $$;

comment on column public.booking_requests.fee_accepted_at is
  'When the customer was told the diagnostic fee and agreed to it. Null means nobody has said yes yet, which is not the same as unpaid.';
comment on column public.booking_requests.fee_accepted_via is
  'Where that agreement was given: web, sms or voice.';

-- A history that belongs to a customer ---------------------------------------

alter table public.activity_events
  add column if not exists customer_id uuid references public.customers(id) on delete cascade,
  add column if not exists booking_request_id uuid references public.booking_requests(id) on delete set null,
  add column if not exists job_id uuid references public.jobs(id) on delete set null;

-- The two questions this table gets asked: what has happened for this customer,
-- and what has happened on this job. Both are read newest first, which is the
-- order the index has to be in to be used.
create index if not exists activity_events_customer_idx
  on public.activity_events(organization_id, customer_id, created_at desc)
  where customer_id is not null;

create index if not exists activity_events_job_idx
  on public.activity_events(organization_id, job_id, created_at desc)
  where job_id is not null;

/*
 * Append-only from here.
 *
 * A timeline the business can quietly edit is not a record of what happened,
 * and every reason to keep one — what did we tell them, when did they agree,
 * when did we say it was fixed — depends on nobody being able to change it
 * afterwards. Nothing in the app has ever updated or deleted a row here, so
 * this removes a capability nobody was using rather than one anybody relies on.
 */
drop policy if exists "Organization members can update activity_events" on public.activity_events;
drop policy if exists "Organization members can delete activity_events" on public.activity_events;

/*
 * Fill the new columns in, wherever the writer did not.
 *
 * A trigger rather than an edit to the two functions that already write events.
 * Those functions are long and live, the change is three columns, and rewriting
 * them from a migration to add three columns is how a function quietly loses
 * whatever else was done to it. This also catches every future writer — the
 * booking paths, the job workflow, the invoice send — without each of them
 * having to remember, which is exactly the kind of thing each of them would
 * eventually forget.
 */
create or replace function private.link_activity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  candidate text;
begin
  -- An event about a job already names it, in the columns that existed before
  -- this one did.
  if new.job_id is null and new.entity_type = 'job' and new.entity_id is not null then
    new.job_id := new.entity_id;
  end if;

  if new.entity_type = 'customer' and new.customer_id is null and new.entity_id is not null then
    new.customer_id := new.entity_id;
  end if;

  -- Both booking writers put the request id in the metadata, under two
  -- different names, because they were written a month apart.
  if new.booking_request_id is null then
    candidate := coalesce(
      new.metadata ->> 'booking_request_id',
      new.metadata ->> 'sms_booking_request_id'
    );
    if candidate ~ '^[0-9a-fA-F-]{36}$' then
      new.booking_request_id := candidate::uuid;
    end if;
  end if;

  -- The customer is what the timeline is keyed on, so it is worth deriving from
  -- whichever of the two links is present.
  if new.customer_id is null and new.job_id is not null then
    select job.customer_id into new.customer_id
    from public.jobs as job
    where job.id = new.job_id;
  end if;

  if new.customer_id is null and new.booking_request_id is not null then
    select request.customer_id into new.customer_id
    from public.booking_requests as request
    where request.id = new.booking_request_id;
  end if;

  return new;
end;
$fn$;

drop trigger if exists link_activity_event on public.activity_events;
create trigger link_activity_event
  before insert on public.activity_events
  for each row execute function private.link_activity_event();

-- The rows that already exist ------------------------------------------------

update public.activity_events as event
set job_id = job.id,
    customer_id = job.customer_id
from public.jobs as job
where event.entity_type = 'job'
  and event.entity_id = job.id
  and event.job_id is null;

update public.activity_events as event
set booking_request_id = request.id
from public.booking_requests as request
where event.booking_request_id is null
  and coalesce(
        event.metadata ->> 'booking_request_id',
        event.metadata ->> 'sms_booking_request_id'
      ) = request.id::text;
