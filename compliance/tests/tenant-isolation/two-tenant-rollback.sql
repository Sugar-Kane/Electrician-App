-- TI-001 .. TI-012: two-tenant isolation test in ONE transaction that always aborts.
--
-- STATUS: run 2 on 2026-11-25 is the run of record: 72 passed, 1 failed (TI-011), 6 vacuous (evidence/tenant-isolation-run2.json).
-- Supports: SEC-002-001, -002, -003, -004, -006, -007, -010, -012, -013, -019.
--
-- What it does
--   1. As the session role (postgres / service role), creates two synthetic
--      tenants ("Compliance Tenant A", "Compliance Tenant B"), one synthetic
--      auth user per tenant (owner membership), and seeds Tenant B with a
--      customer, property, job, estimate, contract, invoice, invoice payment,
--      document, conversation, message, settings rows, subscription row and a
--      storage.objects metadata row. Tenant A gets one customer and one
--      subscription row of its own (used by the "move to B" and
--      "self-upgrade" checks).
--   2. Switches to `authenticated` with Tenant A's user id in
--      request.jwt.claims, and tries SELECT / UPDATE / DELETE against every
--      Tenant B row, plus INSERT-into-B and move-own-row-to-B, plus calls a
--      few SECURITY DEFINER RPCs with B identifiers.
--   3. Repeats a SELECT sweep as `anon`.
--   4. Raises an exception carrying every result as JSON, which aborts (rolls back) everything.
--
-- Safety
--   - Only synthetic values ('Compliance Tenant A/B', example.invalid emails),
--     random gen_random_uuid() ids. No real row is read or referenced.
--   - There is no BEGIN and no COMMIT. The script runs as ONE implicit transaction
--     (a single multi-statement query, as Supabase's SQL editor and execute_sql
--     send it). Its LAST statement deliberately raises an exception carrying the
--     results as JSON, so Postgres always aborts the whole transaction: every
--     inserted row, the temp tables and the role/claim settings are discarded.
--     If anything errors earlier, the same abort happens. Read the results from
--     the error message "TI_RESULTS ...". The only thing a rollback cannot undo
--     is sequence counters advanced by inserts (e.g. serial ids).
--   - No dblink, no net.http_post / pg_net, no pg_cron calls. Catalog check on
--     2026-11-25: no public/private function source references net.http or
--     dblink, and auth.users has no triggers (evidence/db-security-catalog.json
--     q18, q19). Re-check before running, because triggers on the seeded
--     tables run inside this transaction.
--   - Writes under `authenticated` that RLS lets through (the bugs this test
--     is looking for) are rolled back with everything else.
--   - Run it against a branch or disposable copy where possible. On production,
--     send the whole file as ONE query (Supabase SQL editor "Run", or MCP
--     execute_sql). Expected outcome: an ERROR whose message starts TI_RESULTS.
--     Do not run it statement by statement.
--
-- Reading results: every row of _ti_results has expected and actual counts and
-- passed = (actual = expected) or, for "must fail" checks, passed = blocked.
-- A row with seeded = 0 means the B row could not be seeded, so its check is
-- vacuous and must be fixed before the result counts as evidence.

-- Results are per session and vanish at the end of the transaction.
create temp table _ti_ids (
  a_user uuid, b_user uuid, a_org uuid, b_org uuid,
  a_customer uuid, b_customer uuid, b_property uuid, b_job uuid, b_estimate uuid,
  b_contract uuid, b_invoice uuid, b_payment uuid, b_document uuid,
  b_conversation uuid, b_message uuid
) on commit drop;

create temp table _ti_results (
  seq serial,
  test_id text,
  phase text,
  table_name text,
  operation text,
  seeded bigint,
  expected bigint,
  actual bigint,
  blocked boolean,
  passed boolean,
  detail text
) on commit drop;

insert into _ti_ids (a_user, b_user, a_org, b_org, a_customer, b_customer, b_property, b_job,
                     b_estimate, b_contract, b_invoice, b_payment, b_document, b_conversation, b_message)
