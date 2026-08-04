create table public.stripe_connect_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique
    references public.organizations(id) on delete cascade,
  stripe_account_id text not null unique
    check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  onboarding_status text not null default 'pending'
    check (onboarding_status in ('pending', 'restricted', 'active', 'disabled')),
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  fee_payer text not null default 'account'
    check (fee_payer in ('account', 'application', 'application_custom', 'application_express')),
  currently_due text[] not null default '{}',
  eventually_due text[] not null default '{}',
  past_due text[] not null default '{}',
  disabled_reason text,
  onboarding_completed_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stripe_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  customer_id uuid not null
    references public.customers(id) on delete cascade,
  stripe_account_id text not null
    check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  stripe_customer_id text not null
    check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, customer_id, stripe_account_id),
  unique (stripe_account_id, stripe_customer_id)
);

create table public.stripe_webhook_events (
  stripe_event_id text primary key
    check (stripe_event_id ~ '^evt_[A-Za-z0-9]+$'),
  organization_id uuid
    references public.organizations(id) on delete set null,
  stripe_account_id text,
  event_type text not null check (char_length(event_type) between 3 and 160),
  object_id text,
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processed', 'failed', 'ignored')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.invoices
  add column stripe_connect_account_id uuid
    references public.stripe_connect_accounts(id) on delete set null,
  add column stripe_customer_id text,
  add column stripe_invoice_id text unique,
  add column stripe_invoice_status text,
  add column stripe_hosted_invoice_url text,
  add column stripe_invoice_pdf_url text,
  add column stripe_payment_intent_id text,
  add column stripe_application_fee_cents integer not null default 0
    check (stripe_application_fee_cents >= 0);

create index stripe_customers_organization_id_idx
  on public.stripe_customers(organization_id);
create index stripe_customers_customer_id_idx
  on public.stripe_customers(customer_id);
create index stripe_webhook_events_org_received_idx
  on public.stripe_webhook_events(organization_id, received_at desc);
create index stripe_webhook_events_status_received_idx
  on public.stripe_webhook_events(processing_status, received_at)
  where processing_status in ('pending', 'failed');
create index invoices_stripe_connect_account_id_idx
  on public.invoices(stripe_connect_account_id);
create index invoices_stripe_customer_id_idx
  on public.invoices(stripe_customer_id)
  where stripe_customer_id is not null;

create trigger set_stripe_connect_accounts_updated_at
before update on public.stripe_connect_accounts
for each row execute function public.set_updated_at();

create trigger set_stripe_customers_updated_at
before update on public.stripe_customers
for each row execute function public.set_updated_at();

create trigger set_stripe_webhook_events_updated_at
before update on public.stripe_webhook_events
for each row execute function public.set_updated_at();

alter table public.stripe_connect_accounts enable row level security;
alter table public.stripe_customers enable row level security;
alter table public.stripe_webhook_events enable row level security;

create policy "Organization members can view Stripe connection status"
on public.stripe_connect_accounts for select
to authenticated
using ((select private.is_org_member(organization_id)));

create policy "Organization admins can add Stripe connections"
on public.stripe_connect_accounts for insert
to authenticated
with check ((select private.is_org_admin(organization_id)));

create policy "Organization admins can update Stripe connections"
on public.stripe_connect_accounts for update
to authenticated
using ((select private.is_org_admin(organization_id)))
with check ((select private.is_org_admin(organization_id)));

create policy "Organization admins can remove Stripe connections"
on public.stripe_connect_accounts for delete
to authenticated
using ((select private.is_org_admin(organization_id)));

create policy "Organization members can view Stripe customers"
on public.stripe_customers for select
to authenticated
using ((select private.is_org_member(organization_id)));

create policy "Organization members can add Stripe customers"
on public.stripe_customers for insert
to authenticated
with check ((select private.is_org_member(organization_id)));

create policy "Organization members can update Stripe customers"
on public.stripe_customers for update
to authenticated
using ((select private.is_org_member(organization_id)))
with check ((select private.is_org_member(organization_id)));

create policy "Organization members can remove Stripe customers"
on public.stripe_customers for delete
to authenticated
using ((select private.is_org_member(organization_id)));

create policy "Organization admins can inspect Stripe webhook events"
on public.stripe_webhook_events for select
to authenticated
using (
  organization_id is not null
  and (select private.is_org_admin(organization_id))
);

revoke all on table public.stripe_connect_accounts from public, anon;
revoke all on table public.stripe_customers from public, anon;
revoke all on table public.stripe_webhook_events from public, anon;

grant select, insert, update, delete on table public.stripe_connect_accounts to authenticated;
grant select, insert, update, delete on table public.stripe_customers to authenticated;
grant select on table public.stripe_webhook_events to authenticated;

grant select, insert, update, delete on table public.stripe_connect_accounts to service_role;
grant select, insert, update, delete on table public.stripe_customers to service_role;
grant select, insert, update, delete on table public.stripe_webhook_events to service_role;
