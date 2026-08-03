create table public.supplier_product_selections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  job_reference text,
  material_name text not null check (char_length(material_name) between 1 and 180),
  supplier text not null check (supplier in ('lowes', 'home-depot')),
  product_name text not null check (char_length(product_name) between 1 and 240),
  product_url text not null check (
    product_url ~ '^https://[^[:space:]]+$'
    and (
      (supplier = 'lowes' and lower(product_url) ~ '^https://([a-z0-9-]+\.)*lowes\.com/')
      or
      (supplier = 'home-depot' and lower(product_url) ~ '^https://([a-z0-9-]+\.)*homedepot\.com/')
    )
  ),
  retailer_sku text,
  quantity numeric(12, 2) not null default 1 check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  availability text not null default 'unknown' check (availability in ('in_stock', 'limited', 'out_of_stock', 'unknown')),
  store_name text,
  store_number text,
  store_address text,
  verified_at timestamptz not null,
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (job_id is not null or job_reference is not null)
);

create index supplier_product_selections_org_job_idx
on public.supplier_product_selections(organization_id, job_id, job_reference)
where archived_at is null;

create index supplier_product_selections_org_material_idx
on public.supplier_product_selections(organization_id, material_name)
where archived_at is null;

create unique index supplier_product_selections_active_product_idx
on public.supplier_product_selections(
  organization_id,
  coalesce(job_id::text, job_reference),
  material_name,
  supplier,
  product_url
)
where archived_at is null;

create trigger set_supplier_product_selections_updated_at
before update on public.supplier_product_selections
for each row execute function public.set_updated_at();

alter table public.supplier_product_selections enable row level security;

create policy "Organization members can view supplier product selections"
on public.supplier_product_selections for select
to authenticated
using ((select private.is_org_member(organization_id)));

create policy "Organization members can add supplier product selections"
on public.supplier_product_selections for insert
to authenticated
with check (
  (select private.is_org_member(organization_id))
  and (verified_by is null or verified_by = (select auth.uid()))
);

create policy "Organization members can update supplier product selections"
on public.supplier_product_selections for update
to authenticated
using ((select private.is_org_member(organization_id)))
with check (
  (select private.is_org_member(organization_id))
  and (verified_by is null or verified_by = (select auth.uid()))
);

create policy "Organization members can delete supplier product selections"
on public.supplier_product_selections for delete
to authenticated
using ((select private.is_org_member(organization_id)));

revoke all on table public.supplier_product_selections from anon;
grant select, insert, update, delete on table public.supplier_product_selections to authenticated;