select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
       gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
       gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
       gen_random_uuid(), gen_random_uuid(), gen_random_uuid();

-- The temp schema of this session is usable by roles we SET ROLE to; table
-- privileges are still needed.
grant select on _ti_ids to authenticated, anon;
grant select, insert on _ti_results to authenticated, anon;
grant usage on sequence _ti_results_seq_seq to authenticated, anon;

---------------------------------------------------------------------------
-- 1. Setup (as the connecting superuser/service role; RLS not applied)
---------------------------------------------------------------------------

-- Synthetic auth users. Confirmed email so membership helpers behave as for a
-- real signed-in user.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select a_user, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
       'compliance-tenant-a+' || left(a_user::text, 8) || '@example.invalid', now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Compliance User A"}'::jsonb, now(), now()
from _ti_ids
union all
select b_user, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
       'compliance-tenant-b+' || left(b_user::text, 8) || '@example.invalid', now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Compliance User B"}'::jsonb, now(), now()
from _ti_ids;

insert into public.organizations (id, name, slug, created_by)
select a_org, 'Compliance Tenant A', 'compliance-tenant-a-' || left(a_org::text, 8), a_user from _ti_ids
union all
select b_org, 'Compliance Tenant B', 'compliance-tenant-b-' || left(b_org::text, 8), b_user from _ti_ids;

-- Owner memberships (guard_owner_membership returns early when auth.uid() is null).
insert into public.organization_members (organization_id, user_id, role)
select a_org, a_user, 'owner' from _ti_ids
union all
select b_org, b_user, 'owner' from _ti_ids
on conflict (organization_id, user_id) do nothing;

-- Tenant B business rows. Each in its own block so one schema surprise does
-- not stop the rest; failures are recorded as phase = 'setup'.
do $setup$
declare
  ids _ti_ids;
  folder uuid;
