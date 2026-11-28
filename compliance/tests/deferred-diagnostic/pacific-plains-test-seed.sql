-- Pacific Plains Electric: the initial Diagnostic Payment Settings, for a
-- TEST database only (a local replay of supabase/migrations, or a disposable
-- branch). Never run against production: production settings are changed by
-- the owner in Settings → Get paid online → Diagnostic Payment Settings.
--
-- Settings (deferred diagnostic task, section 6):
--   fee $180 · upfront payment disabled · payment method required online ·
--   automatic collection on eligible completion · diagnostic credit toward
--   approved repairs · jurisdiction CA.
--
-- Also seeds synthetic bookings in each payment state, used for screenshots.
-- Stripe ids are synthetic strings in Stripe's formats; nothing calls Stripe.

do $$
declare
  owner_id uuid := '11111111-1111-4111-8111-111111111111';
  org uuid := '22222222-2222-4222-8222-222222222222';
  tech uuid := '33333333-3333-4333-8333-333333333333';
  d integer;
begin
  insert into auth.users (id, email) values (owner_id, 'owner@pacific-plains.example.invalid') on conflict do nothing;
  insert into public.organizations (id, name, slug, created_by, base_city, base_state, base_postal_code, phone, timezone)
  values (org, 'Pacific Plains Electric', 'pacific-plains-electric', owner_id, 'Santa Maria', 'CA', '93454', '(805) 555-0100', 'America/Los_Angeles')
  on conflict (id) do nothing;
  insert into public.organization_members (organization_id, user_id, role) values (org, owner_id, 'owner') on conflict do nothing;

  insert into public.service_settings (organization_id) values (org) on conflict (organization_id) do nothing;
  update public.service_settings set
    diagnostic_fee_cents = 18000,
    diagnostic_jurisdiction = 'CA',
    diagnostic_collect_at = 'after_completion',   -- upfront diagnostic payment: disabled
    require_payment_method_at_booking = true,     -- required for standard online booking
    auto_collect_diagnostic = true,               -- automatic collection on eligible completion
    allow_manual_diagnostic_payment = true,
    credit_diagnostic_to_repair = true,           -- subject to the approved contract and accounting treatment
    send_payment_method_reminders = true,
    send_failed_payment_notices = true,
    diagnostic_service_description = null,       -- "Electrical Diagnostic Service"
    automatic_booking_radius_miles = 40
  where organization_id = org;

  insert into public.technicians (id, organization_id, display_name, is_active) values (tech, org, 'Nick', true) on conflict do nothing;
  for d in 1..5 loop
    insert into public.technician_hours (organization_id, technician_id, weekday, starts_at, ends_at)
    select org, tech, d, '08:00', '17:00'
    where not exists (select 1 from public.technician_hours where technician_id = tech and weekday = d);
  end loop;

  insert into public.stripe_connect_accounts (organization_id, stripe_account_id, onboarding_status, charges_enabled, payouts_enabled, details_submitted)
  values (org, 'acct_TESTpacificplains', 'active', true, true, true) on conflict do nothing;
end
$$;

-- A voice booking held, waiting on the customer's authorization (English).
insert into public.booking_requests (organization_id, public_token, status, intent, phone, email, contact_name, first_name,
  description, address_line_1, city, state, postal_code, deposit_cents, source, communication_channel, created_by,
  customer_type, arrival_window_start, arrival_window_end, expires_at, language)
values ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000001', 'awaiting_payment', 'visit', '8055550111',
  'ana@example.invalid', 'Ana Example', 'Ana', 'Half the kitchen outlets stopped working', '418 Alder Lane', 'Santa Maria', 'CA', '93454',
  18000, 'voice', 'phone', 'ai', 'residential', date_trunc('day', now()) + interval '3 days 16 hours',
  date_trunc('day', now()) + interval '3 days 18 hours', now() + interval '20 hours', 'en')
on conflict do nothing;

-- The same, in Spanish.
insert into public.booking_requests (organization_id, public_token, status, intent, phone, email, contact_name, first_name,
  description, address_line_1, city, state, postal_code, deposit_cents, source, communication_channel, created_by,
  customer_type, arrival_window_start, arrival_window_end, expires_at, language)
values ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000002', 'awaiting_payment', 'visit', '8055550122',
  'beto@example.invalid', 'Beto Ejemplo', 'Beto', 'El breaker del garaje se dispara', '12 Oak St', 'Orcutt', 'CA', '93455',
  18000, 'voice', 'phone', 'ai', 'residential', date_trunc('day', now()) + interval '4 days 16 hours',
  date_trunc('day', now()) + interval '4 days 18 hours', now() + interval '20 hours', 'es')
on conflict do nothing;

-- A web booking that authorized and saved a card (confirmed, nothing charged),
-- and one whose completed diagnostic's charge was declined. Both made through
-- the same database functions production uses.
do $$
declare
  org uuid := '22222222-2222-4222-8222-222222222222';
  saved_token uuid := 'aaaaaaaa-0000-4000-8000-000000000003';
  failed_token uuid := 'aaaaaaaa-0000-4000-8000-000000000004';
  words text := 'I authorize Pacific Plains Electric to securely save my payment method and charge $180 upon completion of the contracted electrical diagnostic service. No diagnostic payment will be collected today.';
  auth_id uuid;
  job uuid;
  claim record;
begin
  if exists (select 1 from public.booking_requests where public_token = saved_token) then return; end if;
  insert into public.booking_requests (organization_id, public_token, status, intent, phone, email, first_name, last_name,
    description, address_line_1, city, state, postal_code, deposit_cents, source, communication_channel, created_by,
    customer_type, arrival_window_start, arrival_window_end, expires_at, language)
  values
    (org, saved_token, 'awaiting_payment', 'visit', '8055550133', 'cam@example.invalid', 'Cam', 'Example', 'Porch light flickers when it rains',
     '7 Pine Ct', 'Santa Maria', 'CA', '93454', 18000, 'web', 'web', 'customer', 'residential',
     date_trunc('day', now()) + interval '5 days 16 hours', date_trunc('day', now()) + interval '5 days 18 hours', now() + interval '20 hours', 'en'),
    (org, failed_token, 'awaiting_payment', 'visit', '8055550144', 'dee@example.invalid', 'Dee', 'Example', 'Bathroom GFCI will not reset',
     '9 Elm Way', 'Santa Maria', 'CA', '93454', 18000, 'web', 'web', 'customer', 'residential',
     date_trunc('day', now()) + interval '6 days 16 hours', date_trunc('day', now()) + interval '6 days 18 hours', now() + interval '20 hours', 'en');

  auth_id := public.record_diagnostic_authorization(saved_token, 'web', 'en', words, '2026-11-26.1', 'aaaaaaaa');
  perform public.attach_diagnostic_setup_checkout(auth_id, 'cs_test_seedsaved1', 'cus_TESTcam', 'acct_TESTpacificplains');
  perform public.attach_public_booking_checkout(saved_token, 'cs_test_seedsaved1');
  perform public.confirm_public_booking_setup(saved_token, 'cs_test_seedsaved1', 'seti_TESTcam1', 'pm_TESTcam1', 'cus_TESTcam', 'acct_TESTpacificplains', 'visa', '4242');

  auth_id := public.record_diagnostic_authorization(failed_token, 'web', 'en', words, '2026-11-26.1', 'aaaaaaaa');
  perform public.attach_diagnostic_setup_checkout(auth_id, 'cs_test_seedfail1', 'cus_TESTdee', 'acct_TESTpacificplains');
  perform public.attach_public_booking_checkout(failed_token, 'cs_test_seedfail1');
  job := public.confirm_public_booking_setup(failed_token, 'cs_test_seedfail1', 'seti_TESTdee1', 'pm_TESTdee1', 'cus_TESTdee', 'acct_TESTpacificplains', 'visa', '0002');
  perform public.complete_diagnostic_service(job, 'diagnostic_only', 'GFCI had failed internally; replaced it with a new 20A GFCI and tested all downstream outlets.', false, '11111111-1111-4111-8111-111111111111');
  select * into claim from public.claim_diagnostic_charge(job, 18000, 'auto');
  perform public.record_diagnostic_charge_result(claim.charge_id, 'failed', 'pi_TESTdee1', 18000, 'card_declined', 'Your card was declined.');
end
$$;
