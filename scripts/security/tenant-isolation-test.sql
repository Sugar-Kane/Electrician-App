-- Two businesses, side by side, on the whole replayed schema.
--
-- Run on a disposable database built from every migration:
--   scripts/security/replay-migrations.sh scripts/security/tenant-isolation-test.sql
--
-- Each check runs as a real caller: `authenticated` with that person's id as
-- auth.uid(), or `service_role`. Everything happens inside one transaction that
-- is rolled back, so the database is left as it was. Never run against a real
-- project.
--
-- Covers audit findings MT-01 (references across businesses, businesses
-- changing hands), MT-02 (stored file paths), and the read/write/aggregate
-- isolation checks from the readiness report's adversarial matrix.

\set ON_ERROR_STOP 1
begin;

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', what; end if;
  raise notice 'PASS: %', what;
end $$;

-- Runs a statement that must be refused with the given SQLSTATE (any, if null).
create or replace function pg_temp.refused(statement text, what text, code text default null) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if code is not null and sqlstate <> code then
      raise exception 'FAIL (refused for the wrong reason, % %): %', sqlstate, sqlerrm, what;
    end if;
    raise notice 'PASS (refused %): %', sqlstate, what;
    return;
  end;
  raise exception 'FAIL (was allowed): %', what;
end $$;

create or replace function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(user_id::text, ''), true);
end $$;

grant execute on all functions in schema pg_temp to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Two businesses: an owner each, and one person who belongs to both.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'both@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'tech-a@example.test');
insert into public.organizations (id, name, slug, created_by) values
  ('a1000000-0000-4000-8000-00000000000a', 'Isolation A', 'isolation-a', 'a0000000-0000-4000-8000-00000000000a'),
  ('b1000000-0000-4000-8000-00000000000b', 'Isolation B', 'isolation-b', 'b0000000-0000-4000-8000-00000000000b');
