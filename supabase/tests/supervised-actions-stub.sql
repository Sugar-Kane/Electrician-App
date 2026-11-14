-- The smallest slice of Volteira's schema that the task and supervised-action
-- migrations need, for running them against a throwaway local Postgres.
-- Never run against a real Supabase project.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create schema private;
grant usage on schema public, private, auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid());
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.organizations (id uuid primary key default gen_random_uuid(), name text);
create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'dispatcher', 'technician', 'accountant')),
  primary key (organization_id, user_id)
);
create table public.customers (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id));
create table public.jobs (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id));

create function private.is_org_member(target_organization_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.organization_members m where m.organization_id = target_organization_id and m.user_id = (select auth.uid()))
$$;
create function private.is_org_admin(target_organization_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.organization_members m where m.organization_id = target_organization_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin'))
$$;
grant execute on function private.is_org_member(uuid), private.is_org_admin(uuid) to authenticated;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  status text not null default 'open', archived_at timestamptz, assignee_type text not null default 'person',
  visibility text not null default 'workspace', created_by uuid, owner_id uuid, assistant_connection_id uuid
);
create function private.can_see_task(target_task_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks t where t.id = target_task_id and private.is_org_member(t.organization_id))
$$;
grant execute on function private.can_see_task(uuid) to authenticated;
create table public.task_work (
  id uuid primary key default gen_random_uuid(), task_id uuid references public.tasks(id), kind text, status text,
  run_at timestamptz default now(), lease_until timestamptz, claimed_at timestamptz, attempts integer default 0,
  finished_at timestamptz, last_error text
);
create table public.task_series (id uuid primary key default gen_random_uuid(), active boolean, next_date date);
grant select on all tables in schema public to authenticated;
alter default privileges in schema public grant select on tables to authenticated;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
