-- Minimal stand-in for the parts of Supabase the role-guard migration touches.
-- For a disposable local database only.

do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create schema if not exists private;

create table auth.users (id uuid primary key, email text);
-- auth.uid() reads a session setting the test sets per caller.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

create function private.is_platform_owner() returns boolean language sql stable as $$ select false $$;

create table public.organizations (id uuid primary key, created_by uuid);
create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  role text not null,
  primary key (organization_id, user_id)
);
create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null,
  invited_by uuid,
  accepted_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days'
);

create function public.find_or_create_customer_by_phone(p_organization_id uuid, p_phone text, p_first_name text, p_last_name text default null, p_preferred_contact text default 'sms', p_notes text default null)
returns uuid language sql security definer as $$ select null::uuid $$;
grant execute on function public.find_or_create_customer_by_phone(uuid, text, text, text, text, text) to anon, authenticated, service_role;

create function public.mark_phone_deposit_paid(p_token uuid, p_checkout_session_id text)
returns boolean language sql security definer as $$ select false $$;
grant execute on function public.mark_phone_deposit_paid(uuid, text) to anon, authenticated, service_role;
