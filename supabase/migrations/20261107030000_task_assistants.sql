-- Tasks, stage 3: assistant connections, assistant work (executions), and the
-- proposals a person approves before anything leaves Volteira.
--
-- People read these under row-level security; only the server writes them,
-- after checking who is acting (src/lib/task-executions.ts).

-- Assistant connections, one row per assistant a business can hand work to.
-- Provider-neutral. `credential_ref` names where the server finds the key
-- (for example an environment variable); the key itself is never stored here.
create table if not exists public.assistant_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  provider text not null check (provider in ('anthropic')),
  kind text not null default 'built_in' check (kind in ('built_in')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  capabilities jsonb not null default '["send_text", "add_job_note"]'::jsonb check (jsonb_typeof(capabilities) = 'array'),
  credential_ref text check (credential_ref is null or credential_ref ~ '^env:[A-Z0-9_]+$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists assistant_connections_one_built_in_idx
  on public.assistant_connections (organization_id) where kind = 'built_in';

alter table public.assistant_connections enable row level security;

drop policy if exists "Members see their business's assistants" on public.assistant_connections;
create policy "Members see their business's assistants" on public.assistant_connections
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

-- Every business gets Volteira's own assistant. Whether it can run depends on
-- the deployment having its key, which the server checks each time.
insert into public.assistant_connections (organization_id, display_name, provider, kind, credential_ref)
select o.id, 'Volteira assistant (Claude)', 'anthropic', 'built_in', 'env:ANTHROPIC_API_KEY'
  from public.organizations o
on conflict do nothing;

create or replace function private.add_built_in_assistant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.assistant_connections (organization_id, display_name, provider, kind, credential_ref)
  values (new.id, 'Volteira assistant (Claude)', 'anthropic', 'built_in', 'env:ANTHROPIC_API_KEY')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists add_built_in_assistant on public.organizations;
create trigger add_built_in_assistant after insert on public.organizations
  for each row execute function private.add_built_in_assistant();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_assistant_connection_id_fkey') then
    alter table public.tasks
      add constraint tasks_assistant_connection_id_fkey
      foreign key (assistant_connection_id) references public.assistant_connections(id) on delete set null;
  end if;
end;
$$;

-- One run of assistant work on a task. At most one is active per task.
create table if not exists public.task_executions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  connection_id uuid references public.assistant_connections(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  requested_via text not null default 'app' check (requested_via in ('app', 'chatgpt')),
  -- What the person asked for, kept as it was when the work started.
  task_version integer not null,
  instructions text check (instructions is null or char_length(instructions) <= 10000),
  completion_criteria text check (completion_criteria is null or char_length(completion_criteria) <= 2000),
  permission_mode text not null default 'prepare' check (permission_mode in ('prepare', 'execute_approved')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'waiting_input', 'waiting_approval', 'succeeded', 'failed', 'cancel_requested', 'canceled')),
  stage text check (stage is null or char_length(stage) <= 200),
  attempt integer not null default 0,
  rounds integer not null default 0,
  scheduled_for timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  cancel_requested_at timestamptz,
  canceled_by uuid references auth.users(id) on delete set null,
  question text check (question is null or char_length(question) <= 2000),
  answer text check (answer is null or char_length(answer) <= 4000),
  feedback text check (feedback is null or char_length(feedback) <= 4000),
  result_summary text check (result_summary is null or char_length(result_summary) <= 10000),
  error text check (error is null or char_length(error) <= 1000),
  usage jsonb not null default '{}'::jsonb,
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists task_executions_one_active_idx
  on public.task_executions (task_id)
  where status in ('queued', 'running', 'waiting_input', 'waiting_approval', 'cancel_requested');
create unique index if not exists task_executions_idempotency_idx
  on public.task_executions (organization_id, idempotency_key) where idempotency_key is not null;
create index if not exists task_executions_task_idx on public.task_executions (task_id, created_at desc);

alter table public.task_executions enable row level security;

drop policy if exists "Members see assistant work on tasks they can see" on public.task_executions;
create policy "Members see assistant work on tasks they can see" on public.task_executions
  for select to authenticated
  using ((select private.can_see_task(task_id)));

-- Something the assistant wants to do outside its own notes. Each change to
-- the content is a new version; approval is for one version and one content
-- hash, and runs out at `expires_at`.
create table if not exists public.task_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  execution_id uuid not null references public.task_executions(id) on delete cascade,
  version integer not null default 1,
  task_version integer not null,
  action_type text not null check (action_type in ('send_text', 'add_job_note')),
  -- Resolved by the server from the task's job, never taken from the assistant.
  target jsonb not null default '{}'::jsonb,
  content text not null check (char_length(content) between 1 and 2000),
  reason text check (reason is null or char_length(reason) <= 1000),
  content_hash text not null,
  limits jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'revision_requested', 'superseded', 'expired', 'executing', 'executed', 'failed', 'uncertain')),
  pre_authorized boolean not null default false,
  decided_by uuid references auth.users(id) on delete set null,
  decided_via text check (decided_via is null or decided_via in ('app', 'chatgpt', 'system')),
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 2000),
  expires_at timestamptz not null,
  executing_at timestamptz,
  executed_at timestamptz,
  external_ref text check (external_ref is null or char_length(external_ref) <= 200),
  receipt jsonb,
  error text check (error is null or char_length(error) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists task_proposals_execution_idx on public.task_proposals (execution_id, created_at desc);
create index if not exists task_proposals_executing_idx on public.task_proposals (executing_at) where status = 'executing';

alter table public.task_proposals enable row level security;

drop policy if exists "Members see proposals on tasks they can see" on public.task_proposals;
create policy "Members see proposals on tasks they can see" on public.task_proposals
  for select to authenticated
  using ((select private.can_see_task(task_id)));

-- Queue rows for assistant work point at their execution; one live row each.
alter table public.task_work add column if not exists execution_id uuid references public.task_executions(id) on delete cascade;
create unique index if not exists task_work_one_live_execution_idx
  on public.task_work (execution_id) where kind = 'execution' and status in ('pending', 'claimed');

-- Finishing, canceling or archiving a task by hand, or giving it to a person,
-- stops its assistant work:
-- queued or waiting work is canceled now, running work is asked to stop, and
-- anything still waiting for approval can no longer be approved.
create or replace function private.stop_task_executions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
       (new.status in ('complete', 'canceled') or new.archived_at is not null)
       and not (old.status in ('complete', 'canceled') or old.archived_at is not null)
     )
     or (old.assignee_type = 'assistant' and new.assignee_type <> 'assistant') then
    update public.task_executions
       set status = case when status = 'running' then 'cancel_requested' else 'canceled' end,
           cancel_requested_at = coalesce(cancel_requested_at, now()),
           finished_at = case when status = 'running' then finished_at else now() end,
           stage = case when new.assignee_type <> 'assistant' then 'Stopped because the task was given to someone else' else 'Stopped because the task was closed' end,
           updated_at = now()
     where task_id = new.id
       and status in ('queued', 'running', 'waiting_input', 'waiting_approval');
    update public.task_proposals
       set status = 'superseded', decision_note = 'The task was closed.'
     where task_id = new.id and status in ('pending', 'approved');
    update public.task_work
       set status = 'canceled', finished_at = now(), last_error = 'The task was closed.'
     where task_id = new.id and kind = 'execution' and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists stop_task_executions on public.tasks;