begin
  select * into ids from _ti_ids;

  begin
    insert into public.customers (id, organization_id, first_name, last_name) values (ids.b_customer, ids.b_org, 'Compliance', 'Customer B');
    insert into public.customers (id, organization_id, first_name, last_name) values (ids.a_customer, ids.a_org, 'Compliance', 'Customer A');
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, detail)
    values ('TI-000', 'setup', 'customers', 'insert', 'FAILED: ' || sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.properties (id, organization_id, customer_id, address_line_1, city, state, postal_code)
    values (ids.b_property, ids.b_org, ids.b_customer, '1 Synthetic Way', 'Testville', 'CA', '90000');
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, detail)
    values ('TI-000', 'setup', 'properties', 'insert', 'FAILED: ' || sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.jobs (id, organization_id, job_number, customer_id)
    values (ids.b_job, ids.b_org, 990001, ids.b_customer);
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, detail)
    values ('TI-000', 'setup', 'jobs', 'insert', 'FAILED: ' || sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.estimates (id, organization_id, estimate_number)
    values (ids.b_estimate, ids.b_org, 990001);
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, detail)
    values ('TI-000', 'setup', 'estimates', 'insert', 'FAILED: ' || sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.contracts (id, organization_id, body)
    values (ids.b_contract, ids.b_org, 'Synthetic compliance contract body');
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, detail)
    values ('TI-000', 'setup', 'contracts', 'insert', 'FAILED: ' || sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.invoices (id, organization_id, invoice_number)
    values (ids.b_invoice, ids.b_org, 990001);
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, detail)
    values ('TI-000', 'setup', 'invoices', 'insert', 'FAILED: ' || sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.invoice_payments (id, organization_id, invoice_id, method, amount_cents)
    values (ids.b_payment, ids.b_org, ids.b_invoice, 'cash', 100);
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, detail)
    values ('TI-000', 'setup', 'invoice_payments', 'insert', 'FAILED: ' || sqlstate || ' ' || sqlerrm);
  end;

  begin
    -- Folders are seeded by a trigger when the organization is created.
    select id into folder from public.document_folders where organization_id = ids.b_org order by created_at limit 1;
    insert into public.documents (id, organization_id, folder_id, storage_path, file_name, display_name)
    values (ids.b_document, ids.b_org, folder,
            ids.b_org::text || '/compliance/' || ids.b_document::text || '.pdf',
            'synthetic.pdf', 'Synthetic compliance document');
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, detail)
    values ('TI-000', 'setup', 'documents', 'insert', 'FAILED: ' || sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.conversations (id, organization_id, customer_id)
    values (ids.b_conversation, ids.b_org, ids.b_customer);
    insert into public.messages (id, organization_id, conversation_id, direction, body)
    values (ids.b_message, ids.b_org, ids.b_conversation, 'inbound', 'Synthetic compliance message');
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, detail)
    values ('TI-000', 'setup', 'conversations/messages', 'insert', 'FAILED: ' || sqlstate || ' ' || sqlerrm);
  end;

  begin
    insert into public.messaging_settings (organization_id)
    select ids.b_org where not exists (select 1 from public.messaging_settings where organization_id = ids.b_org);
    insert into public.service_settings (organization_id)
    select ids.b_org where not exists (select 1 from public.service_settings where organization_id = ids.b_org);
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, detail)
    values ('TI-000', 'setup', 'settings', 'insert', 'FAILED: ' || sqlstate || ' ' || sqlerrm);
  end;

  begin
    -- Not active for either tenant, so the self-upgrade check below is meaningful.
    insert into public.organization_subscriptions (organization_id, provider, plan, status)
    values (ids.b_org, 'stripe', 'premium', 'canceled'), (ids.a_org, 'stripe', 'premium', 'canceled');
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, detail)
    values ('TI-000', 'setup', 'organization_subscriptions', 'insert', 'FAILED: ' || sqlstate || ' ' || sqlerrm);
  end;

  begin
    -- Metadata row only; no file bytes are uploaded and nothing leaves the database.
    insert into storage.objects (bucket_id, name, owner)
    values ('business-documents', ids.b_org::text || '/compliance/' || ids.b_document::text || '.pdf', ids.b_user);
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, detail)
    values ('TI-000', 'setup', 'storage.objects', 'insert', 'FAILED: ' || sqlstate || ' ' || sqlerrm);
  end;
end
$setup$;

-- How many B rows exist for each checked table, seen without RLS. A check whose
-- seeded count is 0 proves nothing.
create temp table _ti_seeded (table_name text primary key, seeded bigint) on commit drop;
grant select on _ti_seeded to authenticated, anon;

do $seed$
declare
  ids _ti_ids;
  t text;
  n bigint;
begin
  select * into ids from _ti_ids;
  foreach t in array array['customers','properties','jobs','estimates','contracts','invoices','invoice_payments',
                           'documents','conversations','messages','messaging_settings','service_settings',
                           'organization_members','organization_subscriptions','activity_events','messaging_consent'] loop
    execute format('select count(*) from public.%I where organization_id = $1', t) into n using ids.b_org;
    insert into _ti_seeded values (t, n);
  end loop;
  select count(*) into n from public.organizations where id = ids.b_org;
  insert into _ti_seeded values ('organizations', n);
  select count(*) into n from storage.objects where bucket_id = 'business-documents' and name like ids.b_org::text || '/%';
  insert into _ti_seeded values ('storage.objects', n);
end
$seed$;

---------------------------------------------------------------------------
-- 2. As Tenant A's signed-in user
---------------------------------------------------------------------------

-- Plain SET (not SET LOCAL): an implicit transaction may ignore SET LOCAL, and the
-- final abort reverts these settings anyway.
set role authenticated;
select set_config('request.jwt.claims',
                  json_build_object('sub', (select a_user from _ti_ids), 'role', 'authenticated', 'aal', 'aal1')::text,
                  false);

