-- Disposable-database test for 20261111010000_security_role_and_rpc_hardening.sql.
--
-- Runs against an empty local Postgres with a minimal stand-in for Supabase's
-- auth schema. Never point this at a real database.
--
--   psql -v ON_ERROR_STOP=1 -f scripts/security/role-guard-stub.sql \
--        -f supabase/migrations/20261111010000_security_role_and_rpc_hardening.sql \
--        -f scripts/security/role-guard-test.sql

create or replace function pg_temp.expect_refused(statement text, label text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when insufficient_privilege then
    raise notice 'PASS refused: %', label;
    return;
  end;
  raise exception 'FAIL not refused: %', label;
end $$;

create or replace function pg_temp.expect_allowed(statement text, label text) returns void language plpgsql as $$
begin
  execute statement;
  raise notice 'PASS allowed: %', label;
end $$;

create or replace function pg_temp.as_user(id text) returns void language sql as $$
  select set_config('test.uid', id, false);
$$;

-- Business A: owner Ann (also the creator), admin Al. Business B: owner Bea.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ann@example.test'),
  ('00000000-0000-0000-0000-0000000000a1', 'al@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'cal@example.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'dee@example.test');
insert into public.organizations (id, created_by) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b');
insert into public.organization_members (organization_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'owner');

-- The admin cannot raise themselves, demote or remove the owner, add an owner,
-- or invite one.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_refused($$update public.organization_members set role = 'owner' where user_id = '00000000-0000-0000-0000-0000000000a1'$$, 'admin promotes self to owner');
select pg_temp.expect_refused($$update public.organization_members set role = 'technician' where user_id = '00000000-0000-0000-0000-00000000000a'$$, 'admin demotes the owner');
select pg_temp.expect_refused($$delete from public.organization_members where user_id = '00000000-0000-0000-0000-00000000000a'$$, 'admin removes the owner');
select pg_temp.expect_refused($$insert into public.organization_members (organization_id, user_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'owner')$$, 'admin adds an owner');
select pg_temp.expect_refused($$insert into public.organization_invitations (organization_id, email, role) values ('10000000-0000-0000-0000-00000000000a', 'cal@example.test', 'owner')$$, 'admin invites an owner');
select pg_temp.expect_refused($$update public.organization_members set organization_id = '10000000-0000-0000-0000-00000000000b' where user_id = '00000000-0000-0000-0000-0000000000a1'$$, 'admin moves a membership to another business');

-- What an admin is meant to do still works.
select pg_temp.expect_allowed($$insert into public.organization_invitations (organization_id, email, role) values ('10000000-0000-0000-0000-00000000000a', 'cal@example.test', 'technician')$$, 'admin invites a technician');
select pg_temp.expect_allowed($$insert into public.organization_members (organization_id, user_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'technician')$$, 'admin adds a technician');
select pg_temp.expect_allowed($$update public.organization_members set role = 'dispatcher' where user_id = '00000000-0000-0000-0000-0000000000c1'$$, 'admin changes a technician to dispatcher');
select pg_temp.expect_refused($$update public.organization_invitations set role = 'owner' where email = 'cal@example.test'$$, 'admin upgrades an invitation to owner');

-- An owner of another business has no say here.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_refused($$update public.organization_members set role = 'admin' where user_id = '00000000-0000-0000-0000-00000000000a'$$, 'other business owner demotes our owner');

-- The owner can do all of it, and an owner invitation they send can be accepted.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_allowed($$insert into public.organization_invitations (organization_id, email, role) values ('10000000-0000-0000-0000-00000000000a', 'dee@example.test', 'owner')$$, 'owner invites an owner');
select pg_temp.expect_allowed($$update public.organization_members set role = 'owner' where user_id = '00000000-0000-0000-0000-0000000000a1'$$, 'owner promotes the admin');
select pg_temp.expect_allowed($$update public.organization_members set role = 'admin' where user_id = '00000000-0000-0000-0000-0000000000a1'$$, 'owner demotes them again');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.expect_allowed($$insert into public.organization_members (organization_id, user_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', 'owner')$$, 'invitee accepts an owner invitation');
select pg_temp.expect_refused($$insert into public.organization_members (organization_id, user_id, role) values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'owner')$$, 'invitee joins another business as owner uninvited');

-- The service role (no signed-in user) is unaffected.
select pg_temp.as_user('');
select pg_temp.expect_allowed($$update public.organization_members set role = 'owner' where user_id = '00000000-0000-0000-0000-0000000000c1'$$, 'service role changes a role');

-- The two functions are no longer open to the anonymous role.
do $$ begin
  if has_function_privilege('anon', 'public.find_or_create_customer_by_phone(uuid, text, text, text, text, text)', 'execute') then
    raise exception 'FAIL anon can still run find_or_create_customer_by_phone';
  end if;
  if not has_function_privilege('authenticated', 'public.find_or_create_customer_by_phone(uuid, text, text, text, text, text)', 'execute') then
    raise exception 'FAIL members lost find_or_create_customer_by_phone';
  end if;
  if has_function_privilege('anon', 'public.mark_phone_deposit_paid(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.mark_phone_deposit_paid(uuid, text)', 'execute') then
    raise exception 'FAIL mark_phone_deposit_paid still callable from the API';
  end if;
  raise notice 'PASS function grants';
end $$;
