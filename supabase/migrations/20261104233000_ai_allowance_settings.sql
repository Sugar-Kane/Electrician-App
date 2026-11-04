-- Who decides how much built-in AI a business gets: the platform, from the
-- admin console, not the business.
--
-- Two settings, both changed only by a platform owner through the functions
-- below, each change written to the admin audit log:
--
-- - platform_settings.ai_default_monthly_limit: the monthly allowance every
--   business gets unless it has its own. Null means the deployment's default.
-- - organization_ai_allowances: one business's own allowance, a number of uses
--   a month or unlimited.
--
-- A business on the paid plan gets unlimited built-in AI; that is read from
-- organization_subscriptions, not stored here. Kept out of `organizations`
-- because a business's own admins can update that table, and must not be
-- able to raise their own allowance.

create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  ai_default_monthly_limit integer check (ai_default_monthly_limit is null or ai_default_monthly_limit >= 0),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
grant select on public.platform_settings to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'platform_settings'
      and policyname = 'Platform admins can view platform settings'
  ) then
    create policy "Platform admins can view platform settings"
      on public.platform_settings for select to authenticated
      using ((select private.is_platform_admin()));
  end if;
end
$$;

create table if not exists public.organization_ai_allowances (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  monthly_limit integer check (monthly_limit is null or monthly_limit >= 0),
  unlimited boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.organization_ai_allowances enable row level security;
revoke all on public.organization_ai_allowances from anon, authenticated;
grant select on public.organization_ai_allowances to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'organization_ai_allowances'
      and policyname = 'Members and platform admins can view the AI allowance'
  ) then
    create policy "Members and platform admins can view the AI allowance"
      on public.organization_ai_allowances for select to authenticated
      using ((select private.is_org_member(organization_id)) or (select private.is_platform_admin()));
  end if;
end
$$;

-- Platform admins can see every business's AI use, for the console.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_usage'
      and policyname = 'Platform admins can view AI usage'
  ) then
    create policy "Platform admins can view AI usage"
      on public.ai_usage for select to authenticated
      using ((select private.is_platform_admin()));
  end if;
end
$$;

/** Set one business's allowance: a number of uses a month, unlimited, or back to the default (both null/false). */
create or replace function public.admin_set_ai_allowance(
  p_organization_id uuid,
  p_monthly_limit integer,
  p_unlimited boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  why text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not (select private.is_platform_owner()) then
    raise exception using errcode = '42501', message = 'Only a platform owner can change AI allowances.';
  end if;
  if why is null or char_length(why) < 3 then
    raise exception using errcode = '22023', message = 'Say why the allowance is changing.';
  end if;
  if p_monthly_limit is not null and p_monthly_limit < 0 then
    raise exception using errcode = '22023', message = 'An allowance cannot be negative.';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception using errcode = 'P0002', message = 'No such business.';
  end if;

  insert into public.organization_ai_allowances (organization_id, monthly_limit, unlimited, updated_by, updated_at)
  values (p_organization_id, p_monthly_limit, coalesce(p_unlimited, false), (select auth.uid()), now())
  on conflict (organization_id) do update
    set monthly_limit = excluded.monthly_limit,
        unlimited = excluded.unlimited,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into public.platform_admin_audit (admin_user_id, action, organization_id, detail)
  values (
    (select auth.uid()),
    'ai_allowance.changed',
    p_organization_id,
    jsonb_build_object('monthly_limit', p_monthly_limit, 'unlimited', coalesce(p_unlimited, false), 'reason', left(why, 200))
  );
end;
$$;

revoke all on function public.admin_set_ai_allowance(uuid, integer, boolean, text) from public, anon;
grant execute on function public.admin_set_ai_allowance(uuid, integer, boolean, text) to authenticated;

/** Set the allowance every business gets unless it has its own. Null goes back to the deployment's default. */
create or replace function public.admin_set_ai_default_limit(
  p_limit integer,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  why text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not (select private.is_platform_owner()) then
    raise exception using errcode = '42501', message = 'Only a platform owner can change AI allowances.';
  end if;
  if why is null or char_length(why) < 3 then
    raise exception using errcode = '22023', message = 'Say why the allowance is changing.';
  end if;
  if p_limit is not null and p_limit < 0 then
    raise exception using errcode = '22023', message = 'An allowance cannot be negative.';
  end if;

  insert into public.platform_settings (id, ai_default_monthly_limit, updated_by, updated_at)
  values (true, p_limit, (select auth.uid()), now())
  on conflict (id) do update
    set ai_default_monthly_limit = excluded.ai_default_monthly_limit,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into public.platform_admin_audit (admin_user_id, action, organization_id, detail)
  values (
    (select auth.uid()),
    'ai_default_limit.changed',
    null,
    jsonb_build_object('monthly_limit', p_limit, 'reason', left(why, 200))
  );
end;
$$;

revoke all on function public.admin_set_ai_default_limit(integer, text) from public, anon;
grant execute on function public.admin_set_ai_default_limit(integer, text) to authenticated;
