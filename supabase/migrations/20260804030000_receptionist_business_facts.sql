-- Business facts the AI receptionist is allowed to state.
--
-- These started as environment variables, which is wrong for an ISV product:
-- one deployment answers for many businesses, and a tenant's service area or
-- license number is data, not deployment configuration. They belong next to the
-- other per-tenant service policy in service_settings.
--
-- Every field is nullable on purpose. The agent says "I'll have the owner
-- confirm" for anything unset, which is the honest answer — far better than a
-- placeholder that commits a business to a coverage area or a license claim it
-- has not made.

alter table public.service_settings
  add column receptionist_owner_name text,
  add column receptionist_service_area text,
  add column receptionist_hours text,
  add column receptionist_license_number text,
  add column receptionist_services text,
  add column receptionist_records_calls boolean not null default false,
  add column receptionist_escalation_phone text;

comment on column public.service_settings.receptionist_owner_name is 'Who the agent says will call back, e.g. "Nick Kane". The agent uses the first name in conversation.';
comment on column public.service_settings.receptionist_service_area is 'Coverage area in plain language. The agent quotes this and does not extrapolate a boundary beyond it.';
comment on column public.service_settings.receptionist_hours is 'Null means the agent declines to state hours rather than guessing.';
comment on column public.service_settings.receptionist_license_number is 'Null means the agent will neither state a number nor claim or deny licensure. California requires the license number in advertising, so an unverified claim here is a real liability.';
comment on column public.service_settings.receptionist_services is 'What the business takes on. Say so explicitly when the business turns nothing away, so the agent does not screen callers out by job type.';
comment on column public.service_settings.receptionist_records_calls is 'When true the agent discloses recording as its first sentence. California is a two-party consent state.';
comment on column public.service_settings.receptionist_escalation_phone is 'E.164. Org-level default for emergency paging, used when a line has no forward_to_number of its own.';
