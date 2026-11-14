-- Phase 2: supervised AI actions.
--
-- task_proposals (made for the old task assistant, which was removed with the
-- task list; production holds no proposals) becomes the one queue for
-- everything an AI suggests doing outside Volteira: a customer text, an
-- email, an estimate or contract sent, a purchase, a refund. A person approves
-- the exact content, and only then does the executor carry it out, once.
--
-- The guarantees live here, not in application code:
--
-- * Content is fixed at creation. Its fingerprint (content_hash) is computed
--   by the database, and no update may change what the action does. An
--   approval names the fingerprint it saw, so approving stale or altered
--   content is impossible.
-- * Status moves only along the allowed paths (trigger), and every move is
--   written to an append-only audit trail (trigger), whichever path made it.
-- * Deciding locks the row and checks, from organization_members, that the
--   person deciding belongs to the business and holds the role the action
--   needs. Nothing about who is deciding is taken from the caller beyond the
--   authenticated user id (auth.uid(), or the owner a ChatGPT connection was
--   verified for on the server).
-- * Executing is claimed with FOR UPDATE SKIP LOCKED and fenced by a claim
--   token, so two workers can never both run one action, and a worker that
--   lost its lease cannot write an outcome. A lease that runs out leaves the
--   action "uncertain" for reconciliation: it is never sent again blindly.
--
-- Nothing is scheduled. The executor runs only where the deployment turns it
-- on (VOLTEIRA_PHASE2_* flags, off by default).

-- ---------------------------------------------------------------------------
-- Automation events: one row per business event, once.
-- ---------------------------------------------------------------------------
create table if not exists public.automation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null check (event_type in (
    'lead.received', 'estimate.accepted', 'contract.signed',
    'appointment.completed', 'invoice.overdue', 'materials.shortage'
  )),
  -- Stable per event (a request id, an invoice id and due date...), so the
  -- same event delivered twice is one row.
  event_key text not null check (char_length(event_key) between 1 and 200),
  job_id uuid references public.jobs(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  subject jsonb not null default '{}'::jsonb check (jsonb_typeof(subject) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'processed', 'ignored', 'failed')),
  processed_at timestamptz,
  error text check (error is null or char_length(error) <= 1000),
  created_at timestamptz not null default now(),
  unique (organization_id, event_type, event_key)
);

create index if not exists automation_events_recent_idx on public.automation_events (organization_id, created_at desc);

alter table public.automation_events enable row level security;

drop policy if exists "Admins see their business's automation events" on public.automation_events;
create policy "Admins see their business's automation events" on public.automation_events
  for select to authenticated
  using ((select private.is_org_admin(organization_id)));

-- ---------------------------------------------------------------------------
-- task_proposals: from task-only to every supervised action.
-- ---------------------------------------------------------------------------
alter table public.task_proposals alter column task_id drop not null;
alter table public.task_proposals alter column execution_id drop not null;
alter table public.task_proposals alter column task_version drop not null;

alter table public.task_proposals drop constraint if exists task_proposals_action_type_check;
alter table public.task_proposals add constraint task_proposals_action_type_check check (action_type in (
  'send_text', 'add_job_note',
  'send_customer_message', 'send_customer_email', 'create_internal_task',
  'send_contract', 'send_estimate', 'purchase_materials', 'issue_refund', 'change_price', 'cancel_job'
));

alter table public.task_proposals drop constraint if exists task_proposals_content_check;
alter table public.task_proposals add constraint task_proposals_content_check
  check (char_length(content) between 1 and 5000);

alter table public.task_proposals
  add column if not exists source text not null default 'task'
    check (source in ('task', 'event', 'chatgpt', 'app')),
  add column if not exists proposed_by uuid references auth.users(id) on delete set null,
  add column if not exists proposed_by_kind text not null default 'ai'
    check (proposed_by_kind in ('ai', 'system', 'person')),
  add column if not exists job_id uuid references public.jobs(id) on delete set null,
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists recipient text check (recipient is null or char_length(recipient) <= 320),
  add column if not exists amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  add column if not exists document_ref text check (document_ref is null or char_length(document_ref) <= 200),
  add column if not exists document_version text check (document_version is null or char_length(document_version) <= 100),
  add column if not exists template_key text check (template_key is null or template_key ~ '^[a-z0-9_]{1,60}$'),
  add column if not exists payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  add column if not exists idempotency_key text check (idempotency_key is null or char_length(idempotency_key) <= 200),
  add column if not exists dedupe_key text check (dedupe_key is null or char_length(dedupe_key) <= 200),
  add column if not exists event_id uuid references public.automation_events(id) on delete set null,
  add column if not exists attempts integer not null default 0 check (attempts >= 0),
  add column if not exists max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  add column if not exists next_attempt_at timestamptz,
  add column if not exists lease_until timestamptz,
  add column if not exists claim_token uuid,
  add column if not exists reconciled_by uuid references auth.users(id) on delete set null,
  add column if not exists reconciled_at timestamptz;

