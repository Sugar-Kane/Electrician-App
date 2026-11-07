-- Tasks: one record shared by the Tasks page, each job's Tasks section and the
-- ChatGPT/Claude connection (MCP). Stage 1 of the feature: the record, its
-- history, and who may see and change it. Reminders, recurrence and assistant
-- work arrive in later migrations; the columns they will fill are here now so
-- the record does not change shape under existing rows.
--
-- Who sees a task:
--   private    -> its creator, its owner and the person it is assigned to.
--   workspace  -> every member of the business, as jobs already are.
-- A task linked to a job is always workspace: jobs are visible to every
-- member, so a private task on a job would be a promise the app cannot keep.
-- The app asks before a private task becomes workspace by being linked.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),

  title text not null check (char_length(btrim(title)) between 1 and 300),
  notes text check (notes is null or char_length(notes) <= 10000),
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'waiting_input', 'waiting_approval', 'complete', 'canceled')),

  assignee_type text not null default 'user' check (assignee_type in ('user', 'assistant', 'none')),
  assignee_user_id uuid references auth.users(id) on delete set null,
  assistant_connection_id uuid,

  job_id uuid references public.jobs(id) on delete set null,
  related_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(related_refs) = 'array'),

  -- The deadline. A date alone is a calendar date, not an instant; with a time
  -- it is also stored as the instant it falls on in `time_zone`.
  due_date date,
  due_time time,
  due_at timestamptz,
  time_zone text not null default 'America/Los_Angeles',

  -- Later stages. A due date never starts assistant work by itself.
  reminder_at timestamptz,
  reminder_sent_at timestamptz,
  execution_mode text not null default 'none' check (execution_mode in ('none', 'now', 'scheduled')),
  scheduled_execution_at timestamptz,
  recurrence jsonb,
  series_id uuid,
  occurrence_date date,
  ai_instructions text check (ai_instructions is null or char_length(ai_instructions) <= 10000),
  completion_criteria text check (completion_criteria is null or char_length(completion_criteria) <= 2000),
  ai_permission_mode text check (ai_permission_mode is null or ai_permission_mode in ('prepare', 'execute_approved')),
  completion_summary text check (completion_summary is null or char_length(completion_summary) <= 10000),
  artifacts jsonb not null default '[]'::jsonb check (jsonb_typeof(artifacts) = 'array'),

  -- A retried create carries the same key and finds the task it already made.
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) <= 200),
  -- Every change names the version it read; a stale one is refused.
  version integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  archived_at timestamptz,

  constraint tasks_job_tasks_are_shared check (job_id is null or visibility = 'workspace'),
  constraint tasks_due_time_needs_date check (due_time is null or due_date is not null),
  constraint tasks_assignee_matches_type check (
    (assignee_type = 'user' and assistant_connection_id is null)
    or (assignee_type = 'assistant' and assignee_user_id is null)
    or (assignee_type = 'none' and assignee_user_id is null and assistant_connection_id is null)
  ),
  constraint tasks_completed_at_matches_status check ((status = 'complete') = (completed_at is not null))
);

create unique index if not exists tasks_idempotency_key_idx
  on public.tasks (organization_id, idempotency_key) where idempotency_key is not null;
create index if not exists tasks_org_open_idx on public.tasks (organization_id, status) where archived_at is null;
create index if not exists tasks_org_due_idx on public.tasks (organization_id, due_date) where archived_at is null;
create index if not exists tasks_job_idx on public.tasks (job_id) where job_id is not null;
create index if not exists tasks_assignee_idx on public.tasks (assignee_user_id) where assignee_user_id is not null;
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists tasks_owner_idx on public.tasks (owner_id);

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- The job must belong to the task's business. Checked in the database too, so
-- no caller can link a task to another business's job by its id.
create or replace function private.tasks_job_same_business()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.job_id is not null and not exists (
    select 1 from public.jobs j where j.id = new.job_id and j.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'That job belongs to another business.';
  end if;
  return new;
end;
$$;
alter function private.tasks_job_same_business() security definer;

drop trigger if exists tasks_job_same_business on public.tasks;
create trigger tasks_job_same_business before insert or update of job_id, organization_id on public.tasks
  for each row execute function private.tasks_job_same_business();

-- Who may see one task: the rule the policies below and the activity table share.
create or replace function private.can_see_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = target_task_id
      and private.is_org_member(t.organization_id)
      and (
        t.visibility = 'workspace'
        or t.created_by = (select auth.uid())
        or t.owner_id = (select auth.uid())
        or t.assignee_user_id = (select auth.uid())
      )
  );
$$;
revoke all on function private.can_see_task(uuid) from public, anon;
grant execute on function private.can_see_task(uuid) to authenticated;

alter table public.tasks enable row level security;

drop policy if exists "Members see workspace tasks and their own" on public.tasks;
create policy "Members see workspace tasks and their own" on public.tasks
  for select to authenticated
  using (
    (select private.is_org_member(organization_id))
    and (
      visibility = 'workspace'
      or created_by = (select auth.uid())
      or owner_id = (select auth.uid())
      or assignee_user_id = (select auth.uid())
    )
  );

drop policy if exists "Members add tasks as themselves" on public.tasks;
create policy "Members add tasks as themselves" on public.tasks
  for insert to authenticated
  with check ((select private.is_org_member(organization_id)) and created_by = (select auth.uid()));

drop policy if exists "Members change tasks they can see" on public.tasks;
create policy "Members change tasks they can see" on public.tasks
  for update to authenticated
  using (
    (select private.is_org_member(organization_id))
    and (
      visibility = 'workspace'
      or created_by = (select auth.uid())
      or owner_id = (select auth.uid())
      or assignee_user_id = (select auth.uid())
    )
  )
  with check ((select private.is_org_member(organization_id)));
-- No delete policy: tasks are archived, never deleted, so history is kept.

create table if not exists public.task_activity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_type text not null check (actor_type in ('user', 'assistant', 'system')),
  actor_user_id uuid references auth.users(id) on delete set null,
  via text not null default 'app' check (via in ('app', 'chatgpt', 'system')),
  event text not null check (char_length(event) <= 60),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists task_activity_task_idx on public.task_activity (task_id, created_at);

alter table public.task_activity enable row level security;

drop policy if exists "Members read history of tasks they can see" on public.task_activity;
create policy "Members read history of tasks they can see" on public.task_activity
  for select to authenticated
  using ((select private.can_see_task(task_id)));

drop policy if exists "Members write history of tasks they can see" on public.task_activity;
create policy "Members write history of tasks they can see" on public.task_activity
  for insert to authenticated
  with check (
    (select private.can_see_task(task_id))
    and actor_type = 'user'
    and actor_user_id = (select auth.uid())
  );
