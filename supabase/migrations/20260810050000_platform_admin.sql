-- Someone who can see across every business, to help when one of them is stuck.
--
-- The obvious way to build this is to add "or is a platform admin" to every RLS
-- policy in the schema. That is rejected on purpose. It would permanently widen
-- around forty policies, every future policy would have to remember to do the
-- same, and one missed `or` is a silent hole nobody notices until it matters.
--
-- Instead the tenant policies are left exactly as they are, and support reads
-- through a small number of security-definer functions that check platform
-- admin themselves. The surface is a list you can read in one sitting, and
-- anything not on that list is not reachable — which is the property that
-- actually keeps this safe as the schema grows.
--
-- Nothing here can be granted from the app. There is no insert policy on
-- platform_admins at all, so becoming one requires database access. An admin
-- account that gets phished cannot mint more of itself.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null,
  note text
);

alter table public.platform_admins enable row level security;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.platform_admins as admin
      where admin.user_id = (select auth.uid())
    );
$$;

revoke all on function private.is_platform_admin() from public, anon;
grant execute on function private.is_platform_admin() to authenticated;

-- Readable only by admins, and writable by nobody through the API.
drop policy if exists "Admins can see the admin list" on public.platform_admins;
create policy "Admins can see the admin list"
on public.platform_admins for select
to authenticated
using ((select private.is_platform_admin()));

grant select on table public.platform_admins to authenticated;

/**
 * What an admin did, and whose business it was done to.
 *
 * Looking inside somebody else's customer records is a real act, not a neutral
 * one — the rows hold names, addresses, and phone numbers of people who never
 * agreed to be seen by the platform. Opening a business's diagnostics and
 * sending an invitation both leave a row here.
 *
 * Listing businesses does not, deliberately: an audit trail that fills with
 * navigation is one nobody reads, and the point is to be able to answer "who
 * looked at this customer's address, and when".
 */
create table if not exists public.platform_admin_audit (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_admin_audit_created_idx
  on public.platform_admin_audit(created_at desc);
create index if not exists platform_admin_audit_org_idx
  on public.platform_admin_audit(organization_id, created_at desc);

alter table public.platform_admin_audit enable row level security;

drop policy if exists "Admins can read the audit trail" on public.platform_admin_audit;
create policy "Admins can read the audit trail"
on public.platform_admin_audit for select
to authenticated
using ((select private.is_platform_admin()));

grant select on table public.platform_admin_audit to authenticated;

create or replace function private.record_admin_action(
  p_action text,
  p_organization_id uuid,
  p_detail jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.platform_admin_audit (admin_user_id, action, organization_id, detail)
  values ((select auth.uid()), p_action, p_organization_id, coalesce(p_detail, '{}'::jsonb));
$$;

revoke all on function private.record_admin_action(text, uuid, jsonb) from public, anon, authenticated;

/** Whether the person asking is an admin. The one thing the UI needs first. */
create or replace function public.am_i_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select private.is_platform_admin()), false);
$$;

revoke all on function public.am_i_platform_admin() from public, anon;
grant execute on function public.am_i_platform_admin() to authenticated;

/**
 * Every business on the platform, with the numbers that say whether it is
 * actually working.
 *
 * Chosen for triage rather than completeness: an electrician who calls to say
 * "it isn't doing anything" is almost always missing one of these — no
 * messaging service, no A2P approval, no booking alert address, or no bookings
 * arriving at all.
 */
