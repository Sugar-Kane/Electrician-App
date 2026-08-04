alter table public.organizations
  add column if not exists phone text,
  add column if not exists base_address_line_1 text,
  add column if not exists base_postal_code text;

alter table public.service_settings
  add column if not exists business_hours jsonb not null default
    '{"monday":{"enabled":true,"start":"08:00","end":"17:00"},"tuesday":{"enabled":true,"start":"08:00","end":"17:00"},"wednesday":{"enabled":true,"start":"08:00","end":"17:00"},"thursday":{"enabled":true,"start":"08:00","end":"17:00"},"friday":{"enabled":true,"start":"08:00","end":"17:00"},"saturday":{"enabled":false,"start":"08:00","end":"17:00"},"sunday":{"enabled":false,"start":"08:00","end":"17:00"}}'::jsonb;

alter table public.service_settings
  add constraint service_settings_business_hours_object
  check (jsonb_typeof(business_hours) = 'object');

create or replace function public.create_owner_workspace(
  p_business_name text,
  p_owner_display_name text,
  p_phone text,
  p_base_address_line_1 text,
  p_base_city text,
  p_base_state text,
  p_base_postal_code text,
  p_automatic_booking_radius_miles integer,
  p_standard_pricing_radius_miles integer,
  p_business_hours jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  workspace_id uuid;
  normalized_business_name text := btrim(p_business_name);
  normalized_owner_name text := btrim(p_owner_display_name);
  normalized_phone text := btrim(p_phone);
  normalized_address text := btrim(p_base_address_line_1);
  normalized_city text := btrim(p_base_city);
  normalized_state text := upper(btrim(p_base_state));
  normalized_postal_code text := btrim(p_base_postal_code);
  slug_base text;
  slug_candidate text;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text, 0)
  );

  select membership.organization_id
  into workspace_id
  from public.organization_members as membership
  where membership.user_id = current_user_id
  order by membership.created_at
  limit 1;

  if workspace_id is not null then
    return workspace_id;
  end if;

  if char_length(normalized_business_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'Business name must be between 2 and 120 characters.';
  end if;

  if char_length(normalized_owner_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'Owner name must be between 2 and 120 characters.';
  end if;

  if char_length(normalized_phone) not between 7 and 30 then
    raise exception using errcode = '22023', message = 'Enter a valid business phone number.';
  end if;

  if char_length(normalized_address) not between 3 and 160 then
    raise exception using errcode = '22023', message = 'Enter the business street address.';
  end if;

  if char_length(normalized_city) not between 2 and 80 then
    raise exception using errcode = '22023', message = 'Enter a valid city.';
  end if;

  if normalized_state !~ '^[A-Z]{2}$' then
    raise exception using errcode = '22023', message = 'Enter a two-letter state abbreviation.';
  end if;

  if normalized_postal_code !~ '^[0-9]{5}(-[0-9]{4})?$' then
    raise exception using errcode = '22023', message = 'Enter a valid ZIP code.';
  end if;

  if p_automatic_booking_radius_miles not between 1 and 100
    or p_standard_pricing_radius_miles not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Service radius must be between 1 and 100 miles.';
  end if;

  if jsonb_typeof(p_business_hours) <> 'object' then
    raise exception using errcode = '22023', message = 'Business hours must be provided.';
  end if;

  slug_base := lower(
    pg_catalog.regexp_replace(normalized_business_name, '[^a-zA-Z0-9]+', '-', 'g')
  );
  slug_base := btrim(slug_base, '-');
  slug_base := btrim(left(slug_base, 80), '-');

  if char_length(slug_base) < 2 then
    slug_base := 'electrician-business';
  end if;

  slug_candidate := slug_base;
  while exists (
    select 1 from public.organizations where slug = slug_candidate
  ) loop
    slug_candidate := slug_base || '-' || left(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 6);
  end loop;

  insert into public.organizations (
    name,
    slug,
    timezone,
    phone,
    base_address_line_1,
    base_city,
    base_state,
    base_postal_code,
    created_by
  ) values (
    normalized_business_name,
    slug_candidate,
    'America/Los_Angeles',
    normalized_phone,
    normalized_address,
    normalized_city,
    normalized_state,
    normalized_postal_code,
    current_user_id
  )
  returning id into workspace_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (workspace_id, current_user_id, 'owner');

  insert into public.service_settings (
    organization_id,
    automatic_booking_radius_miles,
    standard_pricing_radius_miles,
    business_hours
  ) values (
    workspace_id,
    p_automatic_booking_radius_miles,
    p_standard_pricing_radius_miles,
    p_business_hours
  );

  insert into public.technicians (
    organization_id,
    user_id,
    display_name,
    phone,
    skills
  ) values (
    workspace_id,
    current_user_id,
    normalized_owner_name,
    normalized_phone,
    array['general_service', 'diagnostics']::text[]
  );

  insert into public.activity_events (
    organization_id,
    actor_user_id,
    event_type,
    label,
    entity_type,
    entity_id
  ) values (
    workspace_id,
    current_user_id,
    'workspace.created',
    'Business workspace created',
    'organization',
    workspace_id
  );

  return workspace_id;
end;
$$;

revoke all on function public.create_owner_workspace(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer,
  jsonb
) from public, anon;

grant execute on function public.create_owner_workspace(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer,
  jsonb
) to authenticated;