insert into public.organization_members (organization_id, user_id, role) values
  ('a1000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'owner'),
  ('b1000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-00000000000b', 'owner'),
  ('a1000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000000d', 'admin'),
  ('b1000000-0000-4000-8000-00000000000b', 'd0000000-0000-4000-8000-00000000000d', 'admin'),
  ('a1000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-00000000000c', 'technician');
insert into public.customers (id, organization_id, first_name, last_name) values
  ('a2000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a', 'Ann', 'A'),
  ('b2000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'Bob', 'B');
insert into public.jobs (id, organization_id, job_number, customer_id) values
  ('a3000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a', 9001, 'a2000000-0000-4000-8000-00000000000a'),
  ('b3000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 9001, 'b2000000-0000-4000-8000-00000000000b');
insert into public.invoices (id, organization_id, job_id, status, subtotal_cents, total_cents, balance_due_cents) values
  ('a4000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'sent', 10000, 10000, 10000),
  ('b4000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'b3000000-0000-4000-8000-00000000000b', 'sent', 77700, 77700, 77700);
insert into public.document_folders (id, organization_id, folder_key, display_name) values
  ('a5000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a', 'isolation-a', 'A files'),
  ('b5000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'isolation-b', 'B files');

-- ---------------------------------------------------------------------------
-- Reads, writes and totals stay inside the business (matrix 1, 2, 3, 10, 14)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a');
select pg_temp.check((select count(*) from public.jobs where id = 'b3000000-0000-4000-8000-00000000000b') = 0, 'A cannot read B''s job');
select pg_temp.check((select count(*) from public.invoices where id = 'b4000000-0000-4000-8000-00000000000b') = 0, 'A cannot read B''s invoice');
select pg_temp.check((select count(*) from public.customers where last_name = 'B') = 0, 'A''s customer search never finds B''s customers');
select pg_temp.check((select coalesce(sum(total_cents), 0) from public.invoices where organization_id in ('a1000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000b')) = 10000, 'A''s invoice total counts only A''s invoices');
update public.customers set first_name = 'Hijacked' where id = 'b2000000-0000-4000-8000-00000000000b';
select pg_temp.refused($$insert into public.customers (organization_id, first_name) values ('b1000000-0000-4000-8000-00000000000b', 'Planted')$$, 'A cannot create a customer in B', '42501');
reset role;
select pg_temp.check((select first_name from public.customers where id = 'b2000000-0000-4000-8000-00000000000b') = 'Bob', 'A''s update of B''s customer changed nothing');

-- ---------------------------------------------------------------------------
-- MT-01: references never cross businesses (matrix 4, 6, 13)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a');
select pg_temp.refused($$insert into public.jobs (organization_id, job_number, customer_id) values ('a1000000-0000-4000-8000-00000000000a', 9002, 'b2000000-0000-4000-8000-00000000000b')$$, 'A cannot create a job for B''s customer', '23514');
select pg_temp.refused($$update public.jobs set customer_id = 'b2000000-0000-4000-8000-00000000000b' where id = 'a3000000-0000-4000-8000-00000000000a'$$, 'A cannot point its job at B''s customer', '23514');
select pg_temp.refused($$insert into public.invoices (organization_id, job_id, status) values ('a1000000-0000-4000-8000-00000000000a', 'b3000000-0000-4000-8000-00000000000b', 'draft')$$, 'A cannot bill B''s job', '23514');
select pg_temp.refused($$insert into public.job_line_items (organization_id, job_id, kind, description, quantity, unit_price_cents) values ('a1000000-0000-4000-8000-00000000000a', 'b3000000-0000-4000-8000-00000000000b', 'labor', 'x', 1, 100)$$, 'A cannot add a line to B''s job', '23514');
select pg_temp.refused($$insert into public.contracts (organization_id, job_id, body) values ('a1000000-0000-4000-8000-00000000000a', 'b3000000-0000-4000-8000-00000000000b', 'x')$$, 'A cannot draw up a contract on B''s job', '23514');
select pg_temp.refused($$insert into public.change_orders (organization_id, job_id, description) values ('a1000000-0000-4000-8000-00000000000a', 'b3000000-0000-4000-8000-00000000000b', 'x')$$, 'A cannot start a change order on B''s job');
select pg_temp.refused($$insert into public.documents (organization_id, folder_id, storage_path, file_name, display_name, uploaded_by) values ('a1000000-0000-4000-8000-00000000000a', 'b5000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-00000000000a/x/f.pdf', 'f.pdf', 'f', 'a0000000-0000-4000-8000-00000000000a')$$, 'A cannot file a document in B''s folder', '23514');
-- Same-business work is unaffected.
insert into public.jobs (id, organization_id, job_number, customer_id) values ('a3000000-0000-4000-8000-0000000000a2', 'a1000000-0000-4000-8000-00000000000a', 9002, 'a2000000-0000-4000-8000-00000000000a');
select pg_temp.check((select count(*) from public.jobs where id = 'a3000000-0000-4000-8000-0000000000a2') = 1, 'A can still create a job for its own customer');
reset role;

-- The service role is held to the same rule: a bug in server code cannot plant one either.
set local role service_role;
select pg_temp.refused($$insert into public.jobs (organization_id, job_number, customer_id) values ('a1000000-0000-4000-8000-00000000000a', 9003, 'b2000000-0000-4000-8000-00000000000b')$$, 'the service role cannot create a cross-business job either', '23514');
reset role;

-- ---------------------------------------------------------------------------
-- MT-01: a record never changes business, even for someone in both (matrix 6)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d');
select pg_temp.refused($$update public.customers set organization_id = 'b1000000-0000-4000-8000-00000000000b' where id = 'a2000000-0000-4000-8000-00000000000a'$$, 'a member of both businesses cannot move a customer between them', '42501');
select pg_temp.refused($$update public.invoices set organization_id = 'b1000000-0000-4000-8000-00000000000b' where id = 'a4000000-0000-4000-8000-00000000000a'$$, 'a member of both businesses cannot move an invoice between them', '42501');
reset role;

-- Deleting a parent still clears references the way it always did.
delete from public.jobs where id = 'a3000000-0000-4000-8000-0000000000a2';
select pg_temp.check(not exists (select 1 from public.jobs where id = 'a3000000-0000-4000-8000-0000000000a2'), 'ordinary deletes still work with the guards in place');

-- ---------------------------------------------------------------------------
-- MT-02: stored file paths stay under their owner (matrix 5)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a');
select pg_temp.refused($$insert into public.documents (organization_id, folder_id, storage_path, file_name, display_name, uploaded_by) values ('a1000000-0000-4000-8000-00000000000a', 'a5000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000b/jobs/secret.pdf', 'f.pdf', 'f', 'a0000000-0000-4000-8000-00000000000a')$$, 'A cannot store a document row naming B''s file', '23514');
select pg_temp.refused($$insert into public.documents (organization_id, folder_id, storage_path, file_name, display_name, uploaded_by) values ('a1000000-0000-4000-8000-00000000000a', 'a5000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a/jobs/../../b1000000-0000-4000-8000-00000000000b/secret.pdf', 'f.pdf', 'f', 'a0000000-0000-4000-8000-00000000000a')$$, 'A cannot reach B''s file through ".."', '23514');
select pg_temp.refused($$insert into public.documents (organization_id, folder_id, storage_path, file_name, display_name, uploaded_by) values ('a1000000-0000-4000-8000-00000000000a', 'a5000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a/%2e%2e/secret.pdf', 'f.pdf', 'f', 'a0000000-0000-4000-8000-00000000000a')$$, 'percent-encoded paths are refused', '23514');
select pg_temp.refused($$insert into public.documents (organization_id, folder_id, storage_path, file_name, display_name, uploaded_by) values ('a1000000-0000-4000-8000-00000000000a', 'a5000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a/secret.pdf', 'f.pdf', 'f', 'a0000000-0000-4000-8000-00000000000a')$$, 'a document needs a folder under the business', '23514');
insert into public.documents (organization_id, folder_id, storage_path, file_name, display_name, uploaded_by)
values ('a1000000-0000-4000-8000-00000000000a', 'a5000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a/jobs/photo.jpg', 'photo.jpg', 'Photo', 'a0000000-0000-4000-8000-00000000000a');
select pg_temp.check((select count(*) from public.documents where storage_path = 'a1000000-0000-4000-8000-00000000000a/jobs/photo.jpg') = 1, 'A can still file its own document');
reset role;
select pg_temp.refused($$insert into public.inventory_items (organization_id, name, photo_path) values ('a1000000-0000-4000-8000-00000000000a', 'Breaker', 'b1000000-0000-4000-8000-00000000000b/inventory/p.jpg')$$, 'a stock photo cannot name another business''s file', '23514');
select pg_temp.refused($$update public.organizations set logo_path = 'b1000000-0000-4000-8000-00000000000b/logo.png' where id = 'a1000000-0000-4000-8000-00000000000a'$$, 'a logo cannot name another business''s file', '23514');
select pg_temp.refused($$insert into public.user_profiles (user_id, display_name, avatar_path) values ('a0000000-0000-4000-8000-00000000000a', 'Owner A', 'b0000000-0000-4000-8000-00000000000b/face.png')$$, 'an avatar cannot name another person''s file', '23514');

-- ---------------------------------------------------------------------------
-- MT-06: the MCP call log is for owners and admins of that business only
-- ---------------------------------------------------------------------------
insert into public.mcp_call_log (organization_id, method, tool_name, arguments)
values ('a1000000-0000-4000-8000-00000000000a', 'tools/call', 'search_customers', '{"job_number": 9001}');
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c');
select pg_temp.check((select count(*) from public.mcp_call_log where organization_id = 'a1000000-0000-4000-8000-00000000000a') = 0, 'a technician cannot read the MCP call log');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b');
select pg_temp.check((select count(*) from public.mcp_call_log where organization_id = 'a1000000-0000-4000-8000-00000000000a') = 0, 'another business''s owner cannot read it');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a');
select pg_temp.check((select count(*) from public.mcp_call_log where organization_id = 'a1000000-0000-4000-8000-00000000000a') = 1, 'the business''s owner can');
reset role;
select pg_temp.check(private.mcp_log_kept_arguments('{"job_number": 9001, "customer_name": "Ann A", "phone": "805-555-0100", "status": "sent"}') = '{"job_number": 9001, "status": "sent"}'::jsonb, 'old log rows keep ids and states, never names or numbers');

-- ---------------------------------------------------------------------------
-- Coverage: every reference between business tables is guarded. Fails when a
-- later migration adds a table or reference without re-running
-- private.attach_tenant_guards().
-- ---------------------------------------------------------------------------
select pg_temp.check(not exists (
  select 1
  from pg_constraint as foreign_key
  join pg_class as child on child.oid = foreign_key.conrelid
  join pg_namespace as child_schema on child_schema.oid = child.relnamespace
  join pg_class as parent on parent.oid = foreign_key.confrelid
  join pg_namespace as parent_schema on parent_schema.oid = parent.relnamespace
  join pg_attribute as referencing on referencing.attrelid = foreign_key.conrelid and referencing.attnum = foreign_key.conkey[1]
  join pg_attribute as referenced on referenced.attrelid = foreign_key.confrelid and referenced.attnum = foreign_key.confkey[1]
  where foreign_key.contype = 'f' and child_schema.nspname = 'public' and parent_schema.nspname = 'public'
    and array_length(foreign_key.conkey, 1) = 1 and referencing.attname <> 'organization_id' and referenced.attname = 'id'
    and exists (select 1 from pg_attribute where attrelid = child.oid and attname = 'organization_id' and not attisdropped)
    and exists (select 1 from pg_attribute where attrelid = parent.oid and attname = 'organization_id' and not attisdropped)
    and not exists (
      select 1 from pg_trigger as guard
      where guard.tgrelid = child.oid and guard.tgname = 'zz_tenant_references_guard'
        and position(quote_literal(referencing.attname) in pg_get_triggerdef(guard.oid)) > 0
    )
), 'every reference between business tables is guarded');
select pg_temp.check(not exists (
  select 1 from pg_class as owner_table
  join pg_namespace as owner_schema on owner_schema.oid = owner_table.relnamespace
  join pg_attribute as column_row on column_row.attrelid = owner_table.oid
  where owner_schema.nspname = 'public' and owner_table.relkind = 'r'
    and column_row.attname = 'organization_id' and not column_row.attisdropped
    and not exists (select 1 from pg_trigger where tgrelid = owner_table.oid and tgname = 'zz_tenant_owner_immutable')
), 'every business table keeps its rows in their business');

rollback;
\echo ALL TENANT ISOLATION CHECKS PASSED
