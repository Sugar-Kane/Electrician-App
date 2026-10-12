-- The support console, honest about what it knows.
--
-- Three changes, all from the admin and recovery review:
--   * Working inside a business is the elevated action, so it now needs a
--     reason, and the reason is on the audit row as well as the session.
--   * Texting health reads delivery evidence from the messages themselves:
--     what was delivered, what failed and why, and when. A hand-kept "A2P
--     approved" date is not evidence either way.
--   * The activity trail can be filtered by business and action and read a page
--     at a time, rather than as the latest hundred rows.

/**
 * Open a business as one of its members, for a stated reason.
 *
 * Unchanged apart from the reason: it is required, and it is written to the
 * audit row, so "who acted inside this business and why" is answerable from
 * the trail alone.
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
  why text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not (select private.is_platform_admin()) then
    raise exception using errcode = '42501', message = 'Not a platform admin.';
  end if;

  if why is null or char_length(why) < 3 then
    raise exception using errcode = '22023', message = 'Say why you need to make changes in this business.';
  end if;

  if not exists (
    select 1 from public.organizations
    where id = p_organization_id and archived_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'No such business.';
  end if;

  perform public.admin_end_impersonation();

  select exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = actor
  ) into already_member;

  insert into public.impersonation_sessions (
    admin_user_id, organization_id, granted_membership, reason
  )
  values (actor, p_organization_id, not already_member, left(why, 200))
  returning id into session_id;

  if not already_member then
    insert into public.organization_members (organization_id, user_id, role, impersonation_session_id)
    values (p_organization_id, actor, 'admin', session_id);
  end if;

  perform private.record_admin_action(
    'impersonation.started',
    p_organization_id,
    jsonb_build_object('session', session_id, 'granted_membership', not already_member, 'reason', left(why, 200))
  );

  return session_id;
end;
$$;

revoke all on function public.admin_begin_impersonation(uuid, text) from public, anon;
grant execute on function public.admin_begin_impersonation(uuid, text) to authenticated;

/**
 * What the messages themselves say about texting, per business.
 *
 * Outbound texts only. Twilio's status callback fills status, error_code and
 * delivered_at, so this is evidence rather than configuration. Failures are
 * grouped by error code over the last week; the app turns codes into words.
 * Pass null for every business at once (the businesses list).
 */
create or replace function public.admin_messaging_evidence(p_organization_id uuid default null)
returns table (
  organization_id uuid,
  last_delivered_at timestamptz,
  last_accepted_at timestamptz,
  last_failed_at timestamptz,
  last_failed_code text,
  outbound_30d bigint,
  failed_7d bigint,
  failures_7d jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    organization.id,
    (select max(coalesce(m.delivered_at, m.updated_at)) from public.messages as m
      where m.organization_id = organization.id and m.direction = 'outbound' and m.status = 'delivered'),
    (select max(coalesce(m.sent_at, m.created_at)) from public.messages as m
      where m.organization_id = organization.id and m.direction = 'outbound'
        and m.status in ('queued', 'accepted', 'sending', 'sent') and m.provider_message_id is not null),
    (select max(m.updated_at) from public.messages as m
      where m.organization_id = organization.id and m.direction = 'outbound' and m.status in ('failed', 'undelivered')),
    (select m.error_code from public.messages as m
      where m.organization_id = organization.id and m.direction = 'outbound' and m.status in ('failed', 'undelivered')
      order by m.updated_at desc limit 1),
    (select count(*) from public.messages as m
      where m.organization_id = organization.id and m.direction = 'outbound'
        and m.created_at > now() - interval '30 days'),
    (select count(*) from public.messages as m
      where m.organization_id = organization.id and m.direction = 'outbound'
        and m.status in ('failed', 'undelivered') and m.updated_at > now() - interval '7 days'),
    coalesce((
      select jsonb_agg(jsonb_build_object('code', grouped.code, 'count', grouped.n, 'last_at', grouped.last_at) order by grouped.n desc)
      from (
        select coalesce(m.error_code, '') as code, count(*) as n, max(m.updated_at) as last_at
        from public.messages as m
        where m.organization_id = organization.id and m.direction = 'outbound'
          and m.status in ('failed', 'undelivered') and m.updated_at > now() - interval '7 days'
        group by 1
      ) as grouped
    ), '[]'::jsonb)
  from public.organizations as organization
  where (p_organization_id is null or organization.id = p_organization_id)
    and (select private.is_platform_admin());
$$;

revoke all on function public.admin_messaging_evidence(uuid) from public, anon;
grant execute on function public.admin_messaging_evidence(uuid) to authenticated;

/**
 * The trail, a page at a time, optionally for one business or one action.
 *
 * Paged by time rather than offset, so a new entry arriving while somebody
 * reads does not shift the next page by one.
 */
create or replace function public.admin_audit_page(
  p_organization_id uuid default null,
  p_action text default null,
  p_before timestamptz default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  created_at timestamptz,
  admin_email text,
  action text,
  organization_id uuid,
  organization_name text,
  organization_timezone text,
  detail jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    entry.id,
    entry.created_at,
    users.email,
    entry.action,
    entry.organization_id,
    organization.name,
    coalesce(organization.timezone, 'America/Los_Angeles'),
    entry.detail
  from public.platform_admin_audit as entry
  left join auth.users as users on users.id = entry.admin_user_id
  left join public.organizations as organization on organization.id = entry.organization_id
  where (select private.is_platform_admin())
    and (p_organization_id is null or entry.organization_id = p_organization_id)
    and (p_action is null or entry.action = p_action)
    and (p_before is null or entry.created_at < p_before)
  order by entry.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.admin_audit_page(uuid, text, timestamptz, integer) from public, anon;
grant execute on function public.admin_audit_page(uuid, text, timestamptz, integer) to authenticated;
