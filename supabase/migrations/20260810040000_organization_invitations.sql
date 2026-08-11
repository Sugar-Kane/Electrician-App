-- Letting an electrician bring someone into their business.
--
-- Until now the only way to exist in an organization was to have created it.
-- Anyone else who signed up landed on onboarding and made a *second* business,
-- which is the worst possible outcome: they see an empty app, the phone number
-- and the booking agent still point at the first organization, and nobody can
-- tell why the work is invisible.
--
-- An invitation is a row, not a link with a business id in it. The token is the
-- only thing the recipient holds, and it says nothing on its own.

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Stored lowercased so an invite to Nick@ is answered by nick@.
  email text not null check (email = lower(email) and email like '%_@_%._%'),
  role text not null check (role in ('owner', 'admin', 'dispatcher', 'technician', 'accountant')),
  token uuid not null default gen_random_uuid() unique,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Long enough for somebody who reads email once a week, short enough that a
  -- forgotten invite in an old inbox is not a permanent way in.
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz
);

-- One live invitation per person per business. Re-inviting somebody should
-- replace the pending invite rather than leave two valid tokens in the world.
create unique index if not exists organization_invitations_pending_idx
  on public.organization_invitations(organization_id, email)
  where accepted_at is null and revoked_at is null;

create index if not exists organization_invitations_email_idx
  on public.organization_invitations(email)
  where accepted_at is null and revoked_at is null;

alter table public.organization_invitations enable row level security;

-- Only the people who can already manage members can see or send invitations.
-- Nothing here is readable by the recipient through the table itself; they go
-- through the token functions below, which is what keeps a business's roster
-- from being enumerable by anyone holding one link.
drop policy if exists "Managers can view invitations" on public.organization_invitations;
create policy "Managers can view invitations"
on public.organization_invitations for select
to authenticated
using ((select private.can_manage_members(organization_id)));

drop policy if exists "Managers can send invitations" on public.organization_invitations;
create policy "Managers can send invitations"
on public.organization_invitations for insert
to authenticated
with check ((select private.can_manage_members(organization_id)));

drop policy if exists "Managers can revoke invitations" on public.organization_invitations;
create policy "Managers can revoke invitations"
on public.organization_invitations for update
to authenticated
using ((select private.can_manage_members(organization_id)))
with check ((select private.can_manage_members(organization_id)));

grant select, insert, update on table public.organization_invitations to authenticated;
grant select, insert, update on table public.organization_invitations to service_role;

/**
 * What an invitation link says before anyone signs in.
 *
 * Deliberately thin: the business name, the address it was sent to, and the
 * role. Enough to render "Join Pacific Plains Electric" and for the recipient
 * to see which of their addresses to use — and nothing about the business's
 * customers, staff, or work.
 */
create or replace function public.organization_invitation_preview(p_token uuid)
returns table (
  organization_name text,
  email text,
  role text,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    organization.name,
    invitation.email,
    invitation.role,
    case
      when invitation.revoked_at is not null then 'revoked'
      when invitation.accepted_at is not null then 'accepted'
      when invitation.expires_at <= now() then 'expired'
      else 'pending'
    end
  from public.organization_invitations as invitation
  join public.organizations as organization
    on organization.id = invitation.organization_id
  where invitation.token = p_token
    and organization.archived_at is null
  limit 1;
$$;

revoke all on function public.organization_invitation_preview(uuid) from public;
grant execute on function public.organization_invitation_preview(uuid) to anon, authenticated;

/**
 * Joining a business you were invited to.
 *
 * Two things must both be true: you hold the token, and you are signed in as
 * the address it was sent to. The token alone is not enough on purpose — an
 * invitation gets forwarded, quoted in a reply, and left in an inbox that
 * outlives the person, and any of those should not hand over a business's
 * customer list. Requiring a confirmed address means a leaked link is useless
 * to whoever leaked it to.
 *
 * Returns a word rather than raising, because every outcome here is something
 * the page has to explain to a person rather than an error to log.
 */
create or replace function public.accept_organization_invitation(p_token uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.organization_invitations;
  actor uuid := (select auth.uid());
  actor_email text;
  actor_confirmed timestamptz;
begin
  if actor is null then
    return 'signed_out';
  end if;

  select lower(users.email), users.email_confirmed_at
  into actor_email, actor_confirmed
  from auth.users as users
  where users.id = actor;

  -- Lock the row: two taps on the same link must not create two memberships.
  select * into invitation
  from public.organization_invitations as candidate
  where candidate.token = p_token
  for update;

  if not found then
    return 'invalid';
  end if;

  if invitation.revoked_at is not null then
    return 'revoked';
  end if;

  if invitation.accepted_at is not null then
    -- Already used. If it was this person, say so kindly rather than refusing.
    if invitation.accepted_by = actor then
      return 'already_member';
    end if;
    return 'accepted';
  end if;

  if invitation.expires_at <= now() then
    return 'expired';
  end if;

  if actor_email is null or actor_email is distinct from invitation.email then
    return 'wrong_email';
  end if;

  if actor_confirmed is null then
    return 'unconfirmed_email';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (invitation.organization_id, actor, invitation.role)
  on conflict (organization_id, user_id) do nothing;

  update public.organization_invitations
  set accepted_at = now(), accepted_by = actor
  where id = invitation.id;

  return 'joined';
end;
$$;

revoke all on function public.accept_organization_invitation(uuid) from public;
grant execute on function public.accept_organization_invitation(uuid) to authenticated;

/**
 * Whether this signed-in person has been invited anywhere.
 *
 * Onboarding asks before it offers to create a business, so somebody who was
 * invited is sent to the invitation instead of building a duplicate company
 * next door to the one that already has their work in it.
 */
create or replace function public.pending_invitation_for_me()
returns table (token uuid, organization_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select invitation.token, organization.name
  from public.organization_invitations as invitation
  join public.organizations as organization
    on organization.id = invitation.organization_id
  join auth.users as users
    on users.id = (select auth.uid())
  where invitation.email = lower(users.email)
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and invitation.expires_at > now()
    and organization.archived_at is null
  order by invitation.created_at desc
  limit 1;
$$;

revoke all on function public.pending_invitation_for_me() from public;
grant execute on function public.pending_invitation_for_me() to authenticated;

/**
 * The roster, for the page that manages it.
 *
 * organization_members holds user ids; the names and addresses live in
 * auth.users, which is not readable from the client. This joins them for
 * somebody who already manages the business, and refuses everyone else.
 */
create or replace function public.organization_roster(p_organization_id uuid)
returns table (
  user_id uuid,
  email text,
  full_name text,
  role text,
  joined_at timestamptz,
  is_me boolean
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
    membership.user_id = (select auth.uid())
  from public.organization_members as membership
  join auth.users as users
    on users.id = membership.user_id
  where membership.organization_id = p_organization_id
    and (select private.can_manage_members(p_organization_id))
  order by membership.created_at;
$$;

revoke all on function public.organization_roster(uuid) from public;
grant execute on function public.organization_roster(uuid) to authenticated;