-- One action per idempotency key, and one proposal per event rule, forever:
-- a repeated event or retried request finds the first.
create unique index if not exists task_proposals_idempotency_idx
  on public.task_proposals (organization_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists task_proposals_dedupe_idx
  on public.task_proposals (organization_id, dedupe_key) where dedupe_key is not null;
create index if not exists task_proposals_org_status_idx
  on public.task_proposals (organization_id, status, created_at desc);
create index if not exists task_proposals_due_idx
  on public.task_proposals (next_attempt_at) where status = 'approved';

-- Proposals that belong to no task (events, ChatGPT) are seen by the
-- business's owners and admins, the people who can decide them.
drop policy if exists "Admins see their business's supervised actions" on public.task_proposals;
create policy "Admins see their business's supervised actions" on public.task_proposals
  for select to authenticated
  using (task_id is null and (select private.is_org_admin(organization_id)));

-- ---------------------------------------------------------------------------
-- Policy: who may decide which action. Mirrors src/lib/supervised-actions.ts.
-- ---------------------------------------------------------------------------
create or replace function private.supervised_action_approver(p_action text, p_template_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- 'owner': only an owner. 'admin': an owner or an admin. null: unknown
  -- action, nobody (fail closed).
  select case
    when p_action in ('send_contract', 'send_estimate', 'purchase_materials', 'issue_refund', 'change_price', 'cancel_job') then 'owner'
    -- A customer message written for the occasion (no approved template)
    -- needs the owner; one from an approved template, an owner or admin.
    when p_action in ('send_text', 'send_customer_message', 'send_customer_email') then
      case when p_template_key is null then 'owner' else 'admin' end
    when p_action in ('add_job_note', 'create_internal_task') then 'admin'
    else null
  end;
$$;

-- The fingerprint of what an action does. jsonb's text form is canonical
-- (keys sorted), so the same content always gives the same hash.
create or replace function private.supervised_action_fingerprint(p public.task_proposals)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'organization_id', p.organization_id,
    'action_type', p.action_type,
    'version', p.version,
    'target', p.target,
    'content', p.content,
    'payload', p.payload,
    'job_id', p.job_id,
    'customer_id', p.customer_id,
    'recipient', p.recipient,
    'amount_cents', p.amount_cents,
    'document_ref', p.document_ref,
    'document_version', p.document_version,
    'template_key', p.template_key,
    'expires_at', p.expires_at
  )::text, 'UTF8')), 'hex');
$$;

-- Content is set once. The fingerprint is always the database's own.
create or replace function private.guard_task_proposal_content()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.content_hash := private.supervised_action_fingerprint(new);
    return new;
  end if;
  if (new.organization_id, new.action_type, new.version, new.target, new.content, new.payload,
      new.job_id, new.customer_id, new.recipient, new.amount_cents, new.document_ref,
      new.document_version, new.template_key, new.expires_at, new.content_hash,
      new.idempotency_key, new.dedupe_key, new.proposed_by, new.proposed_by_kind, new.source, new.created_at)
     is distinct from
     (old.organization_id, old.action_type, old.version, old.target, old.content, old.payload,
      old.job_id, old.customer_id, old.recipient, old.amount_cents, old.document_ref,
      old.document_version, old.template_key, old.expires_at, old.content_hash,
      old.idempotency_key, old.dedupe_key, old.proposed_by, old.proposed_by_kind, old.source, old.created_at) then
    raise exception 'A proposed action cannot be changed once made; propose a new one.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_task_proposal_content on public.task_proposals;
create trigger guard_task_proposal_content before insert or update on public.task_proposals
  for each row execute function private.guard_task_proposal_content();

