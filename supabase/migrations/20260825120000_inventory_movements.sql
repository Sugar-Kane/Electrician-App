-- Stock that moves on its own.
--
-- `quantity_on_hand` has been a number somebody typed since the foundation
-- migration. `job_line_items.inventory_item_id` has existed since August, with
-- a comment saying deducting it was "a later migration rather than a guess
-- based on matching names". This is that migration.
--
-- Two consequences beyond the arithmetic. An electrician who books three
-- breakers to a job no longer has to remember to take three off the shelf
-- count — which nobody does, which is why a stock list stops being true within
-- a fortnight. And a part that left the van carries the cost it left at, so the
-- year's material spend is a sum over this table rather than a guess made in
-- April from receipts in a glovebox.

-- ---------------------------------------------------------------------------
-- The ledger.
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Movements die with the item. A history of a part nobody stocks any more,
  -- with no part to hang it on, is a row that makes every sum wrong.
  item_id uuid not null references public.inventory_items (id) on delete cascade,

  -- Signed, and never zero. Negative is stock leaving, positive is stock
  -- arriving. One column rather than a direction and a magnitude, because every
  -- question asked of this table is a sum.
  quantity numeric(12, 2) not null check (quantity <> 0),

  reason text not null check (reason in (
    -- What was on the shelf when the ledger began. One per item, written by
    -- the backfill below, so today's counts survive the change.
    'opening',
    'received',
    'used_on_job',
    'returned',
    'adjustment',
    'wastage',
    'stock_take'
  )),

  -- Set when the movement belongs to a job. `set null` rather than cascade: a
  -- deleted job did not un-use the parts, and the expense stays real.
  job_id uuid references public.jobs (id) on delete set null,
  job_line_item_id uuid references public.job_line_items (id) on delete set null,

  -- What one unit cost at the moment it moved, not what it costs today. A
  -- breaker bought at $38 and used in March was a $38 expense in March, however
  -- the price has moved since.
  unit_cost_cents integer not null default 0 check (unit_cost_cents >= 0),

  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

comment on table public.inventory_movements is
  'Every change to what is on hand. quantity_on_hand is the sum of this table, kept in step by a trigger — never written directly.';

create index if not exists inventory_movements_item_idx
  on public.inventory_movements (item_id, created_at desc);

create index if not exists inventory_movements_org_idx
  on public.inventory_movements (organization_id, created_at desc);

-- The expense report groups by job and by month, and both start here.
create index if not exists inventory_movements_job_idx
  on public.inventory_movements (organization_id, job_id)
  where job_id is not null;

-- One movement per job line, so a double-tapped Add cannot take six breakers
-- off the shelf for a line that bills three.
create unique index if not exists inventory_movements_line_idx
  on public.inventory_movements (job_line_item_id)
  where job_line_item_id is not null and reason = 'used_on_job';

-- ---------------------------------------------------------------------------
-- Keeping the number in step.
--
-- A trigger rather than a view, because `quantity_on_hand` is read by the
-- materials list, the assistant, the low-stock count on the dashboard and the
-- job line picker, and rewriting all of those to sum a ledger would be a much
-- larger change than this is. The column stays; it stops being something a
-- person can set.
-- ---------------------------------------------------------------------------

create or replace function private.sync_inventory_quantity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  touched uuid;
  items uuid[] := '{}';
begin
  /*
   * Which items to recount.
   *
   * Branched on the operation rather than reading both records: in a PL/pgSQL
   * trigger `old` is unassigned on an insert and `new` is unassigned on a
   * delete, and touching the wrong one is a runtime error rather than a null.
   * An update can move a movement between items, so that case recounts both.
   */
  if tg_op = 'INSERT' then
    items := array[new.item_id];
  elsif tg_op = 'DELETE' then
    items := array[old.item_id];
  else
    items := array[new.item_id, old.item_id];
  end if;

  foreach touched in array items loop
    update public.inventory_items
      set quantity_on_hand = coalesce(
            (select sum(movement.quantity)
             from public.inventory_movements as movement
             where movement.item_id = touched),
            0
          ),
          updated_at = now()
      where id = touched;
  end loop;

  return null;
end;
$$;

drop trigger if exists sync_inventory_quantity on public.inventory_movements;

create trigger sync_inventory_quantity
  after insert or update or delete on public.inventory_movements
  for each row execute function private.sync_inventory_quantity();

-- ---------------------------------------------------------------------------
-- What is already on the shelf.
--
-- Every item holding a count today gets one 'opening' movement for exactly that
-- count, so the sum matches what the business sees right now and nothing is
-- wiped. Guarded, so running this twice does not double anybody's stock.
-- ---------------------------------------------------------------------------

insert into public.inventory_movements
  (organization_id, item_id, quantity, reason, unit_cost_cents, note)
select
  item.organization_id,
  item.id,
  item.quantity_on_hand,
  'opening',
  item.unit_cost_cents,
  'What was on the shelf when stock started being counted.'
from public.inventory_items as item
where item.quantity_on_hand <> 0
  and not exists (
    select 1 from public.inventory_movements as movement
    where movement.item_id = item.id and movement.reason = 'opening'
  );

-- ---------------------------------------------------------------------------
-- Who may read and write it.
--
-- The same shape as every other table here: members of the organization, and
-- nobody else. Deliberately no delete policy — a ledger is corrected by writing
-- the opposite movement, not by removing the one that was wrong, and a row that
-- can be deleted is a row that can be deleted quietly.
-- ---------------------------------------------------------------------------

alter table public.inventory_movements enable row level security;

drop policy if exists "Organization members can view stock movements" on public.inventory_movements;
create policy "Organization members can view stock movements"
  on public.inventory_movements for select to authenticated
  using ((select private.is_org_member(organization_id)));

drop policy if exists "Organization members can record stock movements" on public.inventory_movements;
create policy "Organization members can record stock movements"
  on public.inventory_movements for insert to authenticated
  with check ((select private.is_org_member(organization_id)));

-- ---------------------------------------------------------------------------
-- The spelling the app actually stores.
--
-- `job_line_items_kind_check` was written as ('labour', 'material') and the
-- deployed database has ('labor', 'material'). Every line the new job form
-- wrote was refused by that constraint until the code was corrected, and a
-- fresh environment built from these files would have had the opposite problem.
-- Restated here so the files and the database agree, with any stray rows moved
-- across first.
-- ---------------------------------------------------------------------------

update public.job_line_items set kind = 'labor' where kind = 'labour';

alter table public.job_line_items
  drop constraint if exists job_line_items_kind_check;

alter table public.job_line_items
  add constraint job_line_items_kind_check check (kind in ('labor', 'material'));
