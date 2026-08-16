-- Booking on the electrician's own domain, in their own colours.
--
-- The booking page is the one part of this product a customer sees, and until
-- now it lived at /book/<slug> on our hostname wearing our yellow. An
-- electrician who has paid for a website sends people to a page that visibly
-- belongs to somebody else, and loses some of them at that moment.
--
-- Framing the page inside their site is the obvious fix and is the one thing
-- this must not do: the page carries the SMS consent checkbox the A2P campaign
-- was reviewed against, and in an iframe that checkbox can be overlaid or
-- hidden. So the page stays a top-level document and moves to a subdomain the
-- electrician points at us instead.

create table if not exists public.organization_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Lowercased, no scheme, no port, no trailing dot — matched literally against
  -- the request's host, so it has to be stored the way it arrives.
  hostname text not null,
  -- When the DNS and certificate were last seen to be correct. Informational:
  -- a request cannot reach us for a host the tenant does not control, so this
  -- is what the settings screen reports, not what authorises the lookup.
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_domains_hostname_check check (
    hostname = lower(hostname)
    and char_length(hostname) between 4 and 253
    -- Subdomains only. An apex needs A records, and pointing one here would
    -- replace the electrician's website rather than add a page to it.
    and hostname like '%.%.%'
  )
);

-- One host, one business. Two organizations claiming the same name would make
-- the lookup ambiguous, and the second one to add it should be told rather than
-- silently shadowed.
create unique index if not exists organization_domains_hostname_key
  on public.organization_domains (lower(hostname));
create index if not exists organization_domains_organization_idx
  on public.organization_domains (organization_id);

alter table public.organization_domains enable row level security;

create policy organization_domains_member_read on public.organization_domains
  for select using ((select private.is_org_member(organization_id)));

-- Adding a domain provisions a certificate and changes where customers land.
create policy organization_domains_admin_write on public.organization_domains
  for all using ((select private.is_org_admin(organization_id)))
  with check ((select private.is_org_admin(organization_id)));

drop trigger if exists set_organization_domains_updated_at on public.organization_domains;
create trigger set_organization_domains_updated_at
  before update on public.organization_domains
  for each row execute function public.set_updated_at();

-- The two things that make the page theirs rather than ours.
alter table public.organizations
  add column if not exists logo_path text,
  add column if not exists brand_color text;

alter table public.organizations
  drop constraint if exists organizations_brand_color_check;
alter table public.organizations
  add constraint organizations_brand_color_check check (
    brand_color is null or brand_color ~ '^#[0-9a-f]{6}$'
  );

-- Carry the branding into the page read. Same function, two more columns, so
-- there is still one definition of what a booking page is.
--
-- Dropped rather than replaced: `create or replace` refuses to change a
-- function's return type, and adding a column changes it. The drop takes the
-- grants with it, so they are restored at the bottom of this file — a booking
-- page that 404s for every signed-out customer is what forgetting that looks
-- like.
drop function if exists public.get_public_booking_page(text);

create function public.get_public_booking_page(p_slug text)
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
  business_hours jsonb,
  logo_path text,
  brand_color text
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
    settings.business_hours,
    organization.logo_path,
    organization.brand_color
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

-- The same page, found by the hostname the customer typed.
--
-- Delegates to the slug version rather than repeating the join, so the two can
-- never answer differently — including the several `is not null` conditions
-- that decide whether a business is ready to take bookings at all.
create or replace function public.get_booking_page_by_host(p_host text)
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
  business_hours jsonb,
  logo_path text,
  brand_color text
)
language sql
stable
security definer
set search_path = ''
as $$
  select page.*
  from public.organization_domains as tenant_domain
  join public.organizations as organization
    on organization.id = tenant_domain.organization_id
  cross join lateral public.get_public_booking_page(organization.slug) as page
  where tenant_domain.hostname = lower(btrim(p_host))
  limit 1;
$$;

-- Restored after the drop above.
revoke all on function public.get_public_booking_page(text) from public;
grant execute on function public.get_public_booking_page(text) to anon, authenticated;

-- `anon` may resolve a host to its booking page and may not read the domain
-- table, so nobody can enumerate which businesses use which names.
revoke all on function public.get_booking_page_by_host(text) from public;
grant execute on function public.get_booking_page_by_host(text) to anon, authenticated;