-- Status moves only forward, along these paths.
create or replace function private.guard_task_proposal_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not (
       (old.status = 'pending' and new.status in ('approved', 'rejected', 'expired', 'superseded', 'revision_requested'))
    -- 'executed' from approved: the owner did it by hand (reconcile below).
    or (old.status = 'approved' and new.status in ('executing', 'expired', 'superseded', 'failed', 'executed'))
    -- 'approved' again is a retry scheduled after a failure known to be safe.
    or (old.status = 'executing' and new.status in ('executed', 'failed', 'uncertain', 'approved'))
    or (old.status = 'uncertain' and new.status in ('executed', 'failed'))
  ) then
    raise exception 'A proposed action cannot go from % to %.', old.status, new.status using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_task_proposal_status on public.task_proposals;
create trigger guard_task_proposal_status before update of status on public.task_proposals
  for each row execute function private.guard_task_proposal_status();

-- ---------------------------------------------------------------------------
-- Audit: append-only, one row per change of status.
-- ---------------------------------------------------------------------------
create table if not exists public.supervised_action_audit (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  proposal_id uuid not null references public.task_proposals(id) on delete cascade,
  event text not null check (char_length(event) between 1 and 40),
  from_status text,
  to_status text,
  actor_id uuid,
  actor_kind text not null default 'system' check (actor_kind in ('person', 'ai', 'system')),
  via text check (via is null or char_length(via) <= 40),
  content_hash text,
  attempt integer,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists supervised_action_audit_proposal_idx on public.supervised_action_audit (proposal_id, id);
create index if not exists supervised_action_audit_org_idx on public.supervised_action_audit (organization_id, created_at desc);

alter table public.supervised_action_audit enable row level security;

drop policy if exists "Admins read their business's action audit" on public.supervised_action_audit;
create policy "Admins read their business's action audit" on public.supervised_action_audit
  for select to authenticated
  using ((select private.is_org_admin(organization_id)));

revoke insert, update, delete, truncate on public.supervised_action_audit from public, anon, authenticated;

create or replace function private.refuse_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The action audit trail is append-only.' using errcode = '42501';
end;
$$;

drop trigger if exists refuse_audit_update on public.supervised_action_audit;
create trigger refuse_audit_update before update on public.supervised_action_audit
  for each row execute function private.refuse_audit_change();

-- The functions below say who is acting for the length of their transaction.
create or replace function private.write_supervised_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := nullif(pg_catalog.current_setting('volteira.actor_id', true), '')::uuid;
  kind text := coalesce(nullif(pg_catalog.current_setting('volteira.actor_kind', true), ''), 'system');
  channel text := nullif(pg_catalog.current_setting('volteira.via', true), '');
begin
  if tg_op = 'INSERT' then
    insert into public.supervised_action_audit (organization_id, proposal_id, event, to_status, actor_id, actor_kind, via, content_hash, attempt, detail)
    values (new.organization_id, new.id, 'proposed', new.status, coalesce(actor, new.proposed_by),
            case when actor is null then new.proposed_by_kind else kind end,
            coalesce(channel, new.source), new.content_hash, new.attempts,
            pg_catalog.jsonb_build_object('action_type', new.action_type, 'pre_authorized', new.pre_authorized));
  elsif new.status is distinct from old.status then
    insert into public.supervised_action_audit (organization_id, proposal_id, event, from_status, to_status, actor_id, actor_kind, via, content_hash, attempt, detail)
    values (new.organization_id, new.id,
            case
              when old.status = 'executing' and new.status = 'approved' then 'retry_scheduled'
              when old.status = 'approved' and new.status = 'executing' then 'claimed'
              when old.status = 'uncertain' or (old.status = 'approved' and new.status = 'executed') then 'reconciled'
              else new.status
            end,
            old.status, new.status, actor, kind, channel, new.content_hash, new.attempts,
            pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
              'note', new.decision_note, 'error', new.error, 'external_ref', new.external_ref,
              'next_attempt_at', case when new.status = 'approved' and old.status = 'executing' then new.next_attempt_at end
            )));
  end if;
  return null;
end;
$$;

drop trigger if exists write_supervised_audit on public.task_proposals;
create trigger write_supervised_audit after insert or update of status on public.task_proposals
  for each row execute function private.write_supervised_audit();

