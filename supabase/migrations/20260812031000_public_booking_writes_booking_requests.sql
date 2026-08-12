-- The one web booking function that could not be rewritten mechanically.
--
-- The others only read or update, so repointing the table and renaming a few
-- columns was enough. This one inserts, and the shared table asks for things
-- the web form never had to supply: a source, an intent, an urgency. They are
-- not new information — the booking mode and the priority already said all
-- three — they just had different names on the web side.

create or replace function public.create_public_booking_intake(
  p_slug text, p_booking_mode text, p_customer_type text, p_first_name text,
  p_last_name text, p_email text, p_phone text, p_address_line_1 text,
  p_address_line_2 text, p_city text, p_state text, p_postal_code text,
  p_access_notes text, p_transactional_contact_consent boolean, p_sms_consent boolean,
  p_sms_consent_disclosure text, p_customer_description text, p_category text,
  p_safety_answers jsonb, p_safety_flags text[], p_safety_outcome text, p_priority text,
  p_service_area_status text, p_service_distance_miles numeric,
  p_arrival_window_start timestamptz, p_arrival_window_end timestamptz
)
returns table (intake_id uuid, booking_token uuid, intake_status text, fee_cents integer)
language plpgsql security definer set search_path = ''
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
  -- The shared table's vocabulary, filled in for a source that never had to
  -- supply it. A booking mode is an intent; a priority is an urgency.
  booking_intent text := case when p_booking_mode = 'callback' then 'callback' else 'visit' end;
  booking_urgency text := case when p_priority = 'emergency' then 'urgent' else 'routine' end;
  contact text := btrim(btrim(p_first_name) || ' ' || btrim(p_last_name));
  created_intake public.booking_requests%rowtype;
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

  -- service_settings keeps its own diagnostic_fee_cents. That is the price the
  -- business charges and was never renamed; only the booking row's copy of the
  -- amount became deposit_cents.
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
    insert into public.booking_requests (
      organization_id, source, status, intent, urgency, customer_type,
      contact_name, first_name, last_name, email, phone,
      address_line_1, address_line_2, city, state, postal_code, access_notes,
      transactional_contact_consent, consented_at,
      sms_consent, sms_consent_at, sms_consent_source, sms_consent_disclosure,
      description, category, safety_answers, safety_flags, safety_outcome,
      priority, service_area_status, service_distance_miles, deposit_cents
    ) values (
      target_organization_id, 'web', 'needs_review', booking_intent, booking_urgency,
      p_customer_type, contact, btrim(p_first_name), btrim(p_last_name),
      normalized_email, btrim(p_phone), btrim(p_address_line_1),
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
      'Customer booking needs review', 'booking_request', created_intake.id,
      jsonb_build_object('service_area_status', p_service_area_status, 'source', 'web')
    );
  else
    if p_arrival_window_start is null or p_arrival_window_end is null then
      raise exception using errcode = '22023', message = 'Choose an available arrival window.';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        target_organization_id::text || ':' || p_arrival_window_start::text, 0
      )
    );

    if not exists (
      select 1
      from public.list_public_booking_slots(
        p_slug, (p_arrival_window_start at time zone organization_timezone)::date, 1
      ) as available_slot
      where available_slot.slot_start = p_arrival_window_start
        and available_slot.slot_end = p_arrival_window_end
    ) then
      raise exception using errcode = '23P01', message = 'That arrival window is no longer available.';
    end if;

    selected_fee := case when p_priority = 'emergency' then urgent_fee else standard_fee end;

    insert into public.booking_requests (
      organization_id, source, status, intent, urgency, customer_type,
      contact_name, first_name, last_name, email, phone,
      address_line_1, address_line_2, city, state, postal_code, access_notes,
      transactional_contact_consent, consented_at,
      sms_consent, sms_consent_at, sms_consent_source, sms_consent_disclosure,
      description, category, safety_answers, safety_flags, safety_outcome,
      priority, service_area_status, service_distance_miles,
      arrival_window_start, arrival_window_end, deposit_cents, expires_at
    ) values (
      target_organization_id, 'web', 'awaiting_payment', booking_intent, booking_urgency,
      p_customer_type, contact, btrim(p_first_name), btrim(p_last_name),
      normalized_email, btrim(p_phone), btrim(p_address_line_1),
      nullif(btrim(p_address_line_2), ''), btrim(p_city), normalized_state,
      btrim(p_postal_code), nullif(btrim(p_access_notes), ''),
      p_transactional_contact_consent, now(),
      sms_opted_in, sms_opted_in_at, sms_source, sms_disclosure,
      btrim(p_customer_description), left(btrim(p_category), 80), p_safety_answers,
      p_safety_flags, p_safety_outcome, p_priority, p_service_area_status,
      p_service_distance_miles, p_arrival_window_start, p_arrival_window_end,
      selected_fee,
      -- The hold the old table gave by default. Explicit here, because the
      -- shared table has no default: a text booking holds nothing.
      now() + interval '30 minutes'
    ) returning * into created_intake;
  end if;

  intake_id := created_intake.id;
  booking_token := created_intake.public_token;
  intake_status := created_intake.status;
  fee_cents := created_intake.deposit_cents;
  return next;
end;
$$;

grant execute on function public.create_public_booking_intake(
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  boolean, boolean, text, text, text, jsonb, text[], text, text, text, numeric,
  timestamptz, timestamptz
) to anon, authenticated;

-- Nothing points at the old table any more: no foreign keys, no functions, no
-- application code. The web path was exercised end to end — booking, checkout,
-- payment, job, confirmation page — before this ran.
drop table if exists public.booking_intakes;
