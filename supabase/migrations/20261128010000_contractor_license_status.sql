-- The contractor's own CSLB license, as the owner records it from CSLB's
-- public lookup (compliance CSLB-001-002): its status, expiry, the day it was
-- last checked, and an owner's acknowledgement when it is recorded as lapsed.
-- src/lib/license-status.ts decides the warning; billing waits while a lapsed
-- license is unacknowledged.

alter table public.organizations
  add column if not exists license_status text,
  add column if not exists license_expires_on date,
  add column if not exists license_verified_on date,
  add column if not exists license_acknowledged_at timestamptz,
  add column if not exists license_acknowledged_by uuid references auth.users (id) on delete set null;

alter table public.organizations drop constraint if exists organizations_license_status_check;
alter table public.organizations add constraint organizations_license_status_check
  check (license_status is null or license_status in ('active', 'inactive', 'expired', 'suspended', 'revoked'));

comment on column public.organizations.license_verified_on is
  'The day the owner last checked the license on CSLB''s lookup. Older than 90 days shows a reminder.';
comment on column public.organizations.license_acknowledged_at is
  'When an owner or admin acknowledged a license recorded as lapsed; billing continues for 7 days after.';