create or replace function private.act_as(p_actor uuid, p_kind text, p_via text)
returns void
language sql
set search_path = ''
as $$
  select pg_catalog.set_config('volteira.actor_id', coalesce(p_actor::text, ''), true),
         pg_catalog.set_config('volteira.actor_kind', p_kind, true),
         pg_catalog.set_config('volteira.via', coalesce(p_via, ''), true);
$$;

-- ---------------------------------------------------------------------------
-- Events and proposals, written by the server.
-- ---------------------------------------------------------------------------
create or replace function public.record_automation_event(
  p_organization_id uuid,
  p_event_type text,
  p_event_key text,
  p_job_id uuid default null,
  p_customer_id uuid default null,
  p_subject jsonb default '{}'::jsonb
)
returns table (event_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  -- The job and customer must be this business's own.
  if p_job_id is not null and not exists (
    select 1 from public.jobs j where j.id = p_job_id and j.organization_id = p_organization_id
  ) then
    raise exception 'That job is not this business''s.' using errcode = '42501';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers c where c.id = p_customer_id and c.organization_id = p_organization_id
  ) then
    raise exception 'That customer is not this business''s.' using errcode = '42501';
  end if;

  insert into public.automation_events (organization_id, event_type, event_key, job_id, customer_id, subject)
  values (p_organization_id, p_event_type, p_event_key, p_job_id, p_customer_id, coalesce(p_subject, '{}'::jsonb))
  on conflict (organization_id, event_type, event_key) do nothing
  returning id into new_id;

  if new_id is not null then
    return query select new_id, true;
  else
    return query select e.id, false from public.automation_events e
      where e.organization_id = p_organization_id and e.event_type = p_event_type and e.event_key = p_event_key;
  end if;
end;
$$;

