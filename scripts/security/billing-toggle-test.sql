-- Disposable-database test for 20261111020000_technician_billing_toggle.sql.
-- Runs after role-guard-stub.sql and 20261111010000 (see role-guard-test.sql);
-- adds the billing tables it needs. Never point this at a real database.

create or replace function private.is_org_member(target_organization_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.organization_members m
    where m.organization_id = target_organization_id and m.user_id = (select auth.uid()));
$$;
grant usage on schema private to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid,
  status text not null default 'sent',
  total_cents integer not null default 10000,
  balance_due_cents integer,
  stripe_invoice_id text,
  paid_at timestamptz
);
create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid, invoice_id uuid, job_id uuid, method text, amount_cents integer, note text, recorded_by uuid
);
create table public.payments (id uuid primary key default gen_random_uuid(), organization_id uuid not null, status text);
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.organizations enable row level security;
create policy "members read invoices" on public.invoices for select using ((select private.is_org_member(organization_id)));
create policy "Organization members can update invoices" on public.invoices for update using ((select private.is_org_member(organization_id)));
create policy "members read payments" on public.payments for select using ((select private.is_org_member(organization_id)));
create policy "read orgs" on public.organizations for select using (true);
create policy "Admins can update organizations" on public.organizations for update using (true) with check (true);
alter table public.organizations add column name text;
grant select, insert, update, delete on public.invoices, public.payments, public.organizations to authenticated;

\ir ../../supabase/migrations/20261111020000_technician_billing_toggle.sql

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'tess@example.test');
insert into public.organization_members (organization_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1', 'technician');
insert into public.invoices (id, organization_id, status) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'sent'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', 'sent');
insert into public.payments (organization_id, status) values ('10000000-0000-0000-0000-00000000000a', 'succeeded');

create or replace function pg_temp.rows_changed(statement text) returns integer language plpgsql as $$
declare n integer;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end $$;

-- Default on: a technician can edit billing as before.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
do $$ begin
  if pg_temp.rows_changed($q$update public.invoices set total_cents = 12000 where id = '20000000-0000-0000-0000-000000000001'$q$) <> 1 then
    raise exception 'FAIL technician could not edit with the setting on';
  end if;
  perform public.record_invoice_payment('20000000-0000-0000-0000-000000000001', 'cash', 100);
  raise notice 'PASS setting on: technician edits and records a payment';
end $$;

-- A technician or an admin cannot turn it off; the owner can.
select pg_temp.expect_refused($$update public.organizations set technicians_can_edit_billing = false where id = '10000000-0000-0000-0000-00000000000a'$$, 'technician turns the setting off');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_refused($$update public.organizations set technicians_can_edit_billing = false where id = '10000000-0000-0000-0000-00000000000a'$$, 'admin turns the setting off');
select pg_temp.expect_refused($$update public.organizations set created_by = '00000000-0000-0000-0000-0000000000a1' where id = '10000000-0000-0000-0000-00000000000a'$$, 'admin makes themselves the creator');
select pg_temp.expect_allowed($$update public.organizations set name = 'Renamed' where id = '10000000-0000-0000-0000-00000000000a'$$, 'admin edits other business details');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_allowed($$update public.organizations set technicians_can_edit_billing = false where id = '10000000-0000-0000-0000-00000000000a'$$, 'owner turns the setting off');

-- Off: the technician is read-only on billing; the admin is not.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  if pg_temp.rows_changed($q$update public.invoices set total_cents = 1 where id = '20000000-0000-0000-0000-000000000002'$q$) <> 0 then
    raise exception 'FAIL technician edited an invoice with the setting off';
  end if;
  if pg_temp.rows_changed($q$delete from public.invoices where id = '20000000-0000-0000-0000-000000000002'$q$) <> 0 then
    raise exception 'FAIL technician deleted an invoice with the setting off';
  end if;
  if pg_temp.rows_changed($q$update public.payments set status = 'refunded'$q$) <> 0 then
    raise exception 'FAIL technician edited a payment with the setting off';
  end if;
  if (select count(*) from public.invoices) <> 2 then
    raise exception 'FAIL technician can no longer see invoices';
  end if;
  raise notice 'PASS setting off: technician cannot edit, delete or change payments, and still sees invoices';
end $$;
select pg_temp.expect_refused($$insert into public.invoices (organization_id) values ('10000000-0000-0000-0000-00000000000a')$$, 'technician raises an invoice with the setting off');
select pg_temp.expect_refused($$select public.record_invoice_payment('20000000-0000-0000-0000-000000000002', 'cash', 100)$$, 'technician records a payment with the setting off');
select pg_temp.expect_refused($$select public.record_invoice_paid_in_hand('20000000-0000-0000-0000-000000000002', 'cash')$$, 'technician marks paid in hand with the setting off');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  if pg_temp.rows_changed($q$update public.invoices set total_cents = 15000 where id = '20000000-0000-0000-0000-000000000002'$q$) <> 1 then
    raise exception 'FAIL admin lost billing with the technician setting off';
  end if;
  perform public.record_invoice_paid_in_hand('20000000-0000-0000-0000-000000000002', 'check');
  raise notice 'PASS setting off: admin still edits and records payments';
end $$;
reset role;
