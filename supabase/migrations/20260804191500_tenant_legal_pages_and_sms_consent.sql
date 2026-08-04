-- A2P 10DLC campaign remediation (Twilio error 30909).
--
-- The web booking form is a real opt-in path, but its messaging consent was
-- bundled into the required cancellation-policy checkbox and blocked checkout
-- until ticked. Consent that is bundled with another agreement, or required to
-- complete a purchase, is rejected under 30924/30925, and the booking page was
-- not described as an opt-in path in the published SMS terms at all (30917).
--
-- This migration records messaging consent as its own evidenced decision,
-- carries it through to the messaging consent ledger when the booking converts
-- to a customer, and makes sure every tenant has the published legal pages a
-- carrier reviewer must be able to open.
--
-- Note on the legal-page block below: public.tenant_legal_pages already exists
-- in the deployed database, created out-of-band without a repo migration, so
-- the repo cannot rebuild the deployed schema from scratch. The block therefore
-- reproduces the deployed shape only where the table is missing, and is a no-op
-- against production. Four migrations applied to production (messaging
-- foundation, messaging ISV tenancy, and the two tenant_legal_pages ones) are
-- still absent from this repo and should be captured separately.

do $$
begin
  if to_regclass('public.tenant_legal_pages') is null then
    create table public.tenant_legal_pages (
      organization_id uuid primary key references public.organizations(id) on delete cascade,
      -- Denormalized from organizations.slug: public.organizations is
      -- member-scoped by RLS and invisible to anon, so the public legal pages
      -- resolve a tenant on this column instead.
      slug text not null unique constraint tenant_legal_pages_slug_format
        check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
      legal_business_name text not null,
      dba_name text,
      support_phone text not null,
      support_email text not null,
      mailing_address text not null,
      program_name text not null,
      message_frequency text not null default 'up to 8 messages per service appointment',
      published boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    alter table public.tenant_legal_pages enable row level security;

    -- The point of these pages is that a signed-out carrier reviewer can read
    -- them. Nothing else in the schema is exposed to anon.
    create policy "Anyone can read published tenant legal pages"
    on public.tenant_legal_pages for select
    to anon, authenticated
    using (published);

    create policy "Organization members can view own legal page"
    on public.tenant_legal_pages for select
    to authenticated
    using ((select private.is_org_member(organization_id)));

    create policy "Organization members can add legal page"
    on public.tenant_legal_pages for insert
    to authenticated
    with check ((select private.is_org_member(organization_id)));

    create policy "Organization members can update legal page"
    on public.tenant_legal_pages for update
    to authenticated
    using ((select private.is_org_member(organization_id)))
    with check ((select private.is_org_member(organization_id)));

    create policy "Organization members can delete legal page"
    on public.tenant_legal_pages for delete
    to authenticated
    using ((select private.is_org_member(organization_id)));

    grant select on table public.tenant_legal_pages to anon;
    grant select, insert, update, delete on table public.tenant_legal_pages to authenticated;
    grant select, insert, update, delete on table public.tenant_legal_pages to service_role;
  end if;
end;
$$;

drop trigger if exists set_tenant_legal_pages_updated_at on public.tenant_legal_pages;
create trigger set_tenant_legal_pages_updated_at
before update on public.tenant_legal_pages
for each row execute function public.set_updated_at();

-- Legal-page details for a tenant, assembled from onboarding data. Returns
-- nothing when a required field is missing: an incomplete tenant must keep
-- 404'ing rather than serve a page with a blank phone number or address, which
-- fails carrier review more expensively than a missing page does.
create or replace function private.tenant_legal_page_defaults(p_organization_id uuid)
returns table (
  slug text,
  legal_business_name text,
  support_phone text,
  support_email text,
  mailing_address text,
  program_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    organization.slug,
    organization.name,
    organization.phone,
    owner_account.email,
    concat_ws(
      ', ',
      organization.base_address_line_1,
      organization.base_city,
      concat_ws(' ', organization.base_state, organization.base_postal_code)
    ),
    left(organization.name || ' Service Notifications', 120)
  from public.organizations as organization
  join auth.users as owner_account on owner_account.id = organization.created_by
  where organization.id = p_organization_id
    and organization.archived_at is null
    and organization.phone is not null
    and organization.base_address_line_1 is not null
    and organization.base_city is not null
    and organization.base_state is not null
    and organization.base_postal_code is not null
    and owner_account.email is not null;
$$;

revoke all on function private.tenant_legal_page_defaults(uuid) from public, anon, authenticated;

-- Every tenant onboarded from here on gets its legal pages at signup. Without
-- this, only organizations that existed when this migration ran would have the
-- Privacy Policy and SMS terms a campaign submission has to link to.
create or replace function public.create_tenant_legal_page()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  defaults record;
begin
  select * into defaults from private.tenant_legal_page_defaults(new.id);

  if defaults.slug is null then
    return new;
  end if;

  insert into public.tenant_legal_pages (
    organization_id, slug, legal_business_name, support_phone, support_email,
    mailing_address, program_name, published
  ) values (
    new.id, defaults.slug, defaults.legal_business_name, defaults.support_phone,
    defaults.support_email, defaults.mailing_address, defaults.program_name, true
  )
  on conflict (organization_id) do nothing;

  return new;
end;
$$;

revoke all on function public.create_tenant_legal_page() from public, anon, authenticated;

drop trigger if exists create_tenant_legal_page on public.organizations;
create trigger create_tenant_legal_page
after insert on public.organizations
for each row execute function public.create_tenant_legal_page();

-- A renamed organization must not orphan URLs already filed with the carrier,
-- so the legal slug follows organizations.slug.
create or replace function public.sync_tenant_legal_page_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tenant_legal_pages
  set slug = new.slug
  where organization_id = new.id
    and slug is distinct from new.slug;

  return new;
end;
$$;

revoke all on function public.sync_tenant_legal_page_slug() from public, anon, authenticated;

drop trigger if exists sync_tenant_legal_page_slug on public.organizations;
create trigger sync_tenant_legal_page_slug
after update of slug on public.organizations
for each row execute function public.sync_tenant_legal_page_slug();

-- Backfill anything onboarded before the trigger existed.
insert into public.tenant_legal_pages (
  organization_id, slug, legal_business_name, support_phone, support_email,
  mailing_address, program_name, published
)
select
  organization.id, defaults.slug, defaults.legal_business_name,
  defaults.support_phone, defaults.support_email, defaults.mailing_address,
  defaults.program_name, true
from public.organizations as organization
cross join lateral private.tenant_legal_page_defaults(organization.id) as defaults
on conflict (organization_id) do nothing;

-- Messaging consent is recorded on its own, separately from the cancellation
-- policy the customer must accept to book. sms_consent_disclosure stores the
-- exact wording shown on screen so the opt-in can be evidenced later.
alter table public.booking_intakes
  add column if not exists sms_consent boolean not null default false,
  add column if not exists sms_consent_at timestamptz,
  add column if not exists sms_consent_source text,
  add column if not exists sms_consent_disclosure text;

alter table public.booking_intakes
  drop constraint if exists booking_intakes_sms_consent_source_valid;
alter table public.booking_intakes
  add constraint booking_intakes_sms_consent_source_valid
  check (
    sms_consent_source is null
    or sms_consent_source in ('web_booking_form', 'phone', 'in_person')
  );

-- Every branch is spelled out as `is not null`: a CHECK that evaluates to
-- UNKNOWN passes, so `char_length(null) between 40 and 1000` alone would let a
-- consent row through with no proof attached.
alter table public.booking_intakes
  drop constraint if exists booking_intakes_sms_consent_evidenced;
alter table public.booking_intakes
  add constraint booking_intakes_sms_consent_evidenced
  check (
    sms_consent is false
    or (
      sms_consent_at is not null
      and sms_consent_source is not null
      and sms_consent_disclosure is not null
      and char_length(sms_consent_disclosure) between 40 and 1000
    )
  );

-- Recreate the intake RPC with the messaging consent fields. The consent source
-- is hardcoded rather than passed in: this function is the web form's path, and
-- an anon caller must not be able to claim a verbal opt-in.
drop function if exists public.create_public_booking_intake(
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  boolean, text, text, jsonb, text[], text, text, text, numeric, timestamptz,
  timestamptz
);

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
  p_sms_consent boolean,
  p_sms_consent_disclosure text,
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
  sms_opted_in boolean := p_sms_consent is true;
  sms_disclosure text := case when p_sms_consent is true then btrim(p_sms_consent_disclosure) end;
  sms_opted_in_at timestamptz := case when p_sms_consent is true then now() end;
  sms_source text := case when p_sms_consent is true then 'web_booking_form' end;
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

  -- Messaging consent stays optional, but a claimed opt-in without the
  -- disclosure text is unprovable and therefore rejected outright.
  if sms_opted_in and char_length(coalesce(sms_disclosure, '')) not between 40 and 1000 then
    raise exception using errcode = '22023', message = 'Text message consent could not be recorded.';
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
      sms_consent, sms_consent_at, sms_consent_source, sms_consent_disclosure,
      customer_description, category, safety_answers, safety_flags, safety_outcome,
      priority, service_area_status, service_distance_miles, diagnostic_fee_cents
    ) values (
      target_organization_id, 'needs_review', p_customer_type, btrim(p_first_name),
      btrim(p_last_name), normalized_email, btrim(p_phone), btrim(p_address_line_1),
      nullif(btrim(p_address_line_2), ''), btrim(p_city), normalized_state,
      btrim(p_postal_code), nullif(btrim(p_access_notes), ''),
      p_transactional_contact_consent, now(),
      sms_opted_in, sms_opted_in_at, sms_source, sms_disclosure,
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
      sms_consent, sms_consent_at, sms_consent_source, sms_consent_disclosure,
      customer_description, category, safety_answers, safety_flags, safety_outcome,
      priority, service_area_status, service_distance_miles, arrival_window_start,
      arrival_window_end, diagnostic_fee_cents
    ) values (
      target_organization_id, 'awaiting_payment', p_customer_type, btrim(p_first_name),
      btrim(p_last_name), normalized_email, btrim(p_phone), btrim(p_address_line_1),
      nullif(btrim(p_address_line_2), ''), btrim(p_city), normalized_state,
      btrim(p_postal_code), nullif(btrim(p_access_notes), ''),
      p_transactional_contact_consent, now(),
      sms_opted_in, sms_opted_in_at, sms_source, sms_disclosure,
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

grant execute on function public.create_public_booking_intake(
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  boolean, boolean, text, text, text, jsonb, text[], text, text, text, numeric,
  timestamptz, timestamptz
) to anon, authenticated;

-- Carry the opt-in through to the customer record when the booking converts.
-- Before this, every booked customer was created with preferred_contact 'sms'
-- whether or not they had agreed to be texted, and the consent never reached
-- the messaging consent ledger the sending path reads.
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
  matched_customer_id uuid;
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

  select customer.id into matched_customer_id
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

  if matched_customer_id is null then
    insert into public.customers (
      organization_id, customer_type, first_name, last_name, email, phone,
      preferred_contact, notes
    ) values (
      intake.organization_id, intake.customer_type, intake.first_name,
      intake.last_name, intake.email, intake.phone,
      case when intake.sms_consent then 'sms' else 'phone' end,
      'Created from public diagnostic booking'
    ) returning id into matched_customer_id;
  end if;

  -- The messaging tables live outside this repo's migrations; skip the ledger
  -- write where they are absent rather than failing the payment confirmation.
  if intake.sms_consent and to_regclass('public.messaging_consent') is not null then
    insert into public.messaging_consent (
      organization_id, customer_id, channel, scope, opted_in_at, opted_out_at,
      source, proof_text
    ) values (
      intake.organization_id, matched_customer_id, 'sms', 'transactional',
      coalesce(intake.sms_consent_at, now()), null, 'booking_form',
      intake.sms_consent_disclosure
    )
    on conflict (customer_id, channel, scope) do update
    set opted_in_at = excluded.opted_in_at,
        opted_out_at = null,
        source = excluded.source,
        proof_text = excluded.proof_text
    -- A customer who replied STOP after a previous booking has to opt in again
    -- deliberately; a later booking must not silently resurrect that consent.
    where messaging_consent.opted_out_at is null
       or messaging_consent.opted_out_at < excluded.opted_in_at;
  end if;

  select property.id into property_id
  from public.properties as property
  where property.organization_id = intake.organization_id
    and property.customer_id = matched_customer_id
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
      intake.organization_id, matched_customer_id, intake.address_line_1,
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
    intake.organization_id, matched_customer_id, property_id, 'confirmed', intake.category,
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
      converted_customer_id = matched_customer_id,
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

grant execute on function public.confirm_public_booking_payment(uuid, text, text, integer, text)
  to anon, authenticated;