revoke all on function public.record_automation_event(uuid, text, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_automation_event(uuid, text, text, uuid, uuid, jsonb) to service_role;

create or replace function public.create_supervised_proposal(
  p_organization_id uuid,
  p_action_type text,
  p_content text,
  p_reason text,
  p_source text,
  p_proposed_by uuid,
  p_proposed_by_kind text,
  p_expires_at timestamptz,
  p_job_id uuid default null,
  p_customer_id uuid default null,
  p_recipient text default null,
  p_amount_cents bigint default null,
  p_document_ref text default null,
  p_document_version text default null,
  p_template_key text default null,
  p_payload jsonb default '{}'::jsonb,
  p_target jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_dedupe_key text default null,
  p_event_id uuid default null
)
returns table (proposal_id uuid, content_hash text, status text, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  approver text := private.supervised_action_approver(p_action_type, p_template_key);
  -- Internal work a business event calls for (a note on the job, a to-do)
  -- goes ahead without a person. Everything that reaches a customer or
  -- money waits for one, whoever proposed it.
  internal boolean := p_action_type in ('add_job_note', 'create_internal_task') and p_source = 'event';
  existing public.task_proposals%rowtype;
  made public.task_proposals%rowtype;
begin
  if approver is null then
    raise exception 'Unknown action type.' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= pg_catalog.now() or p_expires_at > pg_catalog.now() + interval '30 days' then
    raise exception 'A proposal must run out within 30 days.' using errcode = '22023';
  end if;
  if p_job_id is not null and not exists (
    select 1 from public.jobs j where j.id = p_job_id and j.organization_id = p_organization_id
  ) then
    raise exception 'That job is not this business''s.' using errcode = '42501';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers c where c.id = p_customer_id and c.organization_id = p_organization_id
  ) then
    raise exception 'That customer is not this business''s.' using errcode = '42501';
  end if;
  if p_proposed_by is not null and not exists (
    select 1 from public.organization_members m where m.user_id = p_proposed_by and m.organization_id = p_organization_id
  ) then
    raise exception 'The proposer is not in this business.' using errcode = '42501';
  end if;

  -- A repeat of the same request or event returns the first proposal.
  select * into existing from public.task_proposals p
   where p.organization_id = p_organization_id
     and ((p_idempotency_key is not null and p.idempotency_key = p_idempotency_key)
       or (p_dedupe_key is not null and p.dedupe_key = p_dedupe_key))
   limit 1;
  if existing.id is not null then
    return query select existing.id, existing.content_hash, existing.status, false;
    return;
  end if;

  perform private.act_as(p_proposed_by, p_proposed_by_kind, p_source);

  begin
    insert into public.task_proposals (
      organization_id, action_type, content, reason, source, proposed_by, proposed_by_kind,
      expires_at, job_id, customer_id, recipient, amount_cents, document_ref, document_version,
      template_key, payload, target, idempotency_key, dedupe_key, event_id, content_hash,
      pre_authorized, status, next_attempt_at
    ) values (
      p_organization_id, p_action_type, p_content, p_reason, p_source, p_proposed_by, p_proposed_by_kind,
      p_expires_at, p_job_id, p_customer_id, p_recipient, p_amount_cents, p_document_ref, p_document_version,
      p_template_key, coalesce(p_payload, '{}'::jsonb), coalesce(p_target, '{}'::jsonb),
      coalesce(p_idempotency_key, 'proposal:' || pg_catalog.gen_random_uuid()::text), p_dedupe_key, p_event_id, '',
      internal, case when internal then 'approved' else 'pending' end, case when internal then pg_catalog.now() end
    ) returning * into made;
  exception when unique_violation then
    -- Lost a race with an identical request: return the winner.
    select * into existing from public.task_proposals p
     where p.organization_id = p_organization_id
       and ((p_idempotency_key is not null and p.idempotency_key = p_idempotency_key)
         or (p_dedupe_key is not null and p.dedupe_key = p_dedupe_key))
     limit 1;
    return query select existing.id, existing.content_hash, existing.status, false;
    return;
  end;

  return query select made.id, made.content_hash, made.status, true;
end;
$$;

revoke all on function public.create_supervised_proposal(uuid, text, text, text, text, uuid, text, timestamptz, uuid, uuid, text, bigint, text, text, text, jsonb, jsonb, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_supervised_proposal(uuid, text, text, text, text, uuid, text, timestamptz, uuid, uuid, text, bigint, text, text, text, jsonb, jsonb, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Deciding.
-- ---------------------------------------------------------------------------
create or replace function private.decide_supervised_proposal(
  p_actor uuid,
  p_via text,
  p_proposal_id uuid,
  p_decision text,
  p_content_hash text,
  p_note text
)
returns table (ok boolean, code text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.task_proposals%rowtype;
  actor_role text;
  needed text;
begin
  if p_actor is null then
    return query select false, 'unauthenticated', null::text;
    return;
  end if;
  if p_decision not in ('approve', 'reject') then
    return query select false, 'invalid_decision', null::text;
    return;
  end if;

  select * into proposal from public.task_proposals p where p.id = p_proposal_id for update;

  select m.role into actor_role from public.organization_members m
   where m.organization_id = proposal.organization_id and m.user_id = p_actor;

  -- Another business's proposal, or none: the same answer, so nothing leaks.
  if proposal.id is null or actor_role is null then
    return query select false, 'not_found', null::text;
    return;
  end if;

  needed := private.supervised_action_approver(proposal.action_type, proposal.template_key);
  if needed is null
     or not (actor_role = 'owner' or (needed = 'admin' and actor_role = 'admin')) then
    return query select false, 'forbidden', proposal.status;
    return;
  end if;

  -- A person may not approve what they proposed themselves (an AI's
  -- proposal, made through a person's connection, is the AI's).
  if p_decision = 'approve' and proposal.proposed_by_kind = 'person' and proposal.proposed_by = p_actor then
    return query select false, 'self_approval', proposal.status;
    return;
  end if;

  if proposal.status <> 'pending' or proposal.pre_authorized then
    return query select false, 'already_decided', proposal.status;
    return;
  end if;

  if proposal.content_hash is distinct from p_content_hash then
    return query select false, 'content_changed', proposal.status;
    return;
  end if;

  perform private.act_as(p_actor, 'person', p_via);

  if proposal.expires_at <= pg_catalog.now() then
    update public.task_proposals set status = 'expired' where id = proposal.id;
    return query select false, 'expired', 'expired'::text;
    return;
  end if;

  update public.task_proposals
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         decided_by = p_actor,
         decided_via = p_via,
         decided_at = pg_catalog.now(),
         decision_note = nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_note, '')), 2000), ''),
         next_attempt_at = case when p_decision = 'approve' then pg_catalog.now() end
   where id = proposal.id;

  return query select true, 'ok', case when p_decision = 'approve' then 'approved' else 'rejected' end;
