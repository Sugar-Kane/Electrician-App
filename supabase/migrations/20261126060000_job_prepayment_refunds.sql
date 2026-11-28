-- Refunds of money taken before the invoice (deposits), for a customer who
-- cancelled a home improvement contract (compliance CSLB-007-007): one row per
-- payment returned, to the card or bank through Stripe, or by hand (cash or
-- check given back). Written only by the server (service role), after it has
-- checked the person may edit billing; members of the business may read them.

create table if not exists public.job_prepayment_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  prepayment_id uuid not null unique references public.job_prepayments (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  how text not null check (how in ('stripe', 'by_hand')),
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  stripe_refund_id text,
  failure_reason text,
  refunded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_prepayment_refunds_job_idx on public.job_prepayment_refunds (organization_id, job_id);

alter table public.job_prepayment_refunds enable row level security;

drop policy if exists "Organization members can view prepayment refunds" on public.job_prepayment_refunds;
create policy "Organization members can view prepayment refunds"
  on public.job_prepayment_refunds for select
  to authenticated
  using ((select private.is_org_member(organization_id)));

revoke all on public.job_prepayment_refunds from public, anon, authenticated;
grant select on public.job_prepayment_refunds to authenticated;

drop trigger if exists set_job_prepayment_refunds_updated_at on public.job_prepayment_refunds;
create trigger set_job_prepayment_refunds_updated_at
  before update on public.job_prepayment_refunds
  for each row execute function public.set_updated_at();

drop trigger if exists zz_tenant_references_guard on public.job_prepayment_refunds;
create trigger zz_tenant_references_guard
  before insert or update on public.job_prepayment_refunds
  for each row execute function private.guard_tenant_references('job_id', 'jobs', 'prepayment_id', 'job_prepayments');

drop trigger if exists zz_tenant_owner_immutable on public.job_prepayment_refunds;
create trigger zz_tenant_owner_immutable
  before update of organization_id on public.job_prepayment_refunds
  for each row execute function private.keep_tenant_owner();
