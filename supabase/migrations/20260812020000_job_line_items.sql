-- What a job is made of: the hours worked and the parts fitted.
--
-- Neither has ever existed. `mapJob` in src/lib/job-data.ts hardcodes
-- `materials: []` for every real job, so the materials section on a job page
-- has shown nothing to anybody who was not looking at the demo fixtures. And
-- `invoices.subtotal_cents` is a number somebody types in, which is why an
-- invoice can disagree with the work it bills for and nothing notices.
--
-- Labour and materials are one table, not two. They are the same shape — a
-- description, a quantity, a price each — they are summed together, and they
-- appear on the invoice as one list. Two tables would mean two forms, two
-- queries and two subtotals to reconcile, for a distinction that is one column.

create table if not exists public.job_line_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Lines die with the job. A job's parts list has no meaning without the job,
  -- and leaving orphans behind would make every sum over the table wrong.
  job_id uuid not null references public.jobs (id) on delete cascade,
  kind text not null check (kind in ('labour', 'material')),
  description text not null check (char_length(description) between 1 and 300),
  -- Numeric, not integer: wire is bought by the foot and time is billed by the
  -- quarter hour. 1.5 hours and 30.5 ft are both ordinary entries.
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit text not null default 'each' check (char_length(unit) between 1 and 24),
  -- Cents, like every other money column here. Floating point dollars is how a
  -- three-line invoice ends up a penny out from the sum of its own rows.
  unit_price_cents integer not null default 0 check (unit_price_cents >= 0),
  -- Set when the line was filled from stock the business already owns, so
  -- deducting quantity on hand at completion is a later migration rather than
  -- a guess based on matching names. Null for a part bought for this job.
  inventory_item_id uuid references public.inventory_items (id) on delete set null,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Deliberately no stored line total. A total that is written down can disagree
-- with the quantity and price beside it, and then there is no way to know which
-- of the three is the lie.

create index if not exists job_line_items_job_idx
  on public.job_line_items (job_id, created_at);

create index if not exists job_line_items_organization_idx
  on public.job_line_items (organization_id, created_at desc);

-- Answering "what have we fitted of this part" without scanning every job.
create index if not exists job_line_items_inventory_idx
  on public.job_line_items (inventory_item_id)
  where inventory_item_id is not null;

alter table public.job_line_items enable row level security;

-- Membership of the owning organization is the whole rule, via the foundation
-- helper rather than an inline subquery — one definition of "may see this" is
-- easier to keep right than a copy per table.
create policy "Organization members can view job line items"
  on public.job_line_items for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy "Organization members can add job line items"
  on public.job_line_items for insert to authenticated
  with check ((select private.is_org_member(organization_id)));

create policy "Organization members can change job line items"
  on public.job_line_items for update to authenticated
  using ((select private.is_org_member(organization_id)))
  with check ((select private.is_org_member(organization_id)));

create policy "Organization members can remove job line items"
  on public.job_line_items for delete to authenticated
  using ((select private.is_org_member(organization_id)));

create trigger set_job_line_items_updated_at
  before update on public.job_line_items
  for each row execute function set_updated_at();

-- What the technician wrote down, as opposed to what the customer said.
--
-- `customer_description` is the complaint and `ai_summary` is a machine's
-- reading of it. Neither is the place for "breaker was backstabbed, replaced
-- the receptacle, told the owner about the other three" — and until now there
-- was nowhere for that at all, so it went in a phone's notes app or nowhere.
alter table public.jobs
  add column if not exists technician_notes text;

comment on column public.jobs.technician_notes is
  'Written on site by whoever did the work. Never shown to the customer.';
