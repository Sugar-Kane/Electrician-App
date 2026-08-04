create table public.booking_intakes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  public_token uuid not null unique default gen_random_uuid(),
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment', 'confirmed', 'needs_review', 'safety_escalated', 'expired', 'canceled')),
  customer_type text not null default 'residential'
    check (customer_type in ('residential', 'commercial')),
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null check (char_length(last_name) between 1 and 80),
  email text not null check (char_length(email) between 5 and 254),
  phone text not null check (char_length(phone) between 7 and 30),
  address_line_1 text not null check (char_length(address_line_1) between 3 and 160),
  address_line_2 text,
  city text not null check (char_length(city) between 2 and 80),
  state text not null check (state ~ '^[A-Z]{2}$'),
  postal_code text not null check (postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  access_notes text,
  transactional_contact_consent boolean not null default false,
  consented_at timestamptz,
  customer_description text not null check (char_length(customer_description) between 10 and 2000),
  category text not null default 'diagnostic',
  safety_answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(safety_answers) = 'object'),
  safety_flags text[] not null default '{}',
  safety_outcome text not null default 'standard'
    check (safety_outcome in ('standard', 'urgent_review', 'emergency_services', 'utility_referral')),
  priority text not null default 'standard'
    check (priority in ('standard', 'emergency', 'after_hours')),
  service_area_status text not null default 'unverified'
    check (service_area_status in ('inside', 'outside', 'unverified')),
  service_distance_miles numeric(8, 2),
  arrival_window_start timestamptz,
  arrival_window_end timestamptz,
  diagnostic_fee_cents integer not null default 10000 check (diagnostic_fee_cents >= 0),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  converted_customer_id uuid references public.customers(id) on delete set null,
  converted_property_id uuid references public.properties(id) on delete set null,
  converted_job_id uuid references public.jobs(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (arrival_window_start is null and arrival_window_end is null)
    or (arrival_window_start is not null and arrival_window_end > arrival_window_start)
  )
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  booking_intake_id uuid references public.booking_intakes(id) on delete set null,
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_checkout_session_id text not null unique,
  provider_payment_intent_id text,
  status text not null default 'succeeded'
    check (status in ('pending', 'succeeded', 'refunded', 'partially_refunded', 'failed')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index booking_intakes_org_status_created_idx
  on public.booking_intakes(organization_id, status, created_at desc);
create index booking_intakes_org_window_idx
  on public.booking_intakes(organization_id, arrival_window_start, arrival_window_end)
  where status = 'awaiting_payment';
create index booking_intakes_expires_idx
  on public.booking_intakes(expires_at)
  where status = 'awaiting_payment';
create index payments_org_created_idx
  on public.payments(organization_id, created_at desc);
create index payments_job_id_idx on public.payments(job_id);
create index payments_booking_intake_id_idx on public.payments(booking_intake_id);

create trigger set_booking_intakes_updated_at
before update on public.booking_intakes
for each row execute function public.set_updated_at();

create trigger set_payments_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

alter table public.booking_intakes enable row level security;
alter table public.payments enable row level security;

create policy "Organization members can view booking intakes"
on public.booking_intakes for select
to authenticated
using ((select private.is_org_member(organization_id)));

create policy "Organization members can update booking intakes"
on public.booking_intakes for update
to authenticated
using ((select private.is_org_member(organization_id)))
with check ((select private.is_org_member(organization_id)));

create policy "Organization members can delete booking intakes"
on public.booking_intakes for delete
to authenticated
using ((select private.is_org_member(organization_id)));

create policy "Organization members can view payments"
on public.payments for select
to authenticated
using ((select private.is_org_member(organization_id)));

create policy "Organization members can update payments"
on public.payments for update
to authenticated
using ((select private.is_org_member(organization_id)))
with check ((select private.is_org_member(organization_id)));

revoke all on table public.booking_intakes from public, anon;
revoke all on table public.payments from public, anon;
grant select, update, delete on table public.booking_intakes to authenticated;
grant select, update on table public.payments to authenticated;

create or replace function public.get_public_booking_page(p_slug text)
returns table (
  organization_id uuid,
  slug text,
  display_name text,
  business_phone text,
  timezone text,
  base_city text,
  base_state text,
  base_postal_code text,
  automatic_booking_radius_miles integer,
  diagnostic_fee_cents integer,
  diagnostic_minutes integer,
  credit_diagnostic_to_repair boolean,
  emergency_fee_cents integer,
  after_hours_fee_cents integer,
  cancellation_fee_cents integer,
  free_reschedule_hours integer,
  business_hours jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    organization.id,
    organization.slug,
    organization.name,
    organization.phone,
    organization.timezone,
    organization.base_city,
    organization.base_state,
    organization.base_postal_code,
    settings.automatic_booking_radius_miles,
    settings.diagnostic_fee_cents,
    settings.diagnostic_minutes,
    settings.credit_diagnostic_to_repair,
    settings.emergency_fee_cents,
    settings.after_hours_fee_cents,
    settings.cancellation_fee_cents,
    settings.free_reschedule_hours,
    settings.business_hours
  from public.organizations as organization
  join public.service_settings as settings
    on settings.organization_id = organization.id
  where organization.slug = lower(btrim(p_slug))
    and organization.archived_at is null
    and organization.base_city is not null
    and organization.base_state is not null
    and organization.base_postal_code is not null
  limit 1;
$$;

create or replace function public.list_public_booking_slots(
  p_slug text,
  p_from_date date default current_date,
  p_days integer default 14
)
returns table (
  slot_start timestamptz,
  slot_end timestamptz,
  fee_cents integer,
  priority text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  organization_timezone text;
  organization_business_hours jsonb;
  standard_fee integer;
  day_value date;
  day_key text;
  day_config jsonb;
  business_start time;
  business_end time;
  local_window_start time;
  local_window_end time;
  candidate_start timestamptz;
  candidate_end timestamptz;
  available_technician_count integer;
  occupied_count integer;
begin
  if p_days not between 1 and 31
    or p_from_date < current_date
    or p_from_date > current_date + 31 then
    return;
  end if;

  select organization.id, organization.timezone, settings.business_hours,
    settings.diagnostic_fee_cents
  into target_organization_id, organization_timezone, organization_business_hours,
    standard_fee
  from public.organizations as organization
  join public.service_settings as settings
    on settings.organization_id = organization.id
  where organization.slug = lower(btrim(p_slug))
    and organization.archived_at is null
    and organization.base_postal_code is not null
  limit 1;

  if target_organization_id is null then
    return;
  end if;

  for day_value in
    select generated_day::date
    from pg_catalog.generate_series(
      p_from_date::timestamp,
      (p_from_date + (p_days - 1))::timestamp,
      interval '1 day'
    ) as generated_day
  loop
    day_key := lower(pg_catalog.to_char(day_value, 'FMDay'));
    day_config := organization_business_hours -> day_key;

    if day_config is null or coalesce((day_config ->> 'enabled')::boolean, false) is false then
      continue;
    end if;

    begin
      business_start := (day_config ->> 'start')::time;
      business_end := (day_config ->> 'end')::time;
    exception when others then
      continue;
    end;

    for local_window_start, local_window_end in
      select window_start, window_end
      from (values
        (time '08:00', time '10:00'),
        (time '10:00', time '12:00'),
        (time '13:00', time '15:00'),
        (time '15:00', time '17:00')
      ) as windows(window_start, window_end)
    loop
      if local_window_start < business_start or local_window_end > business_end then
        continue;
      end if;

      candidate_start := (day_value + local_window_start) at time zone organization_timezone;
      candidate_end := (day_value + local_window_end) at time zone organization_timezone;

      if candidate_start < now() + interval '2 hours' then
        continue;
      end if;

      select count(*)::integer
      into available_technician_count
      from public.technicians as technician
      where technician.organization_id = target_organization_id
        and technician.is_active
        and (
          technician.skills = '{}'::text[]
          or technician.skills && array['general_service', 'diagnostics']::text[]
        )
        and not exists (
          select 1
          from public.blackout_periods as blackout
          where blackout.technician_id = technician.id
            and blackout.block_type in ('hard', 'private')
            and blackout.starts_at < candidate_end
            and blackout.ends_at > candidate_start
        );

      if available_technician_count = 0 then
        continue;
      end if;

      select
        (
          select count(*)
          from public.jobs as job
          where job.organization_id = target_organization_id
            and job.archived_at is null
            and job.status in (
              'awaiting_payment', 'confirmed', 'needs_review', 'assigned',
              'en_route', 'arrived', 'in_progress', 'rescheduled'
            )
            and coalesce(job.arrival_window_start, job.scheduled_start) < candidate_end
            and coalesce(job.arrival_window_end, job.scheduled_end) > candidate_start
        )
        +
        (
          select count(*)
          from public.booking_intakes as intake
          where intake.organization_id = target_organization_id
            and intake.status = 'awaiting_payment'
            and intake.expires_at > now()
            and intake.arrival_window_start < candidate_end
            and intake.arrival_window_end > candidate_start
        )
      into occupied_count;

      if occupied_count < available_technician_count then
        slot_start := candidate_start;
        slot_end := candidate_end;
        fee_cents := standard_fee;
        priority := 'standard';
        return next;
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function public.create_public_booking_intake(
  p_slug text,
  p_booking_mode text,
  p_customer_type text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_address_line_1 text,
  p_address_line_2 text,
  p_city text,
  p_state text,
  p_postal_code text,
  p_access_notes text,
  p_transactional_contact_consent boolean,
  p_customer_description text,
  p_category text,
  p_safety_answers jsonb,
  p_safety_flags text[],
  p_safety_outcome text,
  p_priority text,
  p_service_area_status text,
  p_service_distance_miles numeric,
  p_arrival_window_start timestamptz,
  p_arrival_window_end timestamptz
)
returns table (
  intake_id uuid,
  booking_token uuid,
  intake_status text,
  fee_cents integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  organization_timezone text;
  standard_fee integer;
  urgent_fee integer;
  selected_fee integer;
  normalized_state text := upper(btrim(p_state));
  normalized_email text := lower(btrim(p_email));
  created_intake public.booking_intakes%rowtype;
begin
  if p_booking_mode not in ('paid_visit', 'callback') then
    raise exception using errcode = '22023', message = 'Choose a valid booking outcome.';
  end if;

  if p_customer_type not in ('residential', 'commercial')
    or char_length(btrim(p_first_name)) not between 1 and 80
    or char_length(btrim(p_last_name)) not between 1 and 80
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    or char_length(btrim(p_phone)) not between 7 and 30
    or char_length(btrim(p_address_line_1)) not between 3 and 160
    or char_length(btrim(p_city)) not between 2 and 80
    or normalized_state !~ '^[A-Z]{2}$'
    or btrim(p_postal_code) !~ '^[0-9]{5}(-[0-9]{4})?$'
    or p_transactional_contact_consent is distinct from true
    or char_length(btrim(p_customer_description)) not between 10 and 2000 then
    raise exception using errcode = '22023', message = 'Review the customer and service details.';
  end if;

  if jsonb_typeof(p_safety_answers) <> 'object'
    or cardinality(p_safety_flags) > 20
    or p_safety_outcome not in ('standard', 'urgent_review', 'emergency_services', 'utility_referral')
    or p_priority not in ('standard', 'emergency', 'after_hours')
    or p_service_area_status not in ('inside', 'outside', 'unverified') then
    raise exception using errcode = '22023', message = 'Review the safety screening.';
  end if;

  if p_safety_outcome in ('emergency_services', 'utility_referral')
    or p_safety_answers @> '{"active_fire_or_smoke":true}'::jsonb
    or p_safety_answers @> '{"shock_injury":true}'::jsonb
    or p_safety_answers @> '{"downed_power_line":true}'::jsonb
    or p_safety_answers @> '{"water_touching_electrical":true}'::jsonb then
    raise exception using errcode = '22023', message = 'Online booking is paused for this safety response.';
  end if;

  select organization.id, organization.timezone,
    settings.diagnostic_fee_cents, settings.emergency_fee_cents
  into target_organization_id, organization_timezone, standard_fee, urgent_fee
  from public.organizations as organization
  join public.service_settings as settings
    on settings.organization_id = organization.id
  where organization.slug = lower(btrim(p_slug))
    and organization.archived_at is null
  limit 1;

  if target_organization_id is null then
    raise exception using errcode = 'P0002', message = 'Booking page not found.';
  end if;

  if p_booking_mode = 'callback' or p_service_area_status <> 'inside' then
    insert into public.booking_intakes (
      organization_id, status, customer_type, first_name, last_name, email, phone,
      address_line_1, address_line_2, city, state, postal_code, access_notes,
      transactional_contact_consent, consented_at,
      customer_description, category, safety_answers, safety_flags, safety_outcome,
      priority, service_area_status, service_distance_miles, diagnostic_fee_cents
    ) values (
      target_organization_id, 'needs_review', p_customer_type, btrim(p_first_name),
      btrim(p_last_name), normalized_email, btrim(p_phone), btrim(p_address_line_1),
      nullif(btrim(p_address_line_2), ''), btrim(p_city), normalized_state,
      btrim(p_postal_code), nullif(btrim(p_access_notes), ''),
      p_transactional_contact_consent, now(),
      btrim(p_customer_description), left(btrim(p_category), 80), p_safety_answers,
      p_safety_flags, p_safety_outcome, p_priority, p_service_area_status,
      p_service_distance_miles, 0
    ) returning * into created_intake;

    insert into public.activity_events (
      organization_id, event_type, label, entity_type, entity_id, metadata
    ) values (
      target_organization_id, 'booking.review_requested',
      'Customer booking needs review', 'booking_intake', created_intake.id,
      jsonb_build_object('service_area_status', p_service_area_status)
    );
  else
    if p_arrival_window_start is null or p_arrival_window_end is null then
      raise exception using errcode = '22023', message = 'Choose an available arrival window.';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        target_organization_id::text || ':' || p_arrival_window_start::text,
        0
      )
    );

    if not exists (
      select 1
      from public.list_public_booking_slots(
        p_slug,
        (p_arrival_window_start at time zone organization_timezone)::date,
        1
      ) as available_slot
      where available_slot.slot_start = p_arrival_window_start
        and available_slot.slot_end = p_arrival_window_end
    ) then
      raise exception using errcode = '23P01', message = 'That arrival window is no longer available.';
    end if;

    selected_fee := case when p_priority = 'emergency' then urgent_fee else standard_fee end;

    insert into public.booking_intakes (
      organization_id, status, customer_type, first_name, last_name, email, phone,
      address_line_1, address_line_2, city, state, postal_code, access_notes,
      transactional_contact_consent, consented_at,
      customer_description, category, safety_answers, safety_flags, safety_outcome,
      priority, service_area_status, service_distance_miles, arrival_window_start,
      arrival_window_end, diagnostic_fee_cents
    ) values (
      target_organization_id, 'awaiting_payment', p_customer_type, btrim(p_first_name),
      btrim(p_last_name), normalized_email, btrim(p_phone), btrim(p_address_line_1),
      nullif(btrim(p_address_line_2), ''), btrim(p_city), normalized_state,
      btrim(p_postal_code), nullif(btrim(p_access_notes), ''),
      p_transactional_contact_consent, now(),
      btrim(p_customer_description), left(btrim(p_category), 80), p_safety_answers,
      p_safety_flags, p_safety_outcome, p_priority, p_service_area_status,
      p_service_distance_miles, p_arrival_window_start, p_arrival_window_end,
      selected_fee
    ) returning * into created_intake;
  end if;

  intake_id := created_intake.id;
  booking_token := created_intake.public_token;
  intake_status := created_intake.status;
  fee_cents := created_intake.diagnostic_fee_cents;
  return next;
end;
$$;

create or replace function public.attach_public_booking_checkout(
  p_booking_token uuid,
  p_checkout_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count integer;
begin
  if p_checkout_session_id !~ '^cs_(test_|live_)[A-Za-z0-9]+' then
    return false;
  end if;

  update public.booking_intakes
  set stripe_checkout_session_id = p_checkout_session_id
  where public_token = p_booking_token
    and status = 'awaiting_payment'
    and expires_at > now()
    and stripe_checkout_session_id is null;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function public.confirm_public_booking_payment(
  p_booking_token uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_amount_cents integer,
  p_currency text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  intake public.booking_intakes%rowtype;
  settings public.service_settings%rowtype;
  customer_id uuid;
  property_id uuid;
  job_id uuid;
begin
  select * into intake
  from public.booking_intakes
  where public_token = p_booking_token
    and stripe_checkout_session_id = p_checkout_session_id
  for update;

  if intake.id is null then
    raise exception using errcode = 'P0002', message = 'Booking payment record not found.';
  end if;

  if intake.status = 'confirmed' and intake.converted_job_id is not null then
    return intake.converted_job_id;
  end if;

  if intake.status <> 'awaiting_payment'
    or p_amount_cents <> intake.diagnostic_fee_cents
    or lower(p_currency) <> 'usd' then
    raise exception using errcode = '22023', message = 'Booking payment does not match the intake.';
  end if;

  select * into settings
  from public.service_settings
  where organization_id = intake.organization_id;

  select customer.id into customer_id
  from public.customers as customer
  where customer.organization_id = intake.organization_id
    and customer.archived_at is null
    and (
      lower(customer.email) = intake.email
      or pg_catalog.regexp_replace(coalesce(customer.phone, ''), '[^0-9]', '', 'g')
        = pg_catalog.regexp_replace(intake.phone, '[^0-9]', '', 'g')
    )
  order by customer.created_at
  limit 1;

  if customer_id is null then
    insert into public.customers (
      organization_id, customer_type, first_name, last_name, email, phone,
      preferred_contact, notes
    ) values (
      intake.organization_id, intake.customer_type, intake.first_name,
      intake.last_name, intake.email, intake.phone, 'sms',
      'Created from public diagnostic booking'
    ) returning id into customer_id;
  end if;

  select property.id into property_id
  from public.properties as property
  where property.organization_id = intake.organization_id
    and property.customer_id = customer_id
    and property.archived_at is null
    and lower(property.address_line_1) = lower(intake.address_line_1)
    and lower(property.city) = lower(intake.city)
    and property.state = intake.state
    and property.postal_code = intake.postal_code
  order by property.created_at
  limit 1;

  if property_id is null then
    insert into public.properties (
      organization_id, customer_id, address_line_1, address_line_2, city, state,
      postal_code, access_notes, safety_notes
    ) values (
      intake.organization_id, customer_id, intake.address_line_1,
      intake.address_line_2, intake.city, intake.state, intake.postal_code,
      intake.access_notes,
      nullif(array_to_string(intake.safety_flags, ', '), '')
    ) returning id into property_id;
  end if;

  insert into public.jobs (
    organization_id, customer_id, property_id, status, category, priority,
    customer_description, ai_summary, safety_flags, scheduled_start,
    scheduled_end, arrival_window_start, arrival_window_end, diagnostic_fee_cents,
    diagnostic_paid
  ) values (
    intake.organization_id, customer_id, property_id, 'confirmed', intake.category,
    intake.priority, intake.customer_description, intake.customer_description,
    intake.safety_flags, intake.arrival_window_start,
    intake.arrival_window_start + pg_catalog.make_interval(mins => settings.diagnostic_minutes),
    intake.arrival_window_start, intake.arrival_window_end,
    intake.diagnostic_fee_cents, true
  ) returning id into job_id;

  insert into public.payments (
    organization_id, job_id, booking_intake_id, provider_checkout_session_id,
    provider_payment_intent_id, status, amount_cents, currency, paid_at
  ) values (
    intake.organization_id, job_id, intake.id, p_checkout_session_id,
    nullif(p_payment_intent_id, ''), 'succeeded', p_amount_cents,
    lower(p_currency), now()
  ) on conflict (provider_checkout_session_id) do nothing;

  update public.booking_intakes
  set status = 'confirmed',
      stripe_payment_intent_id = nullif(p_payment_intent_id, ''),
      converted_customer_id = customer_id,
      converted_property_id = property_id,
      converted_job_id = job_id
  where id = intake.id;

  insert into public.activity_events (
    organization_id, event_type, label, entity_type, entity_id, metadata
  ) values (
    intake.organization_id, 'booking.payment_confirmed',
    'Paid diagnostic booking confirmed', 'job', job_id,
    jsonb_build_object('amount_cents', p_amount_cents, 'booking_intake_id', intake.id)
  );

  return job_id;
end;
$$;

create or replace function public.expire_public_booking_checkout(
  p_booking_token uuid,
  p_checkout_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count integer;
begin
  if p_checkout_session_id !~ '^cs_(test_|live_)[A-Za-z0-9]+' then
    return false;
  end if;

  update public.booking_intakes
  set status = 'expired'
  where public_token = p_booking_token
    and stripe_checkout_session_id = p_checkout_session_id
    and status = 'awaiting_payment';

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function public.get_public_booking_confirmation(
  p_booking_token uuid,
  p_checkout_session_id text
)
returns table (
  display_name text,
  customer_first_name text,
  job_number bigint,
  booking_status text,
  arrival_window_start timestamptz,
  arrival_window_end timestamptz,
  service_city text,
  service_state text,
  amount_paid_cents integer,
  timezone text,
  business_phone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    organization.name,
    intake.first_name,
    job.job_number,
    intake.status,
    intake.arrival_window_start,
    intake.arrival_window_end,
    intake.city,
    intake.state,
    intake.diagnostic_fee_cents,
    organization.timezone,
    organization.phone
  from public.booking_intakes as intake
  join public.organizations as organization
    on organization.id = intake.organization_id
  left join public.jobs as job
    on job.id = intake.converted_job_id
  where intake.public_token = p_booking_token
    and intake.stripe_checkout_session_id = p_checkout_session_id
    and intake.status = 'confirmed'
  limit 1;
$$;

revoke all on function public.get_public_booking_page(text) from public;
revoke all on function public.list_public_booking_slots(text, date, integer) from public;
revoke all on function public.create_public_booking_intake(
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  boolean, text, text, jsonb, text[], text, text, text, numeric, timestamptz, timestamptz
) from public;
revoke all on function public.attach_public_booking_checkout(uuid, text) from public;
revoke all on function public.confirm_public_booking_payment(uuid, text, text, integer, text) from public;
revoke all on function public.expire_public_booking_checkout(uuid, text) from public;
revoke all on function public.get_public_booking_confirmation(uuid, text) from public;

grant usage on schema public to anon, authenticated;
grant execute on function public.get_public_booking_page(text) to anon, authenticated;
grant execute on function public.list_public_booking_slots(text, date, integer) to anon, authenticated;
grant execute on function public.create_public_booking_intake(
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  boolean, text, text, jsonb, text[], text, text, text, numeric, timestamptz, timestamptz
) to anon, authenticated;
grant execute on function public.attach_public_booking_checkout(uuid, text) to anon, authenticated;
grant execute on function public.confirm_public_booking_payment(uuid, text, text, integer, text) to anon, authenticated;
grant execute on function public.expire_public_booking_checkout(uuid, text) to anon, authenticated;
grant execute on function public.get_public_booking_confirmation(uuid, text) to anon, authenticated;
