-- What has to be bought, for which job, and where it stands.
--
-- A stock search that found nothing used to end there: "Nothing in stock
-- matches", then supplier small print. The part was still needed and nothing
-- remembered it. A buy list does: what, how many, for which job, from which
-- supplier, and how far along it is — need to buy, ordered, ready for pickup,
-- picked up. Every status is set by a person. Nothing here talks to a store,
-- so nothing here can claim a store has a part, or what it costs.
--
-- The supplier is one of the business's own supply stops, the same places
-- the route drives to, so Materials, Supply stops and Route all mean the same
-- place by the same name.

create table if not exists public.buy_list_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- What it is for and where it comes from. All optional: plenty of things are
  -- bought for the van rather than a job, and a supplier is often decided at
  -- the counter.
  job_id uuid references public.jobs (id) on delete set null,
  inventory_item_id uuid references public.inventory_items (id) on delete set null,
  supply_stop_id uuid references public.supply_stops (id) on delete set null,

  description text not null check (char_length(description) between 1 and 200),
  quantity numeric(12, 2) not null default 1 check (quantity > 0),
  unit text not null default 'each' check (char_length(unit) between 1 and 24),

  status text not null default 'need_to_buy'
    check (status in ('need_to_buy', 'ordered', 'ready_for_pickup', 'picked_up')),
  -- The supplier's order or confirmation number, as typed.
  order_reference text check (order_reference is null or char_length(order_reference) <= 80),
  needed_by date,

  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.buy_list_items is
  'Parts to buy, for a job or for the van, with a status set by hand: need to buy, ordered, ready for pickup, picked up.';

create index if not exists buy_list_items_org_status_idx
  on public.buy_list_items (organization_id, status, created_at);
create index if not exists buy_list_items_job_idx
  on public.buy_list_items (job_id) where job_id is not null;

-- A buy-list line may only point at this business's own job, stock item and
-- supply stop. Row security keeps other businesses' rows out of sight; this
-- keeps a guessed id from another business out of a row.
create or replace function private.buy_list_same_business()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.job_id is not null and not exists (
    select 1 from public.jobs as job
    where job.id = new.job_id and job.organization_id = new.organization_id
  ) then
    raise exception 'That job is not this business''s.' using errcode = 'check_violation';
  end if;

  if new.inventory_item_id is not null and not exists (
    select 1 from public.inventory_items as item
    where item.id = new.inventory_item_id and item.organization_id = new.organization_id
  ) then
    raise exception 'That stock item is not this business''s.' using errcode = 'check_violation';
  end if;

  if new.supply_stop_id is not null and not exists (
    select 1 from public.supply_stops as stop
    where stop.id = new.supply_stop_id and stop.organization_id = new.organization_id
  ) then
    raise exception 'That supplier is not this business''s.' using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function private.buy_list_same_business() from public, anon, authenticated;

create or replace trigger buy_list_same_business
  before insert or update on public.buy_list_items
  for each row execute function private.buy_list_same_business();

alter table public.buy_list_items enable row level security;

-- Created only when missing, so this file runs again cleanly on a database
-- that already has them.
do $policies$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'buy_list_items'
      and policyname = 'Organization members can view the buy list'
  ) then
    create policy "Organization members can view the buy list"
      on public.buy_list_items for select to authenticated
      using ((select private.is_org_member(organization_id)));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'buy_list_items'
      and policyname = 'Organization members can add to the buy list'
  ) then
    create policy "Organization members can add to the buy list"
      on public.buy_list_items for insert to authenticated
      with check ((select private.is_org_member(organization_id)));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'buy_list_items'
      and policyname = 'Organization members can change the buy list'
  ) then
    create policy "Organization members can change the buy list"
      on public.buy_list_items for update to authenticated
      using ((select private.is_org_member(organization_id)))
      with check ((select private.is_org_member(organization_id)));
  end if;

  -- A shopping list is crossed off and cleared; unlike stock or customers,
  -- nothing else hangs off a line once it is gone.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'buy_list_items'
      and policyname = 'Organization members can clear the buy list'
  ) then
    create policy "Organization members can clear the buy list"
      on public.buy_list_items for delete to authenticated
      using ((select private.is_org_member(organization_id)));
  end if;
end;
$policies$;

grant select, insert, update, delete on public.buy_list_items to authenticated;
