-- Security hardening from the November 2026 assessment.
--
-- 1. Two functions were still executable by the anonymous role.
--    `find_or_create_customer_by_phone` skips its membership check when there
--    is no signed-in user (the service role's case), so anyone holding the
--    public API key could create customers in any business. The migration that
--    meant to close this (20260826210000) revoked PUBLIC only; Supabase grants
--    anon separately, so the grant survived.
--    `mark_phone_deposit_paid` set a booking's deposit paid from the booking
--    token and checkout session id alone, both of which the customer holds, and
--    nothing in the app calls it any more: Stripe's webhook is what records a
--    paid deposit.
--
-- 2. Only an owner may make, change or remove an owner. The row policies on
--    organization_members and organization_invitations let any owner *or
--    admin* write, so an admin could raise themselves to owner, remove the
--    owner, or invite a new owner by calling the database directly. Owners
--    alone connect payouts (Stripe) and ChatGPT, so that was a path from admin
--    to the business's money. The app itself never offers this to an admin.
--
--    The guard only applies to signed-in callers. The service role (webhooks,
--    workers), migrations, the business's creator and a platform owner are
--    unaffected, and accepting an owner invitation still works: the
--    invitation itself can now only have come from an owner.

revoke all on function public.find_or_create_customer_by_phone(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.find_or_create_customer_by_phone(uuid, text, text, text, text, text)
  to authenticated, service_role;

revoke all on function public.mark_phone_deposit_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_phone_deposit_paid(uuid, text) to service_role;

create or replace function private.can_grant_owner(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is null
    or exists (
      select 1 from public.organizations as organization
      where organization.id = target_organization_id
        and organization.created_by = (select auth.uid())
    )
    or exists (
      select 1 from public.organization_members as membership
      where membership.organization_id = target_organization_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
    or (select private.is_platform_owner());
$$;

revoke all on function private.can_grant_owner(uuid) from public, anon;
grant execute on function private.can_grant_owner(uuid) to authenticated, service_role;

create or replace function private.guard_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_email text;
begin
  if caller is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'owner' and not (select private.can_grant_owner(new.organization_id)) then
      -- Accepting an owner invitation: the invitee joins themselves, with the
      -- role an owner invited them to.
      select lower(users.email) into caller_email from auth.users as users where users.id = caller;
      if new.user_id = caller and exists (
        select 1 from public.organization_invitations as invitation
        where invitation.organization_id = new.organization_id
          and invitation.email = caller_email
          and invitation.role = 'owner'
          and invitation.accepted_at is null
          and invitation.revoked_at is null
          and invitation.expires_at > now()
      ) then
        return new;
      end if;
      raise exception using errcode = '42501', message = 'Only an owner can add an owner.';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (old.role = 'owner' or new.role = 'owner')
      and old.role is distinct from new.role
      and not (select private.can_grant_owner(old.organization_id)) then
      raise exception using errcode = '42501', message = 'Only an owner can change an owner.';
    end if;
    if old.organization_id is distinct from new.organization_id or old.user_id is distinct from new.user_id then
      raise exception using errcode = '42501', message = 'A membership cannot be moved.';
    end if;
    return new;
  end if;

  -- DELETE
  if old.role = 'owner' and not (select private.can_grant_owner(old.organization_id)) then
    raise exception using errcode = '42501', message = 'Only an owner can remove an owner.';
  end if;
  return old;
end;
$$;

revoke all on function private.guard_owner_membership() from public, anon, authenticated;

drop trigger if exists guard_owner_membership on public.organization_members;
create trigger guard_owner_membership
  before insert or update or delete on public.organization_members
  for each row execute function private.guard_owner_membership();

create or replace function private.guard_owner_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'owner'
    and (tg_op = 'INSERT' or old.role is distinct from new.role)
    and not (select private.can_grant_owner(new.organization_id)) then
    raise exception using errcode = '42501', message = 'Only an owner can invite an owner.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_owner_invitation() from public, anon, authenticated;

drop trigger if exists guard_owner_invitation on public.organization_invitations;
create trigger guard_owner_invitation
  before insert or update on public.organization_invitations
  for each row execute function private.guard_owner_invitation();
