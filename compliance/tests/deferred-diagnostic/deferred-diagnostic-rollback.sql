-- DD-001 .. DD-030: deferred diagnostic payments, enforced by the database.
--
-- Supports: CSLB-DD-001..006, SEC-DD-001..004 (compliance/registry), and the
-- rules in src/lib/diagnostic-payment-policy.ts.
--
-- Same safety model as tenant-isolation/two-tenant-rollback.sql: ONE implicit
-- transaction with no BEGIN/COMMIT, synthetic tenants and example.invalid
-- emails only, and a final RAISE that aborts everything. Read the results from
-- the error message "DD_RESULTS ...". No Stripe call is made: Stripe ids are
-- synthetic strings in the formats Stripe uses.
--
-- Run locally against a replay of supabase/migrations (see
-- docs/deferred-diagnostic-payments.md, "Testing the SQL"), or on a disposable
-- branch. Do not run statement by statement.

create temp table _dd (
  a_user uuid default gen_random_uuid(), b_user uuid default gen_random_uuid(),
  tech_user uuid default gen_random_uuid(), dispatcher_user uuid default gen_random_uuid(),
  a_org uuid default gen_random_uuid(), b_org uuid default gen_random_uuid(),
  a_booking uuid default gen_random_uuid(), a_token uuid default gen_random_uuid(),
  b_booking uuid default gen_random_uuid(), b_token uuid default gen_random_uuid(),
  a_auth uuid, b_auth uuid, a_job uuid, b_job uuid, charge uuid
) on commit drop;
insert into _dd default values;

create temp table _dd_results (seq serial, test_id text, name text, passed boolean, detail text) on commit drop;
grant insert, select on _dd_results to authenticated;
grant usage on sequence _dd_results_seq_seq to authenticated;

-- Seed two businesses in California, each with a connected Stripe account.
insert into auth.users (id, email, raw_user_meta_data)
select a_user, 'dd-a@example.invalid', '{}'::jsonb from _dd union all
select b_user, 'dd-b@example.invalid', '{}'::jsonb from _dd union all
select tech_user, 'dd-tech@example.invalid', '{}'::jsonb from _dd union all
select dispatcher_user, 'dd-dispatch@example.invalid', '{}'::jsonb from _dd;

insert into public.organizations (id, name, slug, created_by, base_state)
select a_org, 'DD Tenant A', 'dd-tenant-a-' || left(a_org::text, 8), a_user, 'CA' from _dd union all
select b_org, 'DD Tenant B', 'dd-tenant-b-' || left(b_org::text, 8), b_user, 'CA' from _dd;

insert into public.organization_members (organization_id, user_id, role)
select a_org, a_user, 'owner' from _dd union all
select b_org, b_user, 'owner' from _dd union all
select a_org, tech_user, 'technician' from _dd union all
select a_org, dispatcher_user, 'dispatcher' from _dd
on conflict (organization_id, user_id) do update set role = excluded.role;

insert into public.service_settings (organization_id, diagnostic_fee_cents)
select a_org, 18000 from _dd union all select b_org, 18000 from _dd
on conflict (organization_id) do update set diagnostic_fee_cents = 18000;

insert into public.stripe_connect_accounts (organization_id, stripe_account_id, onboarding_status, charges_enabled)
select a_org, 'acct_DDtenantA', 'active', true from _dd union all
select b_org, 'acct_DDtenantB', 'active', true from _dd;

-- Two web bookings waiting for a payment method, one per tenant.
insert into public.booking_requests (
  id, organization_id, public_token, status, intent, phone, email, first_name, last_name,
  description, address_line_1, city, state, postal_code, deposit_cents, source,
  communication_channel, created_by, customer_type, arrival_window_start, arrival_window_end, expires_at
)
select a_booking, a_org, a_token, 'awaiting_payment', 'visit', '5555550101', 'dd-cust-a@example.invalid', 'Ana', 'Example',
  'Half the kitchen outlets stopped working', '1 Test St', 'Fresno', 'CA', '93701', 18000, 'web',
  'web', 'customer', 'residential', now() + interval '3 days', now() + interval '3 days 2 hours', now() + interval '1 day'
from _dd union all
select b_booking, b_org, b_token, 'awaiting_payment', 'visit', '5555550202', 'dd-cust-b@example.invalid', 'Ben', 'Example',
  'Breaker keeps tripping in the garage', '2 Test St', 'Fresno', 'CA', '93701', 18000, 'web',
  'web', 'customer', 'residential', now() + interval '3 days', now() + interval '3 days 2 hours', now() + interval '1 day'
