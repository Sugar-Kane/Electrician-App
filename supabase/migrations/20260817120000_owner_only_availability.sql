-- Availability is the owner's to set, and now the database says so too.
--
-- Every control on the Electricians page — who is working, when they work, when
-- the business is open, when it is shut — checks `canManage` in its server
-- action and then writes through policies that only ask `is_org_member`. So the
-- rule held for anybody using the screen and not for anybody using the API with
-- their own perfectly valid session. An apprentice could reopen Christmas.
--
-- `technician_hours` already got this right when it was added: member read,
-- admin write, and nothing else. This applies the same shape to the three
-- tables that were missed. Reads stay open to the whole business, because a
-- technician looking at the schedule needs to know why a colleague has no jobs
-- on a Friday.

-- The business's own hours, fee and diagnostic length.
drop policy if exists "Organization members can add service_settings" on public.service_settings;
drop policy if exists "Organization members can update service_settings" on public.service_settings;
drop policy if exists "Organization members can delete service_settings" on public.service_settings;

create policy service_settings_admin_write on public.service_settings
  for all using ((select private.is_org_admin(organization_id)))
  with check ((select private.is_org_admin(organization_id)));

-- Time off, and the whole-business closures that share the table.
drop policy if exists "Organization members can add blackout_periods" on public.blackout_periods;
drop policy if exists "Organization members can update blackout_periods" on public.blackout_periods;
drop policy if exists "Organization members can delete blackout_periods" on public.blackout_periods;

create policy blackout_periods_admin_write on public.blackout_periods
  for all using ((select private.is_org_admin(organization_id)))
  with check ((select private.is_org_admin(organization_id)));

-- The crew itself, where `is_active` decides who the booking page offers.
drop policy if exists "Organization members can add technicians" on public.technicians;
drop policy if exists "Organization members can update technicians" on public.technicians;
drop policy if exists "Organization members can delete technicians" on public.technicians;

create policy technicians_admin_write on public.technicians
  for all using ((select private.is_org_admin(organization_id)))
  with check ((select private.is_org_admin(organization_id)));

-- The one thing that legitimately needed a member write, kept working.
--
-- Somebody correcting their own name on the account page wrote their own
-- `technicians.display_name` directly. The policy above stops that, and a
-- technician who cannot fix the spelling of their own name on the schedule is a
-- worse bug than the one being closed here.
--
-- So the name follows the profile instead. It cannot become a way in: every
-- policy on `user_profiles` is `auth.uid() = user_id`, so the only row anybody
-- can touch is their own, and the only name this can ever copy is their own.
--
-- Doing it here rather than in the application is the point. A rule that holds
-- only while every future caller remembers to make a second write is not a
-- rule, and that second write was six lines in one route handler.
create or replace function public.sync_technician_display_name()
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

revoke all on function public.sync_technician_display_name() from public;

drop trigger if exists sync_technician_display_name_on_insert on public.user_profiles;
create trigger sync_technician_display_name_on_insert
  after insert on public.user_profiles
  for each row
  execute function public.sync_technician_display_name();

drop trigger if exists sync_technician_display_name_on_update on public.user_profiles;
create trigger sync_technician_display_name_on_update
  after update of display_name on public.user_profiles
  for each row
  when (new.display_name is distinct from old.display_name)
  execute function public.sync_technician_display_name();
