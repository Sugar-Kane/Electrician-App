-- Volteira's own support console needs two-step sign-in (compliance
-- SEC-001-002). From the deadline the app enforces for owners and admins
-- (MFA_REQUIRED_FROM in src/lib/mfa-policy.ts: 2026-12-10 08:00 UTC), a
-- platform admin's session counts only once it has reached aal2 (password and
-- authenticator code). Every admin_* function checks private.is_platform_admin,
-- so this covers them all. The service role has no auth.uid() and is unaffected.

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.platform_admins as admin
      where admin.user_id = (select auth.uid())
    )
    and (
      pg_catalog.now() < timestamptz '2026-12-10 08:00:00+00'
      or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
    );
$function$;
