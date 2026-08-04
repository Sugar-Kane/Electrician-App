-- Per-tenant receptionist setup. Not a migration: these are one business's
-- facts, and migrations run for every tenant. Run this by hand (or adapt it)
-- once per business, after the schema migrations have been applied.
--
-- Values below are Pacific Plains Electric's, as supplied by the owner.

-- 1. Business facts the agent may state.
--
-- receptionist_license_number is deliberately left NULL: the C-10 number is not
-- confirmed yet. While it is NULL the agent refuses to state a number and will
-- not claim or deny licensure, which is the safe answer in California — the
-- license number is required in advertising, so an invented one is a liability.
-- Fill it in and the agent starts answering the question directly.
--
-- receptionist_hours is also NULL: not supplied yet. The agent says the owner
-- will confirm rather than naming times.
update public.service_settings as settings
set
  receptionist_owner_name = 'Nick Kane',
  receptionist_service_area = 'Nipomo, California and the surrounding area out to about 25 miles — roughly a 50-mile span end to end. That takes in Santa Maria, Arroyo Grande, Grover Beach, Pismo Beach, Oceano, and Guadalupe.',
  receptionist_services = 'All residential and commercial electrical work. Nick does not turn work away based on the type or size of the job, so never screen a caller out — take the details and let him decide.',
  receptionist_records_calls = true,
  receptionist_escalation_phone = '+12096269313'
from public.organizations as organization
where organization.id = settings.organization_id
  and organization.name = 'Pacific Plains Electric';

-- 2. The phone line customers call and text.
--
-- Replace the placeholder with the Twilio number once it is provisioned.
-- forward_to_number is where emergencies page; leaving it NULL falls back to
-- service_settings.receptionist_escalation_phone above.
insert into public.inbound_numbers (organization_id, phone_number, label, forward_to_number)
select organization.id, '+1805REPLACE', 'Main line', '+12096269313'
from public.organizations as organization
where organization.name = 'Pacific Plains Electric'
on conflict (phone_number) do update
  set forward_to_number = excluded.forward_to_number,
      label = excluded.label;

-- 3. Confirm what the agent will answer with.
select
  organization.name,
  settings.receptionist_owner_name,
  settings.receptionist_service_area,
  settings.receptionist_hours,
  settings.receptionist_license_number,
  settings.receptionist_records_calls,
  settings.receptionist_escalation_phone
from public.service_settings as settings
join public.organizations as organization on organization.id = settings.organization_id
where organization.name = 'Pacific Plains Electric';
