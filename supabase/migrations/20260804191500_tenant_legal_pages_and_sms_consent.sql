-- A2P 10DLC campaign remediation (Twilio error 30909).
--
-- Two defects made the campaign unreviewable:
--
--   1. /legal/{org}/privacy and /legal/{org}/terms read public.tenant_legal_pages,
--      which no migration ever created. Every legal URL submitted with the
--      campaign returned 404, so the reviewer could not verify the Privacy
--      Policy or the SMS terms (30907/30908/30933/30934).
--   2. The web booking form is a real opt-in path, but its messaging consent was
--      bundled into the required cancellation-policy checkbox. Consent must be a
--      separate, unchecked, optional action, and the disclosure the customer
--      actually saw has to be retained as proof (30924/30925).
--
-- This migration creates the legal-page table the public pages already expect,
-- backfills it from onboarding data, and gives booking_intakes a standalone
-- messaging consent record.

create table public.tenant_legal_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  -- Denormalized from organizations.slug: public.organizations is member-scoped
  -- by RLS and invisible to anon, so the legal pages resolve on this column.
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  legal_business_name text not null check (char_length(legal_business_name) between 2 and 200),
  dba_name text check (char_length(dba_name) between 2 and 200),
  support_phone text not null check (char_length(support_phone) between 7 and 30),
  support_email text not null check (support_email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  mailing_address text not null check (char_length(mailing_address) between 8 and 300),
  program_name text not null default 'Service Notifications'
    check (char_length(program_name) between 2 and 120),
  message_frequency text not null default '2-6 messages per booked job'
    check (char_length(message_frequency) between 2 and 200),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tenant_legal_pages_published_slug_idx
  on public.tenant_legal_pages(slug)
  where published;

create trigger set_tenant_legal_pages_updated_at
before update on public.tenant_legal_pages
for each row execute function public.set_updated_at();

-- A renamed organization must not orphan the URLs already filed with the
-- carrier, so the legal slug follows organizations.slug automatically.
create function public.sync_tenant_legal_page_slug()
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

create trigger sync_tenant_legal_page_slug
after update of slug on public.organizations
for each row execute function public.sync_tenant_legal_page_slug();

alter table public.tenant_legal_pages enable row level security;

-- The whole point of these pages is that a signed-out carrier reviewer can read
-- them, so anon selects published rows. Nothing else is exposed to anon.
create policy "Anyone can view published legal pages"
on public.tenant_legal_pages for select
to anon, authenticated
using (published);

create policy "Organization members can view legal pages"
on public.tenant_legal_pages for select
to authenticated
using ((select private.is_org_member(organization_id)));

create policy "Organization admins can add legal pages"
on public.tenant_legal_pages for insert
to authenticated
with check ((select private.is_org_admin(organization_id)));

create policy "Organization admins can update legal pages"
on public.tenant_legal_pages for update
to authenticated
using ((select private.is_org_admin(organization_id)))
with check ((select private.is_org_admin(organization_id)));

create policy "Organization admins can delete legal pages"
on public.tenant_legal_pages for delete
to authenticated
using ((select private.is_org_admin(organization_id)));

grant select on table public.tenant_legal_pages to anon;
grant select, insert, update, delete on table public.tenant_legal_pages to authenticated;
grant select, insert, update, delete on table public.tenant_legal_pages to service_role;

-- Backfill from onboarding data. Rows publish only when every field a reviewer
-- checks is present; an incomplete tenant stays unpublished and its pages 404
-- rather than serving a page with a missing phone number or address.
insert into public.tenant_legal_pages (
  organization_id, slug, legal_business_name, support_phone, support_email,
  mailing_address, program_name, message_frequency, published
)
select
  organization.id,
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
  left(organization.name || ' Service Notifications', 120),
  '2-6 messages per booked job',
  true
from public.organizations as organization
join auth.users as owner_account on owner_account.id = organization.created_by
where organization.archived_at is null
  and organization.phone is not null
  and organization.base_address_line_1 is not null
  and organization.base_city is not null
  and organization.base_state is not null
  and organization.base_postal_code is not null
  and owner_account.email is not null
on conflict (organization_id) do nothing;

-- Messaging consent is recorded on its own, separately from the cancellation
-- policy the customer must accept to book. sms_consent_disclosure stores the
-- exact wording shown on screen so the consent can be evidenced later.
alter table public.booking_intakes
  add column if not exists sms_consent boolean not null default false,
  add column if not exists sms_consent_at timestamptz,
  add column if not exists sms_consent_source text,
  add column if not exists sms_consent_disclosure text;

alter table public.booking_intakes
  add constraint booking_intakes_sms_consent_source_valid
  check (
    sms_consent_source is null
    or sms_consent_source in ('web_booking_form', 'phone', 'in_person')
  );

alter table public.booking_intakes
  add constraint booking_intakes_sms_consent_evidenced
  check (
    sms_consent is false
    or (
      sms_consent_at is not null
      and sms_consent_source is not null
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

create function public.create_public_booking_intake(
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