do $as_a$
declare
  ids _ti_ids;
  t text;
  n bigint;
  s bigint;
  tables text[] := array['customers','properties','jobs','estimates','contracts','invoices','invoice_payments',
                         'documents','conversations','messages','messaging_settings','service_settings',
                         'organization_members','organization_subscriptions','activity_events','messaging_consent'];
begin
  select * into ids from _ti_ids;

  -- Sanity: the session really is Tenant A's user.
  insert into _ti_results (test_id, phase, table_name, operation, expected, actual, passed, detail)
  values ('TI-001', 'as_a', '-', 'auth.uid() is A and role is authenticated', 1,
          case when auth.uid() = ids.a_user and current_user = 'authenticated' then 1 else 0 end,
          auth.uid() = ids.a_user and current_user = 'authenticated',
          'auth.uid()=' || coalesce(auth.uid()::text, 'null') || ' current_user=' || current_user);

  foreach t in array tables loop
    select seeded into s from _ti_seeded where table_name = t;

    -- TI-002 SELECT B rows
    begin
      execute format('select count(*) from public.%I where organization_id = $1', t) into n using ids.b_org;
      insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, actual, passed)
      values ('TI-002', 'as_a', t, 'select B rows', s, 0, n, n = 0);
    exception when others then
      insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, blocked, passed, detail)
      values ('TI-002', 'as_a', t, 'select B rows', s, 0, true, true, sqlstate || ' ' || sqlerrm);
    end;

    -- TI-003 UPDATE B rows (no-op assignment; any row returned means RLS let it through)
    begin
      execute format('with u as (update public.%I set organization_id = organization_id where organization_id = $1 returning 1) select count(*) from u', t)
        into n using ids.b_org;
      insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, actual, passed)
      values ('TI-003', 'as_a', t, 'update B rows', s, 0, n, n = 0);
    exception when others then
      insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, blocked, passed, detail)
      values ('TI-003', 'as_a', t, 'update B rows', s, 0, true, true, sqlstate || ' ' || sqlerrm);
    end;

    -- TI-004 DELETE B rows
    begin
      execute format('with d as (delete from public.%I where organization_id = $1 returning 1) select count(*) from d', t)
        into n using ids.b_org;
      insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, actual, passed)
      values ('TI-004', 'as_a', t, 'delete B rows', s, 0, n, n = 0);
    exception when others then
      insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, blocked, passed, detail)
      values ('TI-004', 'as_a', t, 'delete B rows', s, 0, true, true, sqlstate || ' ' || sqlerrm);
    end;
  end loop;

  -- TI-005 organization row and settings of B
  select seeded into s from _ti_seeded where table_name = 'organizations';
  select count(*) into n from public.organizations where id = ids.b_org;
  insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, actual, passed)
  values ('TI-005', 'as_a', 'organizations', 'select B org', s, 0, n, n = 0);
  begin
    with u as (update public.organizations set name = name where id = ids.b_org returning 1) select count(*) into n from u;
    insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, actual, passed)
    values ('TI-005', 'as_a', 'organizations', 'update B org', s, 0, n, n = 0);
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, blocked, passed, detail)
    values ('TI-005', 'as_a', 'organizations', 'update B org', s, 0, true, true, sqlstate || ' ' || sqlerrm);
  end;
  begin
    with d as (delete from public.organizations where id = ids.b_org returning 1) select count(*) into n from d;
    insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, actual, passed)
    values ('TI-005', 'as_a', 'organizations', 'delete B org', s, 0, n, n = 0);
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, blocked, passed, detail)
    values ('TI-005', 'as_a', 'organizations', 'delete B org', s, 0, true, true, sqlstate || ' ' || sqlerrm);
  end;

  -- TI-006 INSERT a row carrying B's organization_id (must be refused)
  begin
    insert into public.customers (organization_id, first_name) values (ids.b_org, 'Planted by A');
    insert into _ti_results (test_id, phase, table_name, operation, expected, blocked, passed, detail)
    values ('TI-006', 'as_a', 'customers', 'insert with B org id', 0, false, false, 'INSERT SUCCEEDED (cross-tenant write)');
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, expected, blocked, passed, detail)
    values ('TI-006', 'as_a', 'customers', 'insert with B org id', 0, true, true, sqlstate || ' ' || sqlerrm);
  end;
  begin
    insert into public.organization_members (organization_id, user_id, role) values (ids.b_org, ids.a_user, 'technician');
    insert into _ti_results (test_id, phase, table_name, operation, expected, blocked, passed, detail)
    values ('TI-006', 'as_a', 'organization_members', 'join B directly', 0, false, false, 'INSERT SUCCEEDED (joined another tenant)');
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, expected, blocked, passed, detail)
    values ('TI-006', 'as_a', 'organization_members', 'join B directly', 0, true, true, sqlstate || ' ' || sqlerrm);
  end;

  -- TI-007 Move A's own row into B (must be refused)
  begin
    update public.customers set organization_id = ids.b_org where id = ids.a_customer;
    get diagnostics n = row_count;
    insert into _ti_results (test_id, phase, table_name, operation, expected, actual, blocked, passed, detail)
    values ('TI-007', 'as_a', 'customers', 'move own row to B', 0, n, n = 0, n = 0,
            case when n = 0 then 'no row updated' else 'ROW MOVED TO ANOTHER TENANT' end);
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, expected, blocked, passed, detail)
    values ('TI-007', 'as_a', 'customers', 'move own row to B', 0, true, true, sqlstate || ' ' || sqlerrm);
  end;

  -- TI-008 Reference B's customer from an A row (cross-tenant FK)
  begin
    insert into public.jobs (organization_id, job_number, customer_id) values (ids.a_org, 990002, ids.b_customer);
    insert into _ti_results (test_id, phase, table_name, operation, expected, blocked, passed, detail)
    values ('TI-008', 'as_a', 'jobs', 'A job pointing at B customer', 0, false, false, 'INSERT SUCCEEDED (cross-tenant reference)');
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, expected, blocked, passed, detail)
    values ('TI-008', 'as_a', 'jobs', 'A job pointing at B customer', 0, true, true, sqlstate || ' ' || sqlerrm);
  end;

  -- TI-009 SECURITY DEFINER RPCs with B identifiers
  begin
    select count(*) into n from public.organization_roster(ids.b_org);
    insert into _ti_results (test_id, phase, table_name, operation, expected, actual, passed)
    values ('TI-009', 'as_a', 'rpc organization_roster', 'roster of B', 0, n, n = 0);
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, expected, blocked, passed, detail)
    values ('TI-009', 'as_a', 'rpc organization_roster', 'roster of B', 0, true, true, sqlstate || ' ' || sqlerrm);
  end;

  -- TI-010 Storage: list / overwrite / delete B's object metadata, each in its own block so
  -- one refusal does not discard the other results.
  select seeded into s from _ti_seeded where table_name = 'storage.objects';
  begin
    select count(*) into n from storage.objects where bucket_id = 'business-documents' and name like ids.b_org::text || '/%';
    insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, actual, passed)
    values ('TI-010', 'as_a', 'storage.objects', 'list B objects', s, 0, n, n = 0);
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, blocked, passed, detail)
    values ('TI-010', 'as_a', 'storage.objects', 'list B objects', s, 0, true, true, sqlstate || ' ' || sqlerrm);
  end;
  begin
    with u as (update storage.objects set metadata = metadata where bucket_id = 'business-documents' and name like ids.b_org::text || '/%' returning 1)
      select count(*) into n from u;
    insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, actual, passed)
    values ('TI-010', 'as_a', 'storage.objects', 'update B objects', s, 0, n, n = 0);
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, blocked, passed, detail)
    values ('TI-010', 'as_a', 'storage.objects', 'update B objects', s, 0, true, true, sqlstate || ' ' || sqlerrm);
  end;
  begin
    with d as (delete from storage.objects where bucket_id = 'business-documents' and name like ids.b_org::text || '/%' returning 1)
      select count(*) into n from d;
    insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, actual, passed)
    values ('TI-010', 'as_a', 'storage.objects', 'delete B objects', s, 0, n, n = 0);
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, seeded, expected, blocked, passed, detail)
    values ('TI-010', 'as_a', 'storage.objects', 'delete B objects', s, 0, true, true, sqlstate || ' ' || sqlerrm);
  end;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('business-documents', ids.b_org::text || '/compliance/planted-by-a.pdf', ids.a_user);
    insert into _ti_results (test_id, phase, table_name, operation, expected, blocked, passed, detail)
    values ('TI-010', 'as_a', 'storage.objects', 'upload into B prefix', 0, false, false, 'INSERT SUCCEEDED (wrote into another tenant path)');
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, expected, blocked, passed, detail)
    values ('TI-010', 'as_a', 'storage.objects', 'upload into B prefix', 0, true, true, sqlstate || ' ' || sqlerrm);
  end;

  -- TI-011 Within-tenant privilege: A's owner sets its OWN subscription to active
  -- without paying (lead from payments audit; SEC-002-010 / SEC-002-012).
  begin
    with u as (update public.organization_subscriptions set status = 'active' where organization_id = ids.a_org returning 1)
      select count(*) into n from u;
    insert into _ti_results (test_id, phase, table_name, operation, expected, actual, passed, detail)
    values ('TI-011', 'as_a', 'organization_subscriptions', 'self-upgrade own plan to active', 0, n, n = 0,
            case when n = 0 then 'refused' else 'OWNER/ADMIN CAN GRANT ITSELF A PAID PLAN' end);
  exception when others then
    insert into _ti_results (test_id, phase, table_name, operation, expected, blocked, passed, detail)
    values ('TI-011', 'as_a', 'organization_subscriptions', 'self-upgrade own plan to active', 0, true, true, sqlstate || ' ' || sqlerrm);
  end;