end;
$$;

revoke all on function private.decide_supervised_proposal(uuid, text, uuid, text, text, text) from public, anon, authenticated;

-- The signed-in person, deciding in the app.
create or replace function public.decide_supervised_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_content_hash text,
  p_note text default null
)
returns table (ok boolean, code text, status text)
language sql
security definer
set search_path = ''
as $$
  select * from private.decide_supervised_proposal((select auth.uid()), 'app', p_proposal_id, p_decision, p_content_hash, p_note);
$$;

revoke all on function public.decide_supervised_proposal(uuid, text, text, text) from public, anon;
grant execute on function public.decide_supervised_proposal(uuid, text, text, text) to authenticated;

-- The server, for a person it verified itself (the owner behind a ChatGPT
-- connection). Never callable from a browser.
create or replace function public.decide_supervised_proposal_for(
  p_actor uuid,
  p_via text,
  p_proposal_id uuid,
  p_decision text,
  p_content_hash text,
  p_note text default null
)
returns table (ok boolean, code text, status text)
language sql
security definer
set search_path = ''
as $$
  select * from private.decide_supervised_proposal(
    p_actor, case when p_via in ('app', 'chatgpt') then p_via else 'app' end,
    p_proposal_id, p_decision, p_content_hash, p_note);
$$;

