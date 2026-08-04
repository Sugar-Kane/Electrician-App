-- Captured from the deployed database (version 20260803183832), which had this
-- migration applied with no corresponding file in the repo.
--
-- This is the table behind /legal/{org}/privacy and /legal/{org}/terms. Reading
-- only the repo made those pages look permanently broken, since nothing here
-- created the table they query; in the deployed database they render correctly.
--
-- The slug column arrived in a later migration and is captured there. No-op
-- where the table already exists.

create table if not exists public.tenant_legal_pages (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  legal_business_name text not null,
  dba_name text,
  support_phone text not null,
  support_email text not null,
  mailing_address text not null,
  program_name text not null,
  message_frequency text not null default 'up to 8 messages per service appointment',
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_tenant_legal_pages_updated_at on public.tenant_legal_pages;
create trigger set_tenant_legal_pages_updated_at
before update on public.tenant_legal_pages
for each row execute function public.set_updated_at();

alter table public.tenant_legal_pages enable row level security;

do $$
begin
  -- Published rows are readable by anon: a carrier reviewer vetting an A2P
  -- campaign visits these pages signed out.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tenant_legal_pages'
      and policyname = 'Anyone can read published tenant legal pages'
  ) then
    create policy "Anyone can read published tenant legal pages"
    on public.tenant_legal_pages for select
    to anon, authenticated
    using (published);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tenant_legal_pages'
      and policyname = 'Organization members can view own legal page'
  ) then
    create policy "Organization members can view own legal page"
    on public.tenant_legal_pages for select
    to authenticated
    using ((select private.is_org_member(organization_id)));

    create policy "Organization members can add legal page"
    on public.tenant_legal_pages for insert
    to authenticated
    with check ((select private.is_org_member(organization_id)));

    create policy "Organization members can update legal page"
    on public.tenant_legal_pages for update
    to authenticated
    using ((select private.is_org_member(organization_id)))
    with check ((select private.is_org_member(organization_id)));

    create policy "Organization members can delete legal page"
    on public.tenant_legal_pages for delete
    to authenticated
    using ((select private.is_org_member(organization_id)));
  end if;
end;
$$;

grant select on table public.tenant_legal_pages to anon;
grant select, insert, update, delete on table public.tenant_legal_pages to authenticated, service_role;
