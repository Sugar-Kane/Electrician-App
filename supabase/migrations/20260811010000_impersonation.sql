-- Working inside somebody else's business, on purpose and on the record.
--
-- The support console can read across every tenant, but reading is not enough
-- to fix an electrician's problem for them. What is wanted is to open their
-- business and act in it.
--
-- The tempting implementation is to teach RLS about platform admins. That was
-- rejected when the console was built and is rejected again here, for the same
-- reason: it widens forty policies forever and one missed clause is a silent
-- hole. Instead an impersonation session grants a real, temporary membership.
-- Every existing policy then works unchanged, because from the database's point
-- of view this is simply a member — one that expires.
--
-- Two consequences worth stating, both deliberate:
--   * Actions are attributed to the admin's own user id, not the owner's. The
--     activity trail should never claim Nick did something Nick did not do.
--   * The grant is time-boxed and swept, so forgetting to press Stop does not
--     leave a permanent way in.

create table if not exists public.impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Null when the admin was already a member: nothing was granted, so nothing
  -- is taken away at the end.
  granted_membership boolean not null default false,
  reason text,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 minutes',
  ended_at timestamptz
);

create index if not exists impersonation_sessions_live_idx
  on public.impersonation_sessions(admin_user_id, organization_id)
  where ended_at is null;

alter table public.impersonation_sessions enable row level security;

drop policy if exists "Admins can see impersonation sessions" on public.impersonation_sessions;
create policy "Admins can see impersonation sessions"
on public.impersonation_sessions for select
to authenticated
using ((select private.is_platform_admin()));

grant select on table public.impersonation_sessions to authenticated;

-- Marks a membership as belonging to an impersonation rather than to a person
-- who actually works there. Without it, ending a session could delete the real
-- membership of an admin who genuinely is a member of that business.
alter table public.organization_members
  add column if not exists impersonation_session_id uuid
  references public.impersonation_sessions(id) on delete cascade;

/**
 * Open a business as one of its members.
 *
 * Returns the session id, which the app puts in a cookie so it knows which
 * business the admin is currently acting for. An admin who is already a member
 * gets a session with nothing granted — they could already act there, and
 * pretending otherwise would mean deleting their real membership at the end.
 */
create or replace function public.admin_begin_impersonation(
  p_organization_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  already_member boolean;
  session_id uuid;
begin
  if not (select private.is_platform_admin()) then
    raise exception using errcode = '42501', message = 'Not a platform admin.';
  end if;

  if not exists (
    select 1 from public.organizations
    where id = p_organization_id and archived_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'No such business.';
  end if;

  -- Close anything still open for this admin, so there is only ever one
  -- business being acted for and no grant is orphaned by a second Start.
  perform public.admin_end_impersonation();

  select exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = actor
  ) into already_member;

  insert into public.impersonation_sessions (
    admin_user_id, organization_id, granted_membership, reason
  )
  values (actor, p_organization_id, not already_member, nullif(trim(p_reason), ''))
  returning id into session_id;

  if not already_member then
    insert into public.organization_members (organization_id, user_id, role, impersonation_session_id)
    values (p_organization_id, actor, 'admin', session_id);
  end if;

  perform private.record_admin_action(
    'impersonation.started',
    p_organization_id,
    jsonb_build_object('session', session_id, 'granted_membership', not already_member)
  );

  return session_id;
end;
$$;

revoke all on function public.admin_begin_impersonation(uuid, text) from public, anon;
grant execute on function public.admin_begin_impersonation(uuid, text) to authenticated;

/**
 * Hand the business back.
 *
 * Safe to call when nothing is open, so the app can call it on sign-out and on
 * every Start without checking first.
 */
create or replace function public.admin_end_impersonation()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  closed integer := 0;
  entry record;
begin
  if actor is null then
    return 0;
  end if;

  for entry in
    select * from public.impersonation_sessions
    where admin_user_id = actor and ended_at is null
  loop
    -- Only the membership this session created. An admin who genuinely works
    -- at the business keeps theirs.
    delete from public.organization_members
    where impersonation_session_id = entry.id;

    update public.impersonation_sessions
    set ended_at = now()
    where id = entry.id;

    perform private.record_admin_action(
      'impersonation.ended',
      entry.organization_id,
      jsonb_build_object('session', entry.id)
    );

    closed := closed + 1;
  end loop;

  return closed;
end;
$$;

revoke all on function public.admin_end_impersonation() from public, anon;
grant execute on function public.admin_end_impersonation() to authenticated;

/**
 * Which business this admin is currently acting for, if any.
 *
 * Expiry is enforced on read rather than by a scheduled job: a session past its
 * hour reports as nothing, so a forgotten tab cannot keep acting. The granted
 * membership is swept by the function below.
 */
create or replace function public.my_impersonation()
returns table (session_id uuid, organization_id uuid, organization_name text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select session.id, session.organization_id, organization.name, session.expires_at
  from public.impersonation_sessions as session
  join public.organizations as organization on organization.id = session.organization_id
  where session.admin_user_id = (select auth.uid())
    and session.ended_at is null
    and session.expires_at > now()
  order by session.started_at desc
  limit 1;
$$;

revoke all on function public.my_impersonation() from public, anon;
grant execute on function public.my_impersonation() to authenticated;

/**
 * Remove memberships whose session has run out.
 *
 * Called opportunistically by the app rather than scheduled, because the only
 * thing that matters is that an expired grant cannot be used, and a grant is
 * only usable when somebody is making requests.
 */
create or replace function public.sweep_expired_impersonations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  swept integer := 0;
begin
  with expired as (
    select id, organization_id from public.impersonation_sessions
    where ended_at is null and expires_at <= now()
  ),
  removed as (
    delete from public.organization_members
    where impersonation_session_id in (select id from expired)
    returning 1
  )
  update public.impersonation_sessions
  set ended_at = now()
  where id in (select id from expired);

  get diagnostics swept = row_count;
  return swept;
end;
$$;

revoke all on function public.sweep_expired_impersonations() from public, anon;
grant execute on function public.sweep_expired_impersonations() to authenticated, service_role;
