-- Admin fee, and estimates the customer can be sent.
--
-- 1. Admin fee. A business can set a percentage (in basis points: 400 = 4%)
--    that is built into the prices its customers pay. It is never shown to the
--    customer as a separate charge: every line on a job that carries the fee
--    is priced with it already in, so the totals on estimates, contracts,
--    invoices and payments all include it without each of them having to
--    remember. The business sees how much of a total is the fee.
--
--    A job takes the business's rate when it is created and keeps it, so jobs
--    that already exist (and anything already quoted, signed or billed) never
--    change. A line records the fee it carries, so the business's own price is
--    always unit_price_cents - admin_fee_cents.
--
-- 2. Estimates. The estimates table has existed since the foundation but was
--    never used. It gains an unguessable link for the customer, a delivery
--    record, and a read-only function the public estimate page calls with
--    only that link — the same shape as get_invoice_by_link. The fee is not
--    returned by it.

-- ---------------------------------------------------------------------------
-- 1. Admin fee
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column if not exists admin_fee_bps integer not null default 0
  check (admin_fee_bps between 0 and 2000);

comment on column public.organizations.admin_fee_bps is
  'Admin fee built into customer prices on new jobs, in basis points (400 = 4%). Never shown to the customer as its own line.';

alter table public.jobs
  add column if not exists admin_fee_bps integer not null default 0
  check (admin_fee_bps between 0 and 2000);

comment on column public.jobs.admin_fee_bps is
  'The business''s admin fee when this job was created, in basis points. Set by trigger on insert; existing jobs stay at 0.';

alter table public.job_line_items
  add column if not exists admin_fee_cents integer
  check (admin_fee_cents is null or admin_fee_cents >= 0);

comment on column public.job_line_items.admin_fee_cents is
  'Admin fee included in unit_price_cents, per unit. Null on lines written before the fee existed (none included). Written as 0 by callers for a price already agreed with the customer, such as the diagnostic fee.';

-- A new job takes its business's rate. Always the business's, whatever the
-- caller sent, so the rate cannot be chosen per job by whoever creates it.
create or replace function private.set_job_admin_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(organization.admin_fee_bps, 0)
    into new.admin_fee_bps
    from public.organizations as organization
    where organization.id = new.organization_id;
  new.admin_fee_bps := coalesce(new.admin_fee_bps, 0);
  return new;
end;
$$;

drop trigger if exists jobs_admin_fee on public.jobs;
create trigger jobs_admin_fee
  before insert on public.jobs
  for each row execute function private.set_job_admin_fee();

-- A new line is written at the business's own price; the fee goes on top here,
-- once. A caller that already decided the fee (0 for the diagnostic fee) sends
-- admin_fee_cents and the price is left alone. Lines are added and removed but
-- never repriced, so only an insert needs this.
create or replace function private.add_admin_fee_to_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rate integer;
begin
  if new.admin_fee_cents is not null then
    return new;
  end if;

  select job.admin_fee_bps
    into rate
    from public.jobs as job
    where job.id = new.job_id
      and job.organization_id = new.organization_id;

  new.admin_fee_cents := round(coalesce(new.unit_price_cents, 0) * coalesce(rate, 0) / 10000.0)::integer;
  new.unit_price_cents := coalesce(new.unit_price_cents, 0) + new.admin_fee_cents;
  return new;
end;
$$;

drop trigger if exists job_line_items_admin_fee on public.job_line_items;
create trigger job_line_items_admin_fee
  before insert on public.job_line_items
  for each row execute function private.add_admin_fee_to_line();

-- Pacific Plains Electric: 4%. Matches nothing on a fresh database.
update public.organizations
  set admin_fee_bps = 400
  where id = 'a6256f4d-756e-49d0-b299-5d58a20ae0ad';

-- ---------------------------------------------------------------------------
-- 2. Estimates
-- ---------------------------------------------------------------------------

alter table public.estimates
  add column if not exists preview_token uuid not null default gen_random_uuid(),
  add column if not exists diagnostic_credit_cents integer not null default 0 check (diagnostic_credit_cents >= 0),
  add column if not exists admin_fee_cents integer not null default 0 check (admin_fee_cents >= 0),
  add column if not exists deliveries jsonb not null default '[]'::jsonb,
  add column if not exists last_sent_at timestamptz,
  add column if not exists created_by uuid references auth.users (id) on delete set null;

create unique index if not exists estimates_preview_token_key
  on public.estimates (preview_token);

create index if not exists estimates_created_by_idx
  on public.estimates (created_by);

