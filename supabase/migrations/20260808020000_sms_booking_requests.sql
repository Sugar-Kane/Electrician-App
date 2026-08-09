-- Bookings that arrive as a text message.
--
-- The web booking form writes to public.booking_intakes, which requires a full
-- billing-quality record: email, street, city, state, ZIP. A customer texting
-- "no power in the kitchen, 123 Maple St" cannot supply that, and inventing a
-- placeholder email would poison the customer matching that
-- confirm_public_booking_payment does on exactly that column.
--
-- So a text lands here instead: what a text can honestly carry, plus the model
-- decision that produced it, kept for review. Nothing here is a job until
-- someone in the business schedules it, or the customer accepts an arrival
-- window that the scheduler itself offered.

create table if not exists public.sms_booking_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'new'
    check (status in ('new', 'scheduled', 'dismissed')),
  intent text not null
    check (intent in ('callback', 'visit', 'emergency')),
  phone text not null check (char_length(phone) between 7 and 30),
  contact_name text,
  description text not null check (char_length(description) between 1 and 2000),
  address_line_1 text,
  city text,
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  arrival_window_start timestamptz,
  arrival_window_end timestamptz,
  urgency text not null default 'routine'
    check (urgency in ('routine', 'urgent')),
  safety_flags text[] not null default '{}',
  -- What the model was asked and what it answered, so a bad booking can be
  -- traced back to the text that caused it.
  model text,
  model_decision jsonb not null default '{}'::jsonb
    check (jsonb_typeof(model_decision) = 'object'),
  created_job_id uuid references public.jobs(id) on delete set null,
  handled_by uuid references auth.users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (arrival_window_start is null and arrival_window_end is null)
    or (arrival_window_start is not null and arrival_window_end > arrival_window_start)
  )
);

create index if not exists sms_booking_requests_org_status_created_idx
  on public.sms_booking_requests(organization_id, status, created_at desc);
create index if not exists sms_booking_requests_conversation_idx
  on public.sms_booking_requests(conversation_id);
create index if not exists sms_booking_requests_customer_idx
  on public.sms_booking_requests(customer_id);
create index if not exists sms_booking_requests_created_job_idx
  on public.sms_booking_requests(created_job_id);

drop trigger if exists set_sms_booking_requests_updated_at on public.sms_booking_requests;
create trigger set_sms_booking_requests_updated_at
before update on public.sms_booking_requests
for each row execute function public.set_updated_at();

alter table public.sms_booking_requests enable row level security;

drop policy if exists "Organization members can view sms booking requests" on public.sms_booking_requests;
create policy "Organization members can view sms booking requests"
on public.sms_booking_requests for select
to authenticated
using ((select private.is_org_member(organization_id)));

drop policy if exists "Organization members can update sms booking requests" on public.sms_booking_requests;
create policy "Organization members can update sms booking requests"
on public.sms_booking_requests for update
to authenticated
using ((select private.is_org_member(organization_id)))
with check ((select private.is_org_member(organization_id)));

-- Rows are written by the inbound webhook through the service role, never by a
-- browser. anon must not see a queue of customers' addresses and phone numbers.
revoke all on table public.sms_booking_requests from public, anon;
grant select, update on table public.sms_booking_requests to authenticated;

