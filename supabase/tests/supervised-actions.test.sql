-- Database tests for supervised actions (20261115000000_supervised_actions.sql).
-- Run by scripts/test-supervised-db.sh against a throwaway local Postgres.
-- Each block raises on the first wrong answer.
\set ON_ERROR_STOP 1

-- Two businesses. Nick owns PPE; Ana is PPE's admin, Tom its technician.
-- Olga owns another business.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000d');
insert into public.organizations (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'PPE'), ('20000000-0000-0000-0000-000000000002', 'Other');
insert into public.organization_members (organization_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'admin'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'technician'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000d', 'owner');
insert into public.customers (id, organization_id) values
  ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002');

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

create function pg_temp.propose(p_action text, p_template text default null, p_key text default null, p_kind text default 'ai', p_by uuid default null, p_source text default 'chatgpt', p_customer uuid default 'c0000000-0000-0000-0000-000000000001')
returns uuid language sql as $$
  select proposal_id from public.create_supervised_proposal(
    '10000000-0000-0000-0000-000000000001', p_action, 'Hi, this is PPE.', 'test', p_source, p_by, p_kind,
    now() + interval '1 day', null, p_customer, '+15555550100', 18000, null, null, p_template,
    '{"b": 2, "a": 1}'::jsonb, '{}'::jsonb, p_key, null, null)
$$;

create function pg_temp.hash(p uuid) returns text language sql as $$ select content_hash from public.task_proposals where id = p $$;
create function pg_temp.decide(p_actor text, p uuid, p_decision text, p_hash text) returns text language sql as $$
  select code from public.decide_supervised_proposal_for(p_actor::uuid, 'app', p, p_decision, p_hash)
$$;

-- Fingerprint and immutable content -----------------------------------------
do $$
declare p uuid := pg_temp.propose('send_customer_message', 'invoice_overdue');
begin
  perform pg_temp.check(pg_temp.hash(p) like 'sha256:%' and length(pg_temp.hash(p)) = 71, 'the database computes the fingerprint');
  perform pg_temp.check((select status from public.task_proposals where id = p) = 'pending', 'a customer message waits for a person');
  begin
    update public.task_proposals set content = 'Pay now or else' where id = p;
    perform pg_temp.check(false, 'content can be changed after it is proposed');
  exception when insufficient_privilege then
    perform pg_temp.check(true, 'content cannot be changed after it is proposed');
  end;
  begin
    update public.task_proposals set content_hash = 'sha256:forged' where id = p;
    perform pg_temp.check(false, 'the fingerprint can be overwritten');
  exception when insufficient_privilege then
    perform pg_temp.check(true, 'the fingerprint cannot be overwritten');
  end;
  begin
    update public.task_proposals set status = 'executed' where id = p;
    perform pg_temp.check(false, 'pending can jump straight to executed');
  exception when insufficient_privilege then
    perform pg_temp.check(true, 'pending cannot jump straight to executed');
  end;
end $$;

-- Tenancy -----------------------------------------------------------------
do $$
begin
  begin
    perform public.create_supervised_proposal(
      '10000000-0000-0000-0000-000000000001', 'send_customer_message', 'x', null, 'chatgpt', null, 'ai',
      now() + interval '1 day', null, 'c0000000-0000-0000-0000-000000000002');
    perform pg_temp.check(false, 'a proposal can name another business''s customer');
  exception when insufficient_privilege then
    perform pg_temp.check(true, 'a proposal cannot name another business''s customer');
  end;
  begin
    perform public.create_supervised_proposal(
      '10000000-0000-0000-0000-000000000001', 'wire_money', 'x', null, 'chatgpt', null, 'ai', now() + interval '1 day');
    perform pg_temp.check(false, 'an unknown action can be proposed');
  exception when invalid_parameter_value then
    perform pg_temp.check(true, 'an unknown action cannot be proposed (fail closed)');
  end;
end $$;

-- Deciding ----------------------------------------------------------------
do $$
declare
  refund uuid := pg_temp.propose('issue_refund');
  templated uuid := pg_temp.propose('send_customer_message', 'invoice_overdue');
  freeform uuid := pg_temp.propose('send_customer_message');
  own uuid := pg_temp.propose('send_customer_message', 'invoice_overdue', null, 'person', '00000000-0000-0000-0000-00000000000b', 'app');
begin
  perform pg_temp.check(pg_temp.decide('00000000-0000-0000-0000-00000000000d', refund, 'approve', pg_temp.hash(refund)) = 'not_found', 'another business''s owner sees not_found');
  perform pg_temp.check(pg_temp.decide('00000000-0000-0000-0000-00000000000c', templated, 'approve', pg_temp.hash(templated)) = 'forbidden', 'a technician cannot approve a customer message');
  perform pg_temp.check(pg_temp.decide('00000000-0000-0000-0000-00000000000b', refund, 'approve', pg_temp.hash(refund)) = 'forbidden', 'an admin cannot approve a refund');
  perform pg_temp.check(pg_temp.decide('00000000-0000-0000-0000-00000000000b', freeform, 'approve', pg_temp.hash(freeform)) = 'forbidden', 'an admin cannot approve a message written for the occasion');
  perform pg_temp.check(pg_temp.decide('00000000-0000-0000-0000-00000000000b', own, 'approve', pg_temp.hash(own)) = 'self_approval', 'a person cannot approve their own proposal');
  perform pg_temp.check(pg_temp.decide('00000000-0000-0000-0000-00000000000a', refund, 'approve', 'sha256:stale') = 'content_changed', 'approving a different fingerprint is refused');
  perform pg_temp.check(pg_temp.decide('00000000-0000-0000-0000-00000000000b', templated, 'approve', pg_temp.hash(templated)) = 'ok', 'an admin approves a templated message');
  perform pg_temp.check(pg_temp.decide('00000000-0000-0000-0000-00000000000a', templated, 'reject', pg_temp.hash(templated)) = 'already_decided', 'a second decision cannot overwrite the first');
  perform pg_temp.check(pg_temp.decide('00000000-0000-0000-0000-00000000000a', refund, 'approve', pg_temp.hash(refund)) = 'ok', 'the owner approves a refund');
  perform pg_temp.check((select decided_by from public.task_proposals where id = refund) = '00000000-0000-0000-0000-00000000000a', 'the approver is recorded');
end $$;

create temp table late (id uuid);
insert into public.task_proposals (organization_id, action_type, content, expires_at, source, content_hash, template_key)
values ('10000000-0000-0000-0000-000000000001', 'send_customer_message', 'Late', clock_timestamp() + interval '50 milliseconds', 'app', '', 'invoice_overdue');
insert into late select id from public.task_proposals where content = 'Late';
select pg_sleep(0.1);
do $$
declare p uuid := (select id from late);
begin
  perform pg_temp.check(pg_temp.decide('00000000-0000-0000-0000-00000000000a', p, 'approve', pg_temp.hash(p)) = 'expired', 'an expired proposal cannot be approved');
  perform pg_temp.check((select status from public.task_proposals where id = p) = 'expired', 'and it is marked expired');
end $$;

-- Executing ---------------------------------------------------------------
do $$
declare
  p uuid := pg_temp.propose('send_customer_message', 'invoice_overdue');
  claimed public.task_proposals;
  again integer;
  token uuid;
  r record;
begin
  perform pg_temp.check((select count(*) from public.claim_supervised_actions(array['send_customer_message'], 10, 120, p)) = 0, 'an undecided proposal cannot be claimed');
  perform pg_temp.decide('00000000-0000-0000-0000-00000000000a', p, 'approve', pg_temp.hash(p));
  perform pg_temp.check((select count(*) from public.claim_supervised_actions(array['send_contract'], 10, 120, p)) = 0, 'a worker only claims action types it is enabled for');
  select * into claimed from public.claim_supervised_actions(array['send_customer_message'], 10, 120, p);
  perform pg_temp.check(claimed.id = p and claimed.status = 'executing' and claimed.attempts = 1, 'an approved action is claimed once');
  select count(*) into again from public.claim_supervised_actions(array['send_customer_message'], 10, 120, p);
  perform pg_temp.check(again = 0, 'a claimed action cannot be claimed again');
  select * into r from public.finish_supervised_action(p, gen_random_uuid(), 'succeeded');
  perform pg_temp.check(not r.ok, 'a worker without the claim cannot write the outcome');
  select * into r from public.finish_supervised_action(p, claimed.claim_token, 'retryable', null, null, 'Twilio 429');
  perform pg_temp.check(r.ok and r.status = 'approved', 'a safe failure is scheduled for retry');
  perform pg_temp.check((select next_attempt_at between now() + interval '25 seconds' and now() + interval '35 seconds' from public.task_proposals where id = p), 'the first retry waits 30 seconds');
  perform pg_temp.check((select count(*) from public.claim_supervised_actions(array['send_customer_message'], 10, 120, p)) = 0, 'a retry is not claimed before its time');
  update public.task_proposals set next_attempt_at = now() - interval '1 second' where id = p;
  select * into claimed from public.claim_supervised_actions(array['send_customer_message'], 10, 120, p);
  perform pg_temp.check(claimed.attempts = 2, 'the retry is attempt 2');
  select * into r from public.finish_supervised_action(p, claimed.claim_token, 'succeeded', 'SM123', '{"status": "queued"}');
  perform pg_temp.check(r.status = 'executed' and (select external_ref from public.task_proposals where id = p) = 'SM123', 'success records the provider receipt');
end $$;

do $$
declare
  p uuid := pg_temp.propose('send_customer_message', 'invoice_overdue');
  claimed public.task_proposals;
  r record;
begin
  perform pg_temp.decide('00000000-0000-0000-0000-00000000000a', p, 'approve', pg_temp.hash(p));
  select * into claimed from public.claim_supervised_actions(array['send_customer_message'], 10, 30, p);
  select * into r from public.finish_supervised_action(p, claimed.claim_token, 'deferred', null, null, 'Quiet hours', now() + interval '1 hour');
  perform pg_temp.check(r.status = 'approved' and (select attempts from public.task_proposals where id = p) = 0, 'quiet hours defer without using an attempt');
  update public.task_proposals set next_attempt_at = now() - interval '1 second' where id = p;
  select * into claimed from public.claim_supervised_actions(array['send_customer_message'], 10, 30, p);
  -- The worker dies: its lease runs out.
  update public.task_proposals set lease_until = now() - interval '1 second' where id = p;
  perform public.claim_supervised_actions(array['send_customer_message'], 10, 30, null);
  perform pg_temp.check((select status from public.task_proposals where id = p) = 'uncertain', 'a lost worker leaves the action uncertain, never resent');
  select * into r from public.finish_supervised_action(p, claimed.claim_token, 'succeeded');
  perform pg_temp.check(not r.ok, 'the lost worker cannot write an outcome afterwards');
  perform pg_temp.check((select code from private.reconcile_supervised_action('00000000-0000-0000-0000-00000000000b', p, 'executed', 'Seen in Twilio')) = 'forbidden', 'only an owner reconciles');
  perform pg_temp.check((select code from private.reconcile_supervised_action('00000000-0000-0000-0000-00000000000a', p, 'executed', 'Seen in Twilio')) = 'ok', 'the owner reconciles it as done');
  perform pg_temp.check((select status from public.task_proposals where id = p) = 'executed', 'and it reads executed');
end $$;

do $$
declare p uuid := pg_temp.propose('send_customer_message', 'invoice_overdue');
  claimed public.task_proposals; r record;
begin
  perform pg_temp.decide('00000000-0000-0000-0000-00000000000a', p, 'approve', pg_temp.hash(p));
  update public.task_proposals set max_attempts = 1 where id = p;
  select * into claimed from public.claim_supervised_actions(array['send_customer_message'], 10, 30, p);
  select * into r from public.finish_supervised_action(p, claimed.claim_token, 'retryable', null, null, 'busy');
  perform pg_temp.check(r.status = 'failed', 'retries stop at the attempt limit');
end $$;

-- Internal work from an event needs no person -----------------------------
do $$
declare p uuid := pg_temp.propose('create_internal_task', null, null, 'system', null, 'event');
begin
  perform pg_temp.check((select status = 'approved' and pre_authorized from public.task_proposals where id = p), 'internal work from an event is pre-authorized');
  p := pg_temp.propose('create_internal_task', null, null, 'ai', null, 'chatgpt');
  perform pg_temp.check((select status from public.task_proposals where id = p) = 'pending', 'the same work proposed by ChatGPT waits for a person');
end $$;

-- Duplicates --------------------------------------------------------------
do $$
declare a uuid; b uuid; e1 record; e2 record;
begin
  a := pg_temp.propose('send_customer_message', 'invoice_overdue', 'invoice:1:overdue');
  b := pg_temp.propose('send_customer_message', 'invoice_overdue', 'invoice:1:overdue');
  perform pg_temp.check(a = b, 'the same idempotency key returns the first proposal');
  select * into e1 from public.record_automation_event('10000000-0000-0000-0000-000000000001', 'invoice.overdue', 'inv-1:2026-11-01');
  select * into e2 from public.record_automation_event('10000000-0000-0000-0000-000000000001', 'invoice.overdue', 'inv-1:2026-11-01');
  perform pg_temp.check(e1.created and not e2.created and e1.event_id = e2.event_id, 'a repeated event is recorded once');
end $$;

-- Audit -------------------------------------------------------------------
do $$
declare p uuid := pg_temp.propose('issue_refund');
begin
  perform pg_temp.decide('00000000-0000-0000-0000-00000000000a', p, 'reject', pg_temp.hash(p));
  perform pg_temp.check((select array_agg(event order by id) from public.supervised_action_audit where proposal_id = p) = array['proposed', 'rejected'], 'every change of status is audited');
  perform pg_temp.check((select actor_id from public.supervised_action_audit where proposal_id = p and event = 'rejected') = '00000000-0000-0000-0000-00000000000a', 'the audit names who decided');
  begin
    update public.supervised_action_audit set event = 'approved' where proposal_id = p;
    perform pg_temp.check(false, 'the audit can be rewritten');
  exception when insufficient_privilege then
    perform pg_temp.check(true, 'the audit cannot be rewritten');
  end;
end $$;

-- Who can call what -------------------------------------------------------
do $$
begin
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.create_supervised_proposal(uuid, text, text, text, text, uuid, text, timestamptz, uuid, uuid, text, bigint, text, text, text, jsonb, jsonb, text, text, uuid)', 'execute'), 'a browser cannot create proposals');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.claim_supervised_actions(text[], integer, integer, uuid)', 'execute'), 'a browser cannot claim work');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.decide_supervised_proposal_for(uuid, text, uuid, text, text, text)', 'execute'), 'a browser cannot decide as someone else');
  perform pg_temp.check(has_function_privilege('authenticated', 'public.decide_supervised_proposal(uuid, text, text, text)', 'execute'), 'a signed-in person can decide as themselves');
  perform pg_temp.check(not has_table_privilege('authenticated', 'public.supervised_action_audit', 'insert'), 'a browser cannot write the audit');
end $$;

-- Row-level security, as a signed-in member --------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
do $$ begin
  perform pg_temp.check((select count(*) from public.task_proposals) = 0, 'another business''s owner sees none of PPE''s proposals');
  perform pg_temp.check((select count(*) from public.supervised_action_audit) = 0, 'or its audit');
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  perform pg_temp.check((select count(*) from public.task_proposals) = 0, 'a technician does not see business proposals');
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare p uuid; r record;
begin
  perform pg_temp.check((select count(*) from public.task_proposals) > 0, 'the owner sees them');
  select id into p from public.task_proposals where status = 'pending' and action_type = 'send_customer_message' limit 1;
  select * into r from public.decide_supervised_proposal(p, 'approve', (select content_hash from public.task_proposals where id = p));
  perform pg_temp.check(r.ok, 'the owner approves in the app as themselves');
end $$;
reset role;
