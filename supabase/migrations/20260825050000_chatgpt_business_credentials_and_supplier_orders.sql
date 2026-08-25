create table if not exists public.mcp_business_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null default 'ChatGPT',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz
);
create index if not exists mcp_business_credentials_org_idx on public.mcp_business_credentials(organization_id, created_at desc);
alter table public.mcp_business_credentials enable row level security;
create policy "owners manage business mcp credentials" on public.mcp_business_credentials for all using (
  exists (select 1 from public.organization_members m where m.organization_id = mcp_business_credentials.organization_id and m.user_id = auth.uid() and m.role = 'owner')
) with check (
  exists (select 1 from public.organization_members m where m.organization_id = mcp_business_credentials.organization_id and m.user_id = auth.uid() and m.role = 'owner')
);

create table if not exists public.supplier_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  supplier text not null check (supplier in ('lowes','home-depot')),
  status text not null default 'draft' check (status in ('draft','approved','submitted','ordered','failed','cancelled')),
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  external_order_id text,
  checkout_url text,
  failure_reason text,
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists supplier_orders_org_idx on public.supplier_orders(organization_id, created_at desc);
create index if not exists supplier_orders_job_idx on public.supplier_orders(job_id, created_at desc);
alter table public.supplier_orders enable row level security;
create policy "members read supplier orders" on public.supplier_orders for select using (
  exists (select 1 from public.organization_members m where m.organization_id = supplier_orders.organization_id and m.user_id = auth.uid())
);
create policy "owners manage supplier orders" on public.supplier_orders for all using (
  exists (select 1 from public.organization_members m where m.organization_id = supplier_orders.organization_id and m.user_id = auth.uid() and m.role = 'owner')
) with check (
  exists (select 1 from public.organization_members m where m.organization_id = supplier_orders.organization_id and m.user_id = auth.uid() and m.role = 'owner')
);

create table if not exists public.supplier_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.supplier_orders(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  material_name text not null,
  retailer_sku text,
  product_name text not null,
  product_url text,
  quantity numeric not null check (quantity > 0),
  unit_price_cents integer not null default 0 check (unit_price_cents >= 0),
  availability text,
  store_name text,
  store_number text,
  created_at timestamptz not null default now()
);
create index if not exists supplier_order_items_order_idx on public.supplier_order_items(order_id);
alter table public.supplier_order_items enable row level security;
create policy "members read supplier order items" on public.supplier_order_items for select using (
  exists (select 1 from public.organization_members m where m.organization_id = supplier_order_items.organization_id and m.user_id = auth.uid())
);
create policy "owners manage supplier order items" on public.supplier_order_items for all using (
  exists (select 1 from public.organization_members m where m.organization_id = supplier_order_items.organization_id and m.user_id = auth.uid() and m.role = 'owner')
) with check (
  exists (select 1 from public.organization_members m where m.organization_id = supplier_order_items.organization_id and m.user_id = auth.uid() and m.role = 'owner')
);