end
$as_a$;

---------------------------------------------------------------------------
-- 3. As anon (publishable key only)
---------------------------------------------------------------------------

reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);

do $as_anon$
declare
  ids _ti_ids;
  t text;
  n bigint;
begin
  select * into ids from _ti_ids;
  foreach t in array array['customers','jobs','estimates','contracts','invoices','invoice_payments','documents',
                           'conversations','messages','organization_members','organization_subscriptions'] loop
    begin
      if current_user <> 'anon' then raise exception 'not running as anon (current_user=%)', current_user; end if;
      execute format('select count(*) from public.%I where organization_id = $1', t) into n using ids.b_org;
      insert into _ti_results (test_id, phase, table_name, operation, expected, actual, passed)
      values ('TI-012', 'anon', t, 'select B rows', 0, n, n = 0);
    exception when others then
      insert into _ti_results (test_id, phase, table_name, operation, expected, blocked, passed, detail)
      values ('TI-012', 'anon', t, 'select B rows', 0, true, true, sqlstate || ' ' || sqlerrm);
    end;
  end loop;
end
$as_anon$;

reset role;

---------------------------------------------------------------------------
-- 4. Results, then throw everything away
---------------------------------------------------------------------------
-- This statement always fails on purpose. The failure aborts the implicit
-- transaction, so nothing above persists. The results travel in the message.

do $report$
declare
  summary json;
  rows json;
begin
  select json_build_object(
           'passed', count(*) filter (where passed),
           'failed', count(*) filter (where passed is false),
           'setup_problems', count(*) filter (where phase = 'setup'),
           'vacuous_checks', count(*) filter (where seeded = 0))
    into summary from _ti_results;
  select json_agg(json_build_object('t', test_id, 'ph', phase, 'tbl', table_name, 'op', operation,
                                    'seeded', seeded, 'exp', expected, 'act', actual, 'blocked', blocked,
                                    'pass', passed, 'detail', detail) order by seq)
    into rows from _ti_results;
  raise exception 'TI_RESULTS %', json_build_object('summary', summary, 'results', rows)::text;
end
$report$;