-- Turn a request into a real job.
--
-- Matches an existing customer on the last ten digits of the phone number
-- rather than on string equality, because a number typed by staff and a number
-- delivered by Twilio rarely match byte for byte.
create or replace function public.schedule_sms_booking_request(
  p_request_id uuid,
  p_arrival_window_start timestamptz default null,
  p_arrival_window_end timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.sms_booking_requests%rowtype;
  settings public.service_settings%rowtype;
  matched_customer_id uuid;
  business_state text;
  target_property_id uuid;
  new_job_id uuid;
  window_start timestamptz;
  window_end timestamptz;
  digits text;
begin
  select * into request
  from public.sms_booking_requests
  where id = p_request_id
  for update;

  if request.id is null then
    raise exception using errcode = 'P0002', message = 'Booking request not found.';
  end if;

  -- Membership is enforced for a signed-in caller. The inbound SMS webhook runs
  -- with the service role and no JWT, so there is no user to check — it is
  -- trusted because only server code holds that key, and it books nothing the
  -- scheduler did not offer and the customer did not accept.
  if (select auth.uid()) is not null
    and not (select private.is_org_member(request.organization_id)) then
    raise exception using errcode = '42501', message = 'Not a member of this business.';
  end if;

  if request.status = 'scheduled' and request.created_job_id is not null then
    return request.created_job_id;
  end if;

  window_start := coalesce(p_arrival_window_start, request.arrival_window_start);
  window_end := coalesce(p_arrival_window_end, request.arrival_window_end);

  if window_start is not null and (window_end is null or window_end <= window_start) then
    raise exception using errcode = '22023', message = 'The arrival window ends before it starts.';
  end if;

  select * into settings
  from public.service_settings
  where organization_id = request.organization_id;

  -- A texted address rarely includes the state. The business's own base state
  -- is a far better guess than a hardcoded one, and properties.state is not
  -- nullable.
  select pg_catalog.upper(pg_catalog.substr(coalesce(organization.base_state, 'CA'), 1, 2))
  into business_state
  from public.organizations as organization
  where organization.id = request.organization_id;

  digits := pg_catalog.regexp_replace(request.phone, '[^0-9]', '', 'g');

  matched_customer_id := request.customer_id;
  if matched_customer_id is null then
    select customer.id into matched_customer_id
    from public.customers as customer
    where customer.organization_id = request.organization_id
      and customer.archived_at is null
      and pg_catalog.right(pg_catalog.regexp_replace(coalesce(customer.phone, ''), '[^0-9]', '', 'g'), 10)
        = pg_catalog.right(digits, 10)
      and pg_catalog.length(digits) >= 10
    order by customer.created_at
    limit 1;
  end if;

  if matched_customer_id is null then
    insert into public.customers (
      organization_id, customer_type, first_name, last_name, phone, preferred_contact, notes
    ) values (
      request.organization_id,
      'residential',
      coalesce(nullif(pg_catalog.split_part(coalesce(request.contact_name, ''), ' ', 1), ''), 'Text'),
      nullif(
        nullif(
          pg_catalog.substr(
            coalesce(request.contact_name, ''),
            pg_catalog.strpos(coalesce(request.contact_name, ''), ' ') + 1
          ),
          coalesce(request.contact_name, '')
        ),
        ''
      ),
      request.phone,
      'sms',
      'Created from an inbound text message.'
    ) returning id into matched_customer_id;
  end if;

  -- A property is only created when the customer actually gave an address; a
  -- callback request legitimately has none.
  if request.address_line_1 is not null and request.city is not null then
    select property.id into target_property_id
    from public.properties as property
    where property.organization_id = request.organization_id
      and property.customer_id = matched_customer_id
      and property.archived_at is null
      and pg_catalog.lower(property.address_line_1) = pg_catalog.lower(request.address_line_1)
    limit 1;

    if target_property_id is null then
      insert into public.properties (
        organization_id, customer_id, address_line_1, city, state, postal_code, safety_notes
      ) values (
        request.organization_id, matched_customer_id, request.address_line_1, request.city,
        coalesce(request.state, business_state, 'CA'),
        coalesce(request.postal_code, '00000'),
        nullif(pg_catalog.array_to_string(request.safety_flags, ', '), '')
      ) returning id into target_property_id;
    end if;
  end if;

  insert into public.jobs (
    organization_id, customer_id, property_id, status, category, priority,
    customer_description, safety_flags, scheduled_start, scheduled_end,
    arrival_window_start, arrival_window_end, diagnostic_fee_cents, diagnostic_paid
  ) values (
    request.organization_id, matched_customer_id, target_property_id,
    case when window_start is null then 'needs_review' else 'confirmed' end,
    'diagnostic',
    case when request.urgency = 'urgent' then 'emergency' else 'standard' end,
    request.description, request.safety_flags,
    window_start,
    case
      when window_start is null then null
      else window_start + pg_catalog.make_interval(mins => coalesce(settings.diagnostic_minutes, 60))
    end,
    window_start, window_end,
    coalesce(settings.diagnostic_fee_cents, 0),
    false
  ) returning id into new_job_id;

  update public.sms_booking_requests
  set status = 'scheduled',
      customer_id = matched_customer_id,
      created_job_id = new_job_id,
      arrival_window_start = window_start,
      arrival_window_end = window_end,
      handled_by = (select auth.uid()),
      handled_at = now()
  where id = request.id;

  -- Keep the text thread attached to the job it produced, so the conversation
  -- and the work are one record from the schedule onwards.
  if request.conversation_id is not null then
    update public.conversations
    set job_id = new_job_id
    where id = request.conversation_id
      and job_id is null;
  end if;

  insert into public.activity_events (
    organization_id, event_type, label, entity_type, entity_id, metadata
  ) values (
    request.organization_id, 'booking.scheduled_from_text',
    'Text message booking scheduled', 'job', new_job_id,
    jsonb_build_object('sms_booking_request_id', request.id, 'intent', request.intent)
  );

  return new_job_id;
end;
$$;

revoke all on function public.schedule_sms_booking_request(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.schedule_sms_booking_request(uuid, timestamptz, timestamptz)
  to authenticated;