from _dd;

do $$
declare
  ids _dd%rowtype;
  r record;
  ok boolean;
  msg text;
  auth_text text := 'I authorize DD Tenant A to securely save my payment method and charge $180 upon completion of the contracted electrical diagnostic service. No diagnostic payment will be collected today.';
  state_now text;
  n integer;
begin
  select * into ids from _dd;

  -- DD-001: California refuses upfront collection in settings.
  begin
    update public.service_settings set diagnostic_collect_at = 'at_booking' where organization_id = ids.a_org;
    insert into _dd_results (test_id, name, passed, detail) values ('DD-001', 'CA refuses upfront diagnostic setting', false, 'update succeeded');
  exception when others then
    insert into _dd_results (test_id, name, passed, detail) values ('DD-001', 'CA refuses upfront diagnostic setting', sqlstate = '23514', sqlerrm);
  end;

  -- DD-002: a payment-mode checkout cannot be attached to a deferred booking.
  ok := public.attach_public_booking_checkout(ids.a_token, 'cs_test_paymentmode1');
  insert into _dd_results (test_id, name, passed, detail) values ('DD-002', 'advance payment checkout cannot attach', not ok, ok::text);

  -- DD-003: an authorization that misstates the fee is refused.
  begin
    perform public.record_diagnostic_authorization(ids.a_token, 'web', 'en', replace(auth_text, '$180', '$90'), '2026-11-26.1', 'deadbeef');
    insert into _dd_results values (default, 'DD-003', 'authorization text must state the fee', false, 'accepted');
  exception when others then
    insert into _dd_results values (default, 'DD-003', 'authorization text must state the fee', true, sqlerrm);
  end;

  -- DD-004: the authorization is recorded with version and text.
  update _dd set a_auth = public.record_diagnostic_authorization(ids.a_token, 'web', 'en', auth_text, '2026-11-26.1', 'deadbeef', '203.0.113.5', 'test agent');
  select * into ids from _dd;
  select count(*) into n from public.diagnostic_payment_authorizations
  where id = ids.a_auth and state = 'setup_pending' and amount_cents = 18000 and agreement_version = '2026-11-26.1' and agreement_text = auth_text;
  insert into _dd_results values (default, 'DD-004', 'authorization stored with amount, version and text', n = 1, n::text);

  -- DD-005: recording again is idempotent (one live authorization per booking).
  perform public.record_diagnostic_authorization(ids.a_token, 'web', 'en', auth_text, '2026-11-26.1', 'deadbeef');
  select count(*) into n from public.diagnostic_payment_authorizations where booking_request_id = ids.a_booking;
  insert into _dd_results values (default, 'DD-005', 'second acceptance reuses the authorization', n = 1, n::text);

  -- DD-006: Tenant B's Stripe account cannot be attached to Tenant A's authorization.
  begin
    perform public.attach_diagnostic_setup_checkout(ids.a_auth, 'cs_test_setupA1', 'cus_DDcustA', 'acct_DDtenantB');
    insert into _dd_results values (default, 'DD-006', 'foreign Stripe account refused', false, 'attached');
  exception when others then
    insert into _dd_results values (default, 'DD-006', 'foreign Stripe account refused', sqlstate = '42501', sqlerrm);
  end;

  ok := public.attach_diagnostic_setup_checkout(ids.a_auth, 'cs_test_setupA1', 'cus_DDcustA', 'acct_DDtenantA');
  ok := ok and public.attach_public_booking_checkout(ids.a_token, 'cs_test_setupA1');
  insert into _dd_results values (default, 'DD-007', 'setup checkout attaches to its own booking', ok, ok::text);

  -- DD-008: a setup session can never be confirmed as a payment.
  begin
    perform public.confirm_public_booking_payment(ids.a_token, 'cs_test_setupA1', 'pi_DDfake', 18000, 'usd');
    insert into _dd_results values (default, 'DD-008', 'setup session is not a payment', false, 'confirmed as paid');
  exception when others then
    insert into _dd_results values (default, 'DD-008', 'setup session is not a payment', true, sqlerrm);
  end;

  -- DD-009: setup for a different Stripe Customer is refused.
  begin
    perform public.confirm_public_booking_setup(ids.a_token, 'cs_test_setupA1', 'seti_DDa1', 'pm_DDa1', 'cus_DDother', 'acct_DDtenantA', 'visa', '4242');
    insert into _dd_results values (default, 'DD-009', 'payment method for another customer refused', false, 'saved');
  exception when others then
    insert into _dd_results values (default, 'DD-009', 'payment method for another customer refused', sqlstate = '42501', sqlerrm);
  end;

  -- DD-010: setup confirms the booking, writes a job, charges nothing.
  update _dd set a_job = public.confirm_public_booking_setup(ids.a_token, 'cs_test_setupA1', 'seti_DDa1', 'pm_DDa1', 'cus_DDcustA', 'acct_DDtenantA', 'visa', '4242');
  select * into ids from _dd;
  select count(*) into n from public.jobs where id = ids.a_job and diagnostic_paid = false and diagnostic_fee_cents = 18000;
  insert into _dd_results values (default, 'DD-010', 'setup confirms job with fee unpaid', n = 1, coalesce(ids.a_job::text, 'no job'));
  select count(*) into n from public.payments where booking_request_id = ids.a_booking;
  insert into _dd_results values (default, 'DD-011', 'no payment recorded at booking', n = 0, n::text);
  select state into state_now from public.diagnostic_payment_authorizations where id = ids.a_auth;
  insert into _dd_results values (default, 'DD-012', 'authorization saved', state_now = 'payment_method_saved', state_now);

  -- DD-013: a webhook retry returns the same job and changes nothing.
  ok := public.confirm_public_booking_setup(ids.a_token, 'cs_test_setupA1', 'seti_DDa1', 'pm_DDa1', 'cus_DDcustA', 'acct_DDtenantA', 'visa', '4242') = ids.a_job;
  select count(*) into n from public.jobs where organization_id = ids.a_org;
  insert into _dd_results values (default, 'DD-013', 'duplicate setup webhook is idempotent', ok and n = 1, n::text);

  -- DD-014: premature collection (contractor) is refused.
  begin
    perform * from public.claim_diagnostic_charge(ids.a_job, 18000, 'app', ids.a_user);
    insert into _dd_results values (default, 'DD-014', 'premature app collection refused', false, 'claimed');
  exception when others then
    insert into _dd_results values (default, 'DD-014', 'premature app collection refused', sqlerrm like '%not been marked complete%', sqlerrm);
  end;
  -- DD-015: premature collection (MCP) is refused the same way.
  begin
    perform * from public.claim_diagnostic_charge(ids.a_job, 18000, 'mcp', ids.a_user);
    insert into _dd_results values (default, 'DD-015', 'premature MCP collection refused', false, 'claimed');
  exception when others then
    insert into _dd_results values (default, 'DD-015', 'premature MCP collection refused', sqlerrm like '%not been marked complete%', sqlerrm);
  end;
  -- DD-016: there is no voice route at all.
  begin
    perform * from public.claim_diagnostic_charge(ids.a_job, 18000, 'voice', null);
    insert into _dd_results values (default, 'DD-016', 'voice route cannot collect', false, 'claimed');
  exception when others then
    insert into _dd_results values (default, 'DD-016', 'voice route cannot collect', sqlstate = '42501', sqlerrm);
  end;

  -- DD-017: a dispatcher and an unassigned technician cannot complete the diagnostic.
  begin
    perform public.complete_diagnostic_service(ids.a_job, 'diagnostic_only', 'Found a loose neutral at the panel and tightened it.', false, ids.dispatcher_user);
    insert into _dd_results values (default, 'DD-017', 'dispatcher cannot complete', false, 'completed');
  exception when others then
    insert into _dd_results values (default, 'DD-017', 'dispatcher cannot complete', sqlstate = '42501', sqlerrm);
  end;
  begin
    perform public.complete_diagnostic_service(ids.a_job, 'diagnostic_only', 'Found a loose neutral at the panel and tightened it.', false, ids.tech_user);
    insert into _dd_results values (default, 'DD-018', 'unassigned technician cannot complete', false, 'completed');
  exception when others then
    insert into _dd_results values (default, 'DD-018', 'unassigned technician cannot complete', sqlstate = '42501', sqlerrm);
  end;
  -- DD-019: another tenant's owner cannot complete it.
  begin
    perform public.complete_diagnostic_service(ids.a_job, 'diagnostic_only', 'Found a loose neutral at the panel and tightened it.', false, ids.b_user);
    insert into _dd_results values (default, 'DD-019', 'other tenant cannot complete', false, 'completed');
  exception when others then
    insert into _dd_results values (default, 'DD-019', 'other tenant cannot complete', sqlstate = '42501', sqlerrm);
  end;
  -- DD-020: findings are required.
  begin
    perform public.complete_diagnostic_service(ids.a_job, 'diagnostic_only', 'ok', false, ids.a_user);
    insert into _dd_results values (default, 'DD-020', 'findings required', false, 'completed');
  exception when others then
    insert into _dd_results values (default, 'DD-020', 'findings required', true, sqlerrm);
  end;

  -- DD-021: the owner completes a standalone diagnostic (Scenario A).
  perform public.complete_diagnostic_service(ids.a_job, 'diagnostic_only', 'Found a loose neutral at the panel and tightened it.', false, ids.a_user);
  select count(*) into n from public.jobs where id = ids.a_job and diagnostic_completed_at is not null and diagnostic_repair_contract = 'none';
  insert into _dd_results values (default, 'DD-021', 'owner completes standalone diagnostic', n = 1, n::text);

  -- DD-022: more than the authorized amount is refused.
  begin
    perform * from public.claim_diagnostic_charge(ids.a_job, 18001, 'app', ids.a_user);
    insert into _dd_results values (default, 'DD-022', 'over-authorization refused', false, 'claimed');
  exception when others then
    insert into _dd_results values (default, 'DD-022', 'over-authorization refused', sqlerrm like '%authorized amount%', sqlerrm);
  end;
  -- DD-023: Tenant B's owner cannot collect Tenant A's diagnostic.
  begin
    perform * from public.claim_diagnostic_charge(ids.a_job, 18000, 'app', ids.b_user);
    insert into _dd_results values (default, 'DD-023', 'other tenant cannot collect', false, 'claimed');
  exception when others then
    insert into _dd_results values (default, 'DD-023', 'other tenant cannot collect', sqlerrm like '%member of this business%', sqlerrm);
  end;

  -- DD-024: an eligible claim succeeds once; a concurrent second claim is refused.
  select charge_id into r from public.claim_diagnostic_charge(ids.a_job, 18000, 'app', ids.a_user);
  update _dd set charge = r.charge_id;
  select * into ids from _dd;
  begin
    perform * from public.claim_diagnostic_charge(ids.a_job, 18000, 'auto', null);
    insert into _dd_results values (default, 'DD-024', 'duplicate claim refused', false, 'second claim made');
  exception when others then
    insert into _dd_results values (default, 'DD-024', 'duplicate claim refused', sqlerrm like '%already processing%', sqlerrm);
  end;
  -- Even bypassing the function, the unique index refuses a second live charge.
  begin
    insert into public.diagnostic_charges (organization_id, authorization_id, job_id, amount_cents, via, idempotency_key)
    values (ids.a_org, ids.a_auth, ids.a_job, 18000, 'auto', 'dd-direct-dup');
    insert into _dd_results values (default, 'DD-025', 'unique index blocks a second live charge', false, 'inserted');
  exception when unique_violation then
    insert into _dd_results values (default, 'DD-025', 'unique index blocks a second live charge', true, sqlerrm);
  end;

  -- DD-026: a result with the wrong amount is refused.
  begin
    perform public.record_diagnostic_charge_result(ids.charge, 'succeeded', 'pi_DDa1', 25000);
    insert into _dd_results values (default, 'DD-026', 'mismatched amount refused', false, 'recorded');
  exception when others then
    insert into _dd_results values (default, 'DD-026', 'mismatched amount refused', true, sqlerrm);
  end;

  -- DD-027: success marks the job paid and records one payment; a late failure webhook changes nothing.
  perform public.record_diagnostic_charge_result(ids.charge, 'succeeded', 'pi_DDa1', 18000);
  perform public.record_diagnostic_charge_result(ids.charge, 'succeeded', 'pi_DDa1', 18000);
  perform public.record_diagnostic_charge_result(ids.charge, 'failed', 'pi_DDa1', 18000, 'card_declined', 'late');
  select count(*) into n from public.payments where provider_payment_intent_id = 'pi_DDa1' and amount_cents = 18000 and job_id = ids.a_job;
  select state into state_now from public.diagnostic_payment_authorizations where id = ids.a_auth;
  insert into _dd_results values (default, 'DD-027', 'success recorded once, out-of-order failure ignored',
    n = 1 and state_now = 'succeeded' and (select diagnostic_paid from public.jobs where id = ids.a_job), n || ' ' || state_now);

  -- DD-028: nothing more can be collected after success.
  begin
    perform * from public.claim_diagnostic_charge(ids.a_job, 18000, 'app', ids.a_user);
    insert into _dd_results values (default, 'DD-028', 'no second collection after success', false, 'claimed');
  exception when others then
    insert into _dd_results values (default, 'DD-028', 'no second collection after success', true, sqlerrm);
  end;

  -- Tenant B: same-contract repair defers, decline, revocation and cancellation.
  update _dd set b_auth = public.record_diagnostic_authorization(ids.b_token, 'voice', 'es',
    'Autorizo a DD Tenant B a guardar de forma segura mi método de pago y a cobrar $180 al completar el servicio de diagnóstico eléctrico contratado. Hoy no se cobrará ningún pago de diagnóstico.',
    '2026-11-26.1', 'cafebabe');
  select * into ids from _dd;
  perform public.attach_diagnostic_setup_checkout(ids.b_auth, 'cs_test_setupB1', 'cus_DDcustB', 'acct_DDtenantB');
  perform public.attach_public_booking_checkout(ids.b_token, 'cs_test_setupB1');
  update _dd set b_job = public.confirm_public_booking_setup(ids.b_token, 'cs_test_setupB1', 'seti_DDb1', 'pm_DDb1', 'cus_DDcustB', 'acct_DDtenantB', 'mastercard', '4444');
  select * into ids from _dd;

  -- DD-029: a repair under the same contract defers the fee.
  perform public.complete_diagnostic_service(ids.b_job, 'fix_now', 'Replaced the failed breaker in the garage subpanel.', false, ids.b_user);
  begin
    perform * from public.claim_diagnostic_charge(ids.b_job, 18000, 'app', ids.b_user);
    insert into _dd_results values (default, 'DD-029', 'same-contract repair defers collection', false, 'claimed');
  exception when others then
    insert into _dd_results values (default, 'DD-029', 'same-contract repair defers collection', sqlerrm like '%same contract%', sqlerrm);
  end;

  -- DD-030: revoking the authorization stops collection.
  perform * from public.revoke_diagnostic_authorization(ids.b_token);
  select state into state_now from public.diagnostic_payment_authorizations where id = ids.b_auth;
  insert into _dd_results values (default, 'DD-030', 'customer revocation recorded', state_now = 'revoked', state_now);

  -- DD-031: cancelling a job cancels a live authorization.
  update public.jobs set status = 'confirmed', diagnostic_completed_at = null where id = ids.b_job;
  update public.diagnostic_payment_authorizations set state = 'payment_method_saved', revoked_at = null where id = ids.b_auth;
  update public.jobs set status = 'canceled', canceled_at = now() where id = ids.b_job;
  select state into state_now from public.diagnostic_payment_authorizations where id = ids.b_auth;
  insert into _dd_results values (default, 'DD-031', 'job cancellation cancels the authorization', state_now = 'cancelled', state_now);

  -- DD-032: signed-in members read only their own authorizations, and write none.
  perform set_config('request.jwt.claim.sub', ids.b_user::text, true);
  perform set_config('request.jwt.claims', pg_catalog.json_build_object('sub', ids.b_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.diagnostic_payment_authorizations where organization_id = ids.a_org;
  insert into _dd_results values (default, 'DD-032', 'tenant B cannot read tenant A authorizations', n = 0, n::text);
  begin
    update public.diagnostic_payment_authorizations set amount_cents = 1 where organization_id = ids.b_org;
    get diagnostics n = row_count;
    insert into _dd_results values (default, 'DD-033', 'members cannot edit authorized amounts', n = 0, n::text);
  exception when others then
    insert into _dd_results values (default, 'DD-033', 'members cannot edit authorized amounts', true, sqlerrm);
  end;
  begin
    perform * from public.claim_diagnostic_charge(ids.b_job, 18000, 'app', ids.b_user);
    insert into _dd_results values (default, 'DD-034', 'members cannot call the charge function directly', false, 'called');
  exception when others then
    insert into _dd_results values (default, 'DD-034', 'members cannot call the charge function directly', sqlstate = '42501', sqlerrm);
  end;
  begin
    update public.jobs set diagnostic_completed_at = now() where id = ids.b_job;
    insert into _dd_results values (default, 'DD-035', 'members cannot mark completion directly', false, 'updated');
  exception when others then
    insert into _dd_results values (default, 'DD-035', 'members cannot mark completion directly', sqlstate = '42501', sqlerrm);
  end;
  execute 'reset role';
end
$$;

-- DD-036..038: a Nevada business that keeps upfront collection books exactly as before.
do $$
declare
  c_user uuid := gen_random_uuid();
  c_org uuid := gen_random_uuid();
  c_token uuid := gen_random_uuid();
  job uuid;
  n integer;
begin
  insert into auth.users (id, email) values (c_user, 'dd-c@example.invalid');
  insert into public.organizations (id, name, slug, created_by, base_state)
  values (c_org, 'DD Tenant C', 'dd-tenant-c-' || left(c_org::text, 8), c_user, 'NV');
  insert into public.service_settings (organization_id, diagnostic_fee_cents) values (c_org, 15000)
  on conflict (organization_id) do update set diagnostic_fee_cents = 15000;
  update public.service_settings set diagnostic_jurisdiction = 'NV', diagnostic_collect_at = 'at_booking' where organization_id = c_org;
  insert into _dd_results values (default, 'DD-036', 'non-CA business may keep upfront collection', true, 'setting saved');

  insert into public.booking_requests (
    organization_id, public_token, status, intent, phone, email, first_name, last_name, description,
    address_line_1, city, state, postal_code, deposit_cents, source, communication_channel, created_by,
    customer_type, arrival_window_start, arrival_window_end, expires_at
  ) values (
    c_org, c_token, 'awaiting_payment', 'visit', '5555550303', 'dd-cust-c@example.invalid', 'Cal', 'Example',
    'Porch light flickers', '3 Test St', 'Reno', 'NV', '89501', 15000, 'web', 'web', 'customer',
    'residential', now() + interval '3 days', now() + interval '3 days 2 hours', now() + interval '1 day'
  );
  perform public.attach_public_booking_checkout(c_token, 'cs_test_paidC1');
  job := public.confirm_public_booking_payment(c_token, 'cs_test_paidC1', 'pi_DDc1', 15000, 'usd');
  select count(*) into n from public.jobs where id = job and diagnostic_paid and diagnostic_fee_cents = 15000;
  insert into _dd_results values (default, 'DD-037', 'upfront paid booking still writes a paid job', n = 1, coalesce(job::text, 'no job'));
  select count(*) into n from public.payments where provider_checkout_session_id = 'cs_test_paidC1' and amount_cents = 15000 and job_id = job;
  insert into _dd_results values (default, 'DD-038', 'upfront paid booking still records its payment', n = 1, n::text);
end
$$;

-- DD-039: no charge while the customer can still cancel a signed contract on the
-- job (private.job_cancellation_hold, home improvement contracts migration).
-- Vacuous, and said so, on a database that does not have that migration.
do $$
declare
  ids _dd%rowtype;
  claim record;
begin
  select * into ids from _dd;
  if pg_catalog.to_regprocedure('private.job_cancellation_hold(uuid)') is null then
    insert into _dd_results values (default, 'DD-039', 'cancellation period blocks collection (VACUOUS: migration absent)', true, 'skipped');
    return;
  end if;
  -- A fresh completed standalone diagnostic on tenant A, then a signed contract still in its cancel window.
  update public.diagnostic_payment_authorizations set state = 'payment_method_saved' where id = ids.a_auth;
  update public.jobs set diagnostic_paid = false where id = ids.a_job;
  delete from public.diagnostic_charges where authorization_id = ids.a_auth;
  delete from public.payments where job_id = ids.a_job;
  execute $q$insert into public.contracts (organization_id, job_id, body, kind, status, signed_at, legal_notices, cancel_deadline)
           values ($1, $2, 'Diagnostic agreement', 'agreement', 'signed', now(), '{"cancellationForm": {}}'::jsonb, now() + interval '3 days')$q$
    using ids.a_org, ids.a_job;
  begin
    select * into claim from public.claim_diagnostic_charge(ids.a_job, 18000, 'app', ids.a_user);
    insert into _dd_results values (default, 'DD-039', 'cancellation period blocks collection', false, 'claimed');
  exception when others then
    insert into _dd_results values (default, 'DD-039', 'cancellation period blocks collection', sqlerrm like '%can still cancel%', sqlerrm);
  end;
end
$$;

do $$
declare
  failed integer;
  total integer;
begin
  select count(*) filter (where not passed), count(*) into failed, total from _dd_results;
  raise exception 'DD_RESULTS % passed, % failed: %', total - failed, failed,
    (select pg_catalog.json_agg(pg_catalog.json_build_object('id', test_id, 'name', name, 'passed', passed, 'detail', left(detail, 160)) order by seq) from _dd_results);
end
$$;
