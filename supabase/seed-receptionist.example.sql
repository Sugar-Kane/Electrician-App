-- Per-tenant receptionist setup. Not a migration: these are one business's
-- facts, and migrations run for every tenant. Run this by hand (or adapt it)
-- once per business, after the schema migrations have been applied.
--
-- Values below are Pacific Plains Electric's, as supplied by the owner.

-- 0. What number is already on file?
--
-- tenant_legal_pages.support_phone is the number published on the legal pages
-- and given to carriers during A2P registration. If a business line already
-- exists, this is where it is — the application repository contains only
-- fictional 555-01xx numbers from the pilot dataset. Run this first and
-- reconcile it with whatever Twilio provisions in step 2; a customer-facing
-- number that disagrees with the registered one is an A2P problem.
select slug, legal_business_name, dba_name, support_phone, support_email
from public.tenant_legal_pages
where legal_business_name ilike '%Pacific Plains%'
   or dba_name ilike '%Pacific Plains%';

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
  receptionist_service_area = 'Based in Nipomo, California, covering roughly 50 miles in every direction. That takes in San Luis Obispo, Pismo Beach, Arroyo Grande, Grover Beach, Oceano, Avila Beach, Morro Bay, Los Osos, Atascadero, Templeton, Paso Robles, Santa Maria, Orcutt, Guadalupe, Los Alamos, Buellton, Solvang, Santa Ynez, and Lompoc. For somewhere near the edge of that, take the address and let Nick confirm rather than turning the caller away.',
  receptionist_services = 'All residential and commercial electrical work. Nick does not turn work away based on the type or size of the job, so never screen a caller out — take the details and let him decide.',
  receptionist_records_calls = true,
  receptionist_escalation_phone = '+12096269313'
from public.organizations as organization
where organization.id = settings.organization_id
  and organization.name = 'Pacific Plains Electric';

-- 2. The phone line customers call and text.
--
-- REPLACE_WITH_TWILIO_NUMBER is the number Twilio provisions for the business —
-- the one that will appear on the website and in the A2P campaign. It is NOT
-- Nick's personal line. The statement is intentionally left invalid so it fails
-- loudly rather than registering a placeholder as a live business number.
--
-- forward_to_number is where emergencies ring. Nick's personal number is the
-- right destination for that, and it is deliberately not the public line.
insert into public.inbound_numbers (organization_id, phone_number, label, forward_to_number)
select organization.id, 'REPLACE_WITH_TWILIO_NUMBER', 'Main line', '+12096269313'
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
