-- Where this business actually buys things.
--
-- The route builder has offered exactly two supply stops since it was written:
-- a Lowe's and a Home Depot in Santa Maria, hardcoded in `pilot-data.ts` with
-- their store numbers. Fine for the pilot business, wrong for everyone else,
-- and wrong for the pilot business too the moment they want to stop at their
-- own storage unit — which is where most of an electrician's stock actually
-- lives.
--
-- Free text for the kind rather than an enum. A supply house, a storage unit, a
-- friend's shop and a big-box store are all "somewhere I stop on the way", and
-- the difference between them is not worth a migration every time somebody
-- finds a new one.

create table if not exists public.supply_stops (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  name text not null check (char_length(name) between 1 and 120),
  -- "Lowe's", "my storage unit", "Walters Wholesale". Shown on the route.
  kind text not null default 'supplier'
    check (kind in ('supplier', 'storage', 'store', 'other')),

  address_line_1 text not null check (char_length(address_line_1) between 1 and 200),
  city text not null default '',
  state text not null default '',
  postal_code text not null default '',

  -- Filled from the address search when it can, so the route can order stops
  -- without geocoding them again on every render.
  latitude numeric(9, 6),
  longitude numeric(9, 6),

  -- The aisle number, the gate code, who to ask for.
  notes text,
  -- The one offered first. At most one per business, enforced below.
  is_default boolean not null default false,

  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

comment on table public.supply_stops is
  'Places this business stops on the way to a job: suppliers, storage units, anywhere parts come from.';

create index if not exists supply_stops_org_idx
  on public.supply_stops (organization_id, archived_at, name);

-- One default per business. Partial, so archived rows and the many non-default
-- stops do not collide with each other.
create unique index if not exists supply_stops_one_default_idx
  on public.supply_stops (organization_id)
  where is_default and archived_at is null;

alter table public.supply_stops enable row level security;

drop policy if exists "Organization members can view supply stops" on public.supply_stops;
create policy "Organization members can view supply stops"
  on public.supply_stops for select to authenticated
  using ((select private.is_org_member(organization_id)));

drop policy if exists "Organization members can add supply stops" on public.supply_stops;
create policy "Organization members can add supply stops"
  on public.supply_stops for insert to authenticated
  with check ((select private.is_org_member(organization_id)));

drop policy if exists "Organization members can change supply stops" on public.supply_stops;
create policy "Organization members can change supply stops"
  on public.supply_stops for update to authenticated
  using ((select private.is_org_member(organization_id)))
  with check ((select private.is_org_member(organization_id)));

-- Deliberately no delete policy. A stop is archived, like a stock item and a
-- customer: a place removed by a mistyped tap is recoverable, a deleted row is
-- not, and this list is edited one-handed in a van.