create or replace function public.admin_organizations()
returns table (
  organization_id uuid,
  name text,
  slug text,
  phone text,
  city text,
  state text,
  timezone text,
  created_at timestamptz,
  archived boolean,
  member_count bigint,
  pending_invitations bigint,
  job_count bigint,
  booking_count bigint,
  last_booking_at timestamptz,
  owner_notification_email text,
  owner_notification_phone text,
  messaging_service_sid text,
  a2p_registered boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    organization.id,
    organization.name,
    organization.slug,
    organization.phone,
    organization.base_city,
    organization.base_state,
    coalesce(organization.timezone, 'America/Los_Angeles'),
    organization.created_at,
    organization.archived_at is not null,
    (select count(*) from public.organization_members as m where m.organization_id = organization.id),
    (select count(*) from public.organization_invitations as i
      where i.organization_id = organization.id
        and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()),
    (select count(*) from public.jobs as j where j.organization_id = organization.id),
    (select count(*) from public.sms_booking_requests as b where b.organization_id = organization.id),
    (select max(b.created_at) from public.sms_booking_requests as b where b.organization_id = organization.id),
    organization.owner_notification_email,
    organization.owner_notification_phone,
    messaging.messaging_service_sid,
    messaging.a2p_registered_at is not null
  from public.organizations as organization
  left join public.messaging_settings as messaging
    on messaging.organization_id = organization.id
  where (select private.is_platform_admin())
  order by organization.created_at desc;
$$;

revoke all on function public.admin_organizations() from public, anon;
grant execute on function public.admin_organizations() to authenticated;

/**
 * Everyone with an account, and which business they are in.
 *
 * The support question this answers is "they say they signed up and cannot see
 * anything" — which is nearly always an account with no membership, or a
 * membership in a business they did not mean to create.
 */
create or replace function public.admin_users()
returns table (
  user_id uuid,
  email text,
  full_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed boolean,
  is_platform_admin boolean,
  organization_id uuid,
  organization_name text,
  role text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    users.id,
    users.email,
    coalesce(nullif(trim(users.raw_user_meta_data ->> 'full_name'), ''), ''),
    users.created_at,
    users.last_sign_in_at,
    users.email_confirmed_at is not null,
    exists (select 1 from public.platform_admins as a where a.user_id = users.id),
    membership.organization_id,
    organization.name,
    membership.role
  from auth.users as users
  left join public.organization_members as membership on membership.user_id = users.id
  left join public.organizations as organization on organization.id = membership.organization_id
  where (select private.is_platform_admin())
  order by users.created_at desc;
$$;

revoke all on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;

/**
 * One business, in enough detail to work out why it is unhappy.
 *
 * This is the call that records an audit row, because it is the one that
 * reaches configuration belonging to a specific electrician.
 */
create or replace function public.admin_organization_detail(p_organization_id uuid)
returns table (
  organization_id uuid,
  name text,
  slug text,
  phone text,
  address text,
  city text,
  state text,
  postal_code text,
  timezone text,
  created_at timestamptz,
  archived boolean,
  owner_notification_email text,
  owner_notification_phone text,
  diagnostic_fee_cents integer,
  diagnostic_minutes integer,
  business_hours jsonb,
  messaging_service_sid text,
  messaging_phone text,
  a2p_registered_at timestamptz,
  a2p_campaign_id text,
  legal_published boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    return;
  end if;

  -- A stable function cannot write, so the audit row is written by the caller
  -- through admin_open_organization. This one only reads.
  return query
  select
    organization.id,
    organization.name,
    organization.slug,
    organization.phone,
    organization.base_address_line_1,
    organization.base_city,
    organization.base_state,
    organization.base_postal_code,
    coalesce(organization.timezone, 'America/Los_Angeles'),
    organization.created_at,
    organization.archived_at is not null,
    organization.owner_notification_email,
    organization.owner_notification_phone,
    settings.diagnostic_fee_cents,
    settings.diagnostic_minutes,
    settings.business_hours,
    messaging.messaging_service_sid,
    messaging.messaging_phone,
    messaging.a2p_registered_at,
    messaging.a2p_campaign_id,
    coalesce(legal.published, false)
  from public.organizations as organization
  left join public.service_settings as settings on settings.organization_id = organization.id
  left join public.messaging_settings as messaging on messaging.organization_id = organization.id
  left join public.tenant_legal_pages as legal on legal.organization_id = organization.id
  where organization.id = p_organization_id;
end;
$$;

revoke all on function public.admin_organization_detail(uuid) from public, anon;
grant execute on function public.admin_organization_detail(uuid) to authenticated;

/** Records that an admin opened a business's records. Called once per view. */
create or replace function public.admin_open_organization(p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    return false;
  end if;

  perform private.record_admin_action('organization.viewed', p_organization_id, '{}'::jsonb);
  return true;
end;
$$;

revoke all on function public.admin_open_organization(uuid) from public, anon;
grant execute on function public.admin_open_organization(uuid) to authenticated;

/** Who is in one business, for the "they cannot sign in" question. */
create or replace function public.admin_organization_members(p_organization_id uuid)
returns table (
  user_id uuid,
  email text,
  full_name text,
  role text,
  joined_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    membership.user_id,
    users.email,
    coalesce(nullif(trim(users.raw_user_meta_data ->> 'full_name'), ''), ''),
    membership.role,
    membership.created_at,
    users.last_sign_in_at,
    users.email_confirmed_at is not null
  from public.organization_members as membership
  join auth.users as users on users.id = membership.user_id
  where membership.organization_id = p_organization_id
    and (select private.is_platform_admin())
  order by membership.created_at;
$$;

revoke all on function public.admin_organization_members(uuid) from public, anon;
grant execute on function public.admin_organization_members(uuid) to authenticated;

/**
 * The last bookings a business took, with what happened to each notification.
 *
 * This is the single most useful support view: "did the booking land, and was
 * anybody actually told" is the question that gets asked, and notification_results
 * is the only place that answers it honestly.
 */
create or replace function public.admin_recent_bookings(
  p_organization_id uuid,
  p_limit integer default 20
)
returns table (
  booking_id uuid,
  created_at timestamptz,
  status text,
  intent text,
  contact_name text,
  phone text,
  email text,
  description text,
  arrival_window_start timestamptz,
  arrival_window_end timestamptz,
  intake_answer_count integer,
  created_job_id uuid,
  notification_results jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    request.id,
    request.created_at,
    request.status,
    request.intent,
    request.contact_name,
    request.phone,
    request.email,
    left(coalesce(request.description, ''), 300),
    request.arrival_window_start,
    request.arrival_window_end,
    coalesce(jsonb_array_length(request.intake_answers), 0),
    request.created_job_id,
    request.notification_results
  from public.sms_booking_requests as request
  where request.organization_id = p_organization_id
    and (select private.is_platform_admin())
  order by request.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

revoke all on function public.admin_recent_bookings(uuid, integer) from public, anon;
grant execute on function public.admin_recent_bookings(uuid, integer) to authenticated;

/**
 * What the voice agent actually asked this app for.
 *
 * Every hour lost to the phone assistant so far has been answered by this
 * table rather than by reasoning: whether the model connected at all, which
 * tool it called, and what the server said back.
 */
create or replace function public.admin_mcp_calls(
  p_organization_id uuid,
  p_limit integer default 40
)
returns table (
  id uuid,
  created_at timestamptz,
  method text,
  tool_name text,
  is_error boolean,
  http_status integer,
  duration_ms integer,
  arguments jsonb,
  result_text text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    entry.id,
    entry.created_at,
    entry.method,
    entry.tool_name,
    entry.is_error,
    entry.http_status,
    entry.duration_ms,
    entry.arguments,
    left(coalesce(entry.result_text, ''), 2000)
  from public.mcp_call_log as entry
  where (entry.organization_id = p_organization_id or p_organization_id is null)
    and (select private.is_platform_admin())
  order by entry.created_at desc
  limit greatest(1, least(coalesce(p_limit, 40), 200));
$$;

revoke all on function public.admin_mcp_calls(uuid, integer) from public, anon;
grant execute on function public.admin_mcp_calls(uuid, integer) to authenticated;

/**
 * Inviting somebody into any business, as the platform rather than as a member.
 *
 * The ordinary invite path requires being an owner or admin of that business,
 * which is exactly right for tenants and useless for support — the common case
 * is an electrician who cannot get in at all, so there is nobody on the inside
 * to send it.
 *
 * Returns the token so the console can show the link, because the most common
 * reason support is involved at all is that email is not reaching them.
 */
create or replace function public.admin_invite_to_organization(
  p_organization_id uuid,
  p_email text,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := lower(trim(p_email));
  new_token uuid;
begin
  if not (select private.is_platform_admin()) then
    raise exception using errcode = '42501', message = 'Not a platform admin.';
  end if;

  if normalized !~ '^[^@[:space:]]+@[^@.[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception using errcode = '22023', message = 'That is not an email address.';
  end if;

  if p_role not in ('owner', 'admin', 'dispatcher', 'technician', 'accountant') then
    raise exception using errcode = '22023', message = 'Unknown role.';
  end if;

  -- Replace any live invitation, so the newest link is the one that works.
  update public.organization_invitations
  set revoked_at = now()
  where organization_id = p_organization_id
    and email = normalized
    and accepted_at is null
    and revoked_at is null;

  insert into public.organization_invitations (organization_id, email, role, invited_by)
  values (p_organization_id, normalized, p_role, (select auth.uid()))
  returning token into new_token;

  perform private.record_admin_action(
    'invitation.sent',
    p_organization_id,
    jsonb_build_object('email', normalized, 'role', p_role)
  );

  return new_token;
end;
$$;

revoke all on function public.admin_invite_to_organization(uuid, text, text) from public, anon;
grant execute on function public.admin_invite_to_organization(uuid, text, text) to authenticated;

/** The trail itself, most recent first. */
create or replace function public.admin_audit_trail(p_limit integer default 100)
returns table (
  id uuid,
  created_at timestamptz,
  admin_email text,
  action text,
  organization_id uuid,
  organization_name text,
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
    entry.detail
  from public.platform_admin_audit as entry
  left join auth.users as users on users.id = entry.admin_user_id
  left join public.organizations as organization on organization.id = entry.organization_id
  where (select private.is_platform_admin())
  order by entry.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.admin_audit_trail(integer) from public, anon;
grant execute on function public.admin_audit_trail(integer) to authenticated;

-- The first admin. Granted by id rather than by address so that changing the
-- email on the account later does not silently change who holds this.
insert into public.platform_admins (user_id, note)
select id, 'Founding platform administrator.'
from auth.users
where lower(email) = 'adamkane13.ak@gmail.com'
on conflict (user_id) do nothing;