revoke all on function public.decide_supervised_proposal_for(uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.decide_supervised_proposal_for(uuid, text, uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Executing.
-- ---------------------------------------------------------------------------

-- Seconds to wait before retry n (1-based): 30s, 2m, 8m, 32m, capped at 1h.
create or replace function private.supervised_retry_delay(p_attempt integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select least(3600, 30 * (4 ^ greatest(0, least(p_attempt, 10) - 1))::integer);
$$;

create or replace function public.claim_supervised_actions(
  p_action_types text[],
  p_limit integer default 10,
  p_lease_seconds integer default 120,
  p_only uuid default null
)
returns setof public.task_proposals
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.act_as(null, 'system', 'executor');

  -- Housekeeping first. Out of time before anyone acted: expired.
  update public.task_proposals set status = 'expired'
   where status in ('pending', 'approved') and expires_at <= pg_catalog.now();

  -- A worker that stopped mid-action: whether the customer got it is not
  -- known, so it waits for reconciliation instead of going out twice.
  update public.task_proposals
     set status = 'uncertain', lease_until = null, claim_token = null,
         error = 'The executor stopped before it recorded the outcome. Check whether it happened before doing it again.'
   where status = 'executing' and lease_until < pg_catalog.now();

  return query
  update public.task_proposals p
     set status = 'executing',
         executing_at = pg_catalog.now(),
         lease_until = pg_catalog.now() + pg_catalog.make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
         claim_token = pg_catalog.gen_random_uuid(),
         attempts = p.attempts + 1,
         error = null
   where p.id in (
     select q.id from public.task_proposals q
      where q.status = 'approved'
        and q.action_type = any (p_action_types)
        and (q.decided_by is not null or q.pre_authorized)
        and q.expires_at > pg_catalog.now()
        and coalesce(q.next_attempt_at, q.decided_at, q.created_at) <= pg_catalog.now()
        and q.attempts < q.max_attempts
        and (p_only is null or q.id = p_only)
      order by coalesce(q.next_attempt_at, q.created_at)
      limit greatest(1, least(p_limit, 50))
      for update skip locked
   )
  returning p.*;
end;
$$;

revoke all on function public.claim_supervised_actions(text[], integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_supervised_actions(text[], integer, integer, uuid) to service_role;

-- p_outcome:
--   succeeded  the provider confirmed it
--   failed     the provider refused it; doing it again would not help
--   retryable  it certainly did not happen and may next time (rate limit...)
--   deferred   not attempted (quiet hours); try at p_retry_at, no attempt used
--   uncertain  it may have happened (a timeout); a person or reconciliation decides
create or replace function public.finish_supervised_action(
  p_proposal_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_external_ref text default null,
  p_receipt jsonb default null,
  p_error text default null,
  p_retry_at timestamptz default null
)
returns table (ok boolean, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.task_proposals%rowtype;
  next_status text;
  retry_at timestamptz;
begin
  select * into proposal from public.task_proposals p where p.id = p_proposal_id for update;
  -- Only the worker holding the current claim may write the outcome.
  if proposal.id is null or proposal.status <> 'executing' or proposal.claim_token is distinct from p_claim_token then
    return query select false, proposal.status;
    return;
  end if;

  perform private.act_as(null, 'system', 'executor');

  if p_outcome = 'succeeded' then
    next_status := 'executed';
  elsif p_outcome = 'uncertain' then
    next_status := 'uncertain';
  elsif p_outcome = 'deferred' then
    retry_at := least(coalesce(p_retry_at, pg_catalog.now() + interval '15 minutes'), proposal.expires_at);
    next_status := case when retry_at >= proposal.expires_at then 'failed' else 'approved' end;
  elsif p_outcome = 'retryable' and proposal.attempts < proposal.max_attempts then
    retry_at := pg_catalog.now() + pg_catalog.make_interval(secs => private.supervised_retry_delay(proposal.attempts));
    next_status := case when retry_at >= proposal.expires_at then 'failed' else 'approved' end;
  else
    next_status := 'failed';
  end if;

  update public.task_proposals
     set status = next_status,
         executed_at = case when next_status = 'executed' then pg_catalog.now() else executed_at end,
         external_ref = coalesce(nullif(pg_catalog.left(p_external_ref, 200), ''), external_ref),
         receipt = coalesce(p_receipt, receipt),
         error = case when next_status = 'executed' then null
                      when next_status = 'failed' and p_outcome in ('retryable', 'deferred')
                        then pg_catalog.left(coalesce(p_error, 'Could not be done') || ' (no time left to try again)', 1000)
                      else pg_catalog.left(p_error, 1000) end,
         next_attempt_at = retry_at,
         -- A deferral was not a try.
         attempts = case when p_outcome = 'deferred' then greatest(0, attempts - 1) else attempts end,
         lease_until = null,
         claim_token = null
   where id = proposal.id;

  return query select true, next_status;
end;
$$;

revoke all on function public.finish_supervised_action(uuid, uuid, text, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.finish_supervised_action(uuid, uuid, text, text, jsonb, text, timestamptz) to service_role;

-- An owner settles an action by hand: an uncertain one after checking what
-- really happened, or an approved one they carried out themselves (or
-- decided against) instead of the executor. Binding and financial actions
-- are never run by the executor, so this is how they are closed.
create or replace function private.reconcile_supervised_action(
  p_actor uuid,
  p_proposal_id uuid,
  p_outcome text,
  p_note text
)
returns table (ok boolean, code text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.task_proposals%rowtype;
  actor_role text;
begin
  if p_outcome not in ('executed', 'failed') then
    return query select false, 'invalid_outcome', null::text;
    return;
  end if;
  select * into proposal from public.task_proposals p where p.id = p_proposal_id for update;
  select m.role into actor_role from public.organization_members m
   where m.organization_id = proposal.organization_id and m.user_id = p_actor;
  if p_actor is null or proposal.id is null or actor_role is null then
    return query select false, 'not_found', null::text;
    return;
  end if;
  if actor_role <> 'owner' then
    return query select false, 'forbidden', proposal.status;
    return;
  end if;
  if proposal.status not in ('uncertain', 'approved') then
    return query select false, 'not_uncertain', proposal.status;
    return;
  end if;

  perform private.act_as(p_actor, 'person', 'app');
  update public.task_proposals
     set status = p_outcome,
         reconciled_by = p_actor,
         reconciled_at = pg_catalog.now(),
         executed_at = case when p_outcome = 'executed' then coalesce(executed_at, pg_catalog.now()) else executed_at end,
         decision_note = coalesce(nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_note, '')), 2000), ''), decision_note)
   where id = proposal.id;
  return query select true, 'ok', p_outcome;
end;
$$;

revoke all on function private.reconcile_supervised_action(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.reconcile_supervised_action(p_proposal_id uuid, p_outcome text, p_note text default null)
returns table (ok boolean, code text, status text)
language sql
security definer
set search_path = ''
as $$
  select * from private.reconcile_supervised_action((select auth.uid()), p_proposal_id, p_outcome, p_note);
$$;

revoke all on function public.reconcile_supervised_action(uuid, text, text) from public, anon;
grant execute on function public.reconcile_supervised_action(uuid, text, text) to authenticated;
