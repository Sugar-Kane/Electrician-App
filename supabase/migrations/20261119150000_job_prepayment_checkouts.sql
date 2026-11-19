-- Pay-link checkouts: each Stripe checkout opened from a deposit or
-- installment's pay link, and how it went.
--
-- One checkout at a time per job. A pay link claims the job's slot here
-- before it asks Stripe for a checkout, so two taps at once, or two links
-- opened together, cannot both open a chargeable checkout. The slot stays
-- taken while the checkout is open, while a bank payment clears, and until
-- the payment is recorded, so money paid but not yet recorded is never asked
-- for again. Written only by the server (service role); members can read.

create table if not exists public.job_prepayment_checkouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  plan_item_id uuid references public.job_payment_plan_items (id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  -- Set once Stripe has made the checkout.
  checkout_session_id text unique check (checkout_session_id is null or checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  checkout_url text,
  status text not null default 'creating'
    check (status in ('creating', 'open', 'processing', 'succeeded', 'failed', 'expired')),
  method text check (method is null or method in ('ach', 'card')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The job's one slot: at most one checkout being made, open, or clearing.
create unique index if not exists job_prepayment_checkouts_one_active
  on public.job_prepayment_checkouts (job_id)
  where status in ('creating', 'open', 'processing');

create index if not exists job_prepayment_checkouts_job_idx
  on public.job_prepayment_checkouts (job_id, created_at desc);

create or replace trigger zz_tenant_references_guard
  before insert or update on public.job_prepayment_checkouts
  for each row execute function private.guard_tenant_references('job_id', 'jobs', 'plan_item_id', 'job_payment_plan_items');

create or replace trigger zz_tenant_owner_immutable
  before update of organization_id on public.job_prepayment_checkouts
  for each row execute function private.keep_tenant_owner();

create or replace trigger set_job_prepayment_checkouts_updated_at
  before update on public.job_prepayment_checkouts
  for each row execute function public.set_updated_at();

alter table public.job_prepayment_checkouts enable row level security;

revoke all on public.job_prepayment_checkouts from anon, authenticated;
grant select on public.job_prepayment_checkouts to authenticated;

create policy "Members can view pay link checkouts" on public.job_prepayment_checkouts
  for select to authenticated using ((select private.is_org_member(organization_id)));
