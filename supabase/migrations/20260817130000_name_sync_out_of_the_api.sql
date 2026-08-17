-- Move the name sync out of the schema PostgREST publishes.
--
-- The previous migration created `sync_technician_display_name` in `public`,
-- and everything in `public` is an endpoint: it showed up immediately as
-- `/rest/v1/rpc/sync_technician_display_name`, callable by `anon`, flagged by
-- the database linter. `revoke all ... from public` did not cover it, because
-- Supabase grants execute to `anon` and `authenticated` by name rather than
-- through PUBLIC.
--
-- Calling it would have failed anyway — Postgres refuses to invoke a
-- trigger-returning function outside a trigger — so this is tidying rather than
-- a breach. But a security-definer function that writes to a table nobody is
-- allowed to write to should not be sitting on the public API waiting for
-- somebody to find a way to reach it, and `private` is where this codebase
-- already keeps that sort of thing: `private.is_org_admin` lives there and the
-- linter has never seen it.
drop trigger if exists sync_technician_display_name_on_insert on public.user_profiles;
drop trigger if exists sync_technician_display_name_on_update on public.user_profiles;
drop function if exists public.sync_technician_display_name();

create or replace function private.sync_technician_display_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.technicians
    set display_name = new.display_name
  where user_id = new.user_id
    -- A technician's name is not null, and a profile saved with a blank one
    -- would otherwise wipe the name off every schedule they appear on.
    and pg_catalog.btrim(new.display_name) <> ''
    and display_name is distinct from new.display_name;

  return null;
end;
$fn$;

revoke all on function private.sync_technician_display_name() from public;

create trigger sync_technician_display_name_on_insert
  after insert on public.user_profiles
  for each row
  execute function private.sync_technician_display_name();

create trigger sync_technician_display_name_on_update
  after update of display_name on public.user_profiles
  for each row
  when (new.display_name is distinct from old.display_name)
  execute function private.sync_technician_display_name();
