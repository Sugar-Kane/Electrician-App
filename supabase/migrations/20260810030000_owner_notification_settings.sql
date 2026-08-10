-- Where a booking alert goes, per business rather than per deployment.
--
-- The owner's email and phone were read from environment variables, which is
-- one value for the whole installation. With one tenant that is invisible. With
-- two it is a bug you find out about from the wrong electrician: every booking
-- taken for anybody would page the same person, and the second business would
-- never hear about its own work.
--
-- Nullable on purpose. An organization that has not set these falls back to the
-- deployment's variables, so the tenant already running does not go quiet the
-- moment this ships.

alter table public.organizations
  add column if not exists owner_notification_email text;

alter table public.organizations
  add column if not exists owner_notification_phone text;

-- Cheap sanity, not validation: an address with no @ is a typo, and refusing it
-- at the door beats discovering it when a booking fails to arrive.
alter table public.organizations
  drop constraint if exists organizations_owner_notification_email_check;
alter table public.organizations
  add constraint organizations_owner_notification_email_check
  check (
    owner_notification_email is null
    or (owner_notification_email like '%_@_%._%' and length(owner_notification_email) <= 254)
  );

alter table public.organizations
  drop constraint if exists organizations_owner_notification_phone_check;
alter table public.organizations
  add constraint organizations_owner_notification_phone_check
  check (owner_notification_phone is null or length(owner_notification_phone) between 7 and 30);

comment on column public.organizations.owner_notification_email is
  'Where this business is emailed when a booking lands. Falls back to OWNER_NOTIFICATION_EMAIL.';
comment on column public.organizations.owner_notification_phone is
  'Where this business is texted when a booking lands. Falls back to OWNER_NOTIFICATION_PHONE, then ESCALATION_PHONE_NUMBER.';
