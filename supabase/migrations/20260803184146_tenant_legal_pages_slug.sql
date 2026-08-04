-- Captured from the deployed database (version 20260803184146), which had this
-- migration applied with no corresponding file in the repo.
--
-- Denormalizes organizations.slug onto tenant_legal_pages so the public legal
-- pages can resolve a tenant: public.organizations is member-scoped by RLS and
-- invisible to anon, so a signed-out reviewer cannot look a slug up there.
--
-- No-op where the column already exists.

alter table public.tenant_legal_pages
  add column if not exists slug text;

update public.tenant_legal_pages as legal_page
set slug = organization.slug
from public.organizations as organization
where organization.id = legal_page.organization_id
  and legal_page.slug is null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tenant_legal_pages'
      and column_name = 'slug' and is_nullable = 'YES'
  ) then
    alter table public.tenant_legal_pages alter column slug set not null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'tenant_legal_pages_slug_key'
  ) then
    alter table public.tenant_legal_pages add constraint tenant_legal_pages_slug_key unique (slug);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'tenant_legal_pages_slug_format'
  ) then
    alter table public.tenant_legal_pages add constraint tenant_legal_pages_slug_format
      check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
  end if;
end;
$$;

create index if not exists tenant_legal_pages_slug_idx on public.tenant_legal_pages(slug);

-- Captured as found. Note this function exists in the deployed database with no
-- trigger attached to it, so renaming an organization never actually moved its
-- legal slug there. The A2P remediation migration
-- (20260804191500_tenant_legal_pages_and_sms_consent.sql) supersedes it with
-- public.sync_tenant_legal_page_slug plus a bind trigger that derives the slug
-- on every write; this one is kept only so the repo matches the deployed state.
create or replace function public.sync_tenant_legal_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tenant_legal_pages set slug = new.slug, updated_at = now()
  where organization_id = new.id and slug is distinct from new.slug;
  return new;
end;
$$;

revoke all on function public.sync_tenant_legal_slug() from public, anon, authenticated;
