-- Contracts, generated from the business's own template.
--
-- An electrician already has a contract they use. It is a Word document on a
-- laptop, and the job details get typed into it by hand for every job, which is
-- where the wrong address and last month's price come from. The template lives
-- here instead, with placeholders, and a contract is produced by filling it.
--
-- One template per business for now. A business with two (residential and
-- commercial, say) is a real thing, and the unique constraint is on
-- organization_id so lifting that later is a migration rather than a rewrite.

create table if not exists public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null default 'Standard contract',
  -- The template as the business wrote it, placeholders and all. Stored
  -- verbatim: it is their document, and reformatting it would lose the
  -- paragraph they argued with their lawyer about.
  body text not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id)
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  -- The finished text, frozen. Regenerating from the template later would
  -- produce a different document from the one the customer agreed to, which is
  -- the one thing a contract may never do.
  body text not null,
  -- Placeholders the template asked for that the job could not supply. Kept so
  -- the screen can say "this contract has three blanks" rather than shipping a
  -- document with {{permit_number}} in it.
  unfilled text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'sent', 'signed', 'void')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contracts_organization_idx
  on public.contracts (organization_id, created_at desc);
create index if not exists contracts_job_idx on public.contracts (job_id);

alter table public.contract_templates enable row level security;
alter table public.contracts enable row level security;

-- Same shape as every other tenant table here: membership of the owning
-- organization is the whole rule.
create policy contract_templates_member_read on public.contract_templates
  for select using (
    organization_id in (
      select organization_id from public.organization_members where user_id = (select auth.uid())
    )
  );

create policy contract_templates_member_write on public.contract_templates
  for all using (
    organization_id in (
      select organization_id from public.organization_members where user_id = (select auth.uid())
    )
  ) with check (
    organization_id in (
      select organization_id from public.organization_members where user_id = (select auth.uid())
    )
  );

create policy contracts_member_read on public.contracts
  for select using (
    organization_id in (
      select organization_id from public.organization_members where user_id = (select auth.uid())
    )
  );

create policy contracts_member_write on public.contracts
  for all using (
    organization_id in (
      select organization_id from public.organization_members where user_id = (select auth.uid())
    )
  ) with check (
    organization_id in (
      select organization_id from public.organization_members where user_id = (select auth.uid())
    )
  );

create trigger set_contract_templates_updated_at
  before update on public.contract_templates
  for each row execute function set_updated_at();

create trigger set_contracts_updated_at
  before update on public.contracts
  for each row execute function set_updated_at();