comment on column public.estimates.preview_token is
  'The customer''s link to this estimate. Unguessable; the only way the public page finds it.';
comment on column public.estimates.admin_fee_cents is
  'How much of total_cents is the business''s admin fee. For the business only; never returned to the customer.';

-- The customer's estimate, by its link. Read-only, and only what the page
-- shows: no admin fee, no line items, nothing that finds another record.
create or replace function public.get_estimate_by_link(p_token uuid)
returns table (
  business_name text,
  business_phone text,
  customer_name text,
  estimate_number bigint,
  job_number bigint,
  status text,
  subtotal_cents integer,
  diagnostic_credit_cents integer,
  tax_cents integer,
  total_cents integer,
  expires_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz,
  work_summary text,
  time_zone text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    organization.name,
    organization.phone,
    nullif(trim(coalesce(
      nullif(customer.company_name, ''),
      concat_ws(' ', nullif(customer.first_name, 'Text'), customer.last_name)
    )), ''),
    estimate.estimate_number,
    job.job_number,
    estimate.status,
    estimate.subtotal_cents,
    estimate.diagnostic_credit_cents,
    estimate.tax_cents,
    estimate.total_cents,
    estimate.expires_at,
    estimate.last_sent_at,
    estimate.created_at,
    job.customer_description,
    coalesce(organization.timezone, 'America/Los_Angeles')
  from public.estimates as estimate
  join public.organizations as organization on organization.id = estimate.organization_id
  left join public.jobs as job on job.id = estimate.job_id
  left join public.customers as customer on customer.id = job.customer_id
  where estimate.preview_token = p_token
    and organization.archived_at is null
  limit 1;
$function$;

revoke all on function public.get_estimate_by_link(uuid) from public;
grant execute on function public.get_estimate_by_link(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. A customer's address is their service address by default
-- ---------------------------------------------------------------------------
--
-- The customer list, jobs and directions all read a customer's service address
-- (properties). An address saved on the customer itself, from any of the
-- places customers are made or edited, used to stop there, so a customer with
-- a perfectly good address showed none. Now, when a customer has an address
-- and no service address, it becomes one: their own address first, their
-- business address otherwise. A customer who already has a service address is
-- left alone, so this never moves or duplicates one. Map coordinates are
-- filled in later by the app, as for any new property.

create or replace function private.customer_address_as_service_address()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.properties as property
    where property.customer_id = new.id and property.archived_at is null
  ) then
    return null;
  end if;

  if nullif(trim(coalesce(new.address_line_1, '')), '') is not null
     and nullif(trim(coalesce(new.city, '')), '') is not null then
    insert into public.properties (organization_id, customer_id, address_line_1, address_line_2, city, state, postal_code)
    values (
      new.organization_id,
      new.id,
      trim(new.address_line_1),
      nullif(trim(coalesce(new.address_line_2, '')), ''),
      trim(new.city),
      coalesce(trim(new.state), ''),
      coalesce(trim(new.postal_code), '')
    );
  elsif nullif(trim(coalesce(new.business_address_line_1, '')), '') is not null
     and nullif(trim(coalesce(new.business_city, '')), '') is not null then
    insert into public.properties (organization_id, customer_id, address_line_1, address_line_2, city, state, postal_code)
    values (
      new.organization_id,
      new.id,
      trim(new.business_address_line_1),
      nullif(trim(coalesce(new.business_address_line_2, '')), ''),
      trim(new.business_city),
      coalesce(trim(new.business_state), ''),
      coalesce(trim(new.business_postal_code), '')
    );
  end if;

  return null;
end;
$$;

drop trigger if exists customers_address_as_service_address on public.customers;
create trigger customers_address_as_service_address
  after insert or update of address_line_1, city, business_address_line_1, business_city on public.customers
  for each row execute function private.customer_address_as_service_address();

-- Existing customers with an address and no service address (Junell Peterson
-- and Carlos Cardenas when this was written). Setting a column to itself fires
-- the trigger above for exactly those rows.
update public.customers as customer
  set address_line_1 = customer.address_line_1
  where not exists (
      select 1 from public.properties as property
      where property.customer_id = customer.id and property.archived_at is null
    )
    and (
      (nullif(trim(coalesce(customer.address_line_1, '')), '') is not null and nullif(trim(coalesce(customer.city, '')), '') is not null)
      or (nullif(trim(coalesce(customer.business_address_line_1, '')), '') is not null and nullif(trim(coalesce(customer.business_city, '')), '') is not null)
    );