create trigger stop_task_executions after update of status, archived_at, assignee_type on public.tasks
  for each row execute function private.stop_task_executions();

-- The worker also wakes for approved actions whose outcome was never written
-- down, to reconcile them (never to send them again).
create or replace function private.task_work_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.task_work
            where (status = 'pending' and run_at <= now()) or (status = 'claimed' and lease_until < now())
         )
      or exists (
           select 1 from public.task_series
            where active and next_date is not null and next_date <= (now() at time zone 'utc')::date + 8
         )
      or exists (
           select 1 from public.task_proposals
            where status = 'executing' and executing_at < now() - interval '5 minutes'
         );
$$;

-- The worker's claim, unchanged, re-created so it returns the new column too.
create or replace function public.claim_task_work(p_limit integer default 25, p_lease_seconds integer default 120)
returns setof public.task_work
language sql
security definer
set search_path = ''
as $$
  update public.task_work w
     set status = 'claimed',
         claimed_at = now(),
         lease_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
         attempts = w.attempts + 1
   where w.id in (
     select q.id from public.task_work q
      where (q.status = 'pending' and q.run_at <= now())
         or (q.status = 'claimed' and q.lease_until < now())
      order by q.run_at
      limit greatest(1, least(p_limit, 100))
      for update skip locked
   )
  returning w.*;
$$;
revoke all on function public.claim_task_work(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_task_work(integer, integer) to service_role;
