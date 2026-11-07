-- Tasks, stage 2: reminders, recurring tasks, a durable work queue, in-app
-- notifications, and the scheduler that runs them without anybody's browser
-- or ChatGPT conversation being open.
--
-- How scheduled work runs:
--   - Work that must happen later is a row in task_work, written by triggers on
--     tasks, so every way of changing a task schedules it the same way.
--   - Every minute pg_cron checks whether anything is due. Only then does it
--     call Volteira's /api/tasks/worker over pg_net, so a quiet business costs
--     no requests.
--   - The worker claims due rows with a lease (claim_task_work). A worker that
--     dies mid-run leaves its rows to be claimed again when the lease ends;
--     each attempt is counted and retries back off.
--   - The worker is protected by a random token kept only in Supabase Vault.
--     pg_net reads it from Vault to call, and the worker checks it against
--     Vault (task_worker_token_ok). It is never in the code, the environment
--     or anybody's hands.
--
-- Replayable from an empty database: every statement checks before creating.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- A recurring task: the template and its rule. Each occurrence is an
-- ordinary task with series_id and occurrence_date, and its own history.
create table if not exists public.task_series (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  notes text check (notes is null or char_length(notes) <= 10000),
  job_id uuid references public.jobs(id) on delete set null,
  assignee_user_id uuid references auth.users(id) on delete set null,
  due_time time,
  time_zone text not null default 'America/Los_Angeles',
  reminder_time time,
  reminder_days_before integer check (reminder_days_before is null or reminder_days_before between 0 and 30),
  rule jsonb not null,
  start_date date not null,
  -- The next date to make an occurrence for; null once the series has ended.
  next_date date,
  last_made date,
  made_count integer not null default 0,
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint task_series_job_series_are_shared check (job_id is null or visibility = 'workspace')
);

create index if not exists task_series_due_idx on public.task_series (next_date) where active and next_date is not null;
create index if not exists task_series_org_idx on public.task_series (organization_id);

drop trigger if exists set_task_series_updated_at on public.task_series;
create trigger set_task_series_updated_at before update on public.task_series
  for each row execute function public.set_updated_at();

alter table public.task_series enable row level security;

drop policy if exists "Members see shared series and their own" on public.task_series;
create policy "Members see shared series and their own" on public.task_series
  for select to authenticated
  using (
    (select private.is_org_member(organization_id))
    and (visibility = 'workspace' or created_by = (select auth.uid()) or owner_id = (select auth.uid()) or assignee_user_id = (select auth.uid()))
  );

drop policy if exists "Members add series as themselves" on public.task_series;
create policy "Members add series as themselves" on public.task_series
  for insert to authenticated
  with check ((select private.is_org_member(organization_id)) and created_by = (select auth.uid()));

drop policy if exists "Members change series they can see" on public.task_series;
create policy "Members change series they can see" on public.task_series
  for update to authenticated
  using (
    (select private.is_org_member(organization_id))
    and (visibility = 'workspace' or created_by = (select auth.uid()) or owner_id = (select auth.uid()) or assignee_user_id = (select auth.uid()))
  )
  with check ((select private.is_org_member(organization_id)));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_series_id_fkey') then
    alter table public.tasks
      add constraint tasks_series_id_fkey foreign key (series_id) references public.task_series(id) on delete set null;
  end if;
end;
$$;

-- One occurrence per date per series, however many times the worker runs.
create unique index if not exists tasks_series_occurrence_idx
  on public.tasks (series_id, occurrence_date) where series_id is not null;

-- Durable work: reminders now, assistant work later. Only the server touches it.
create table if not exists public.task_work (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  kind text not null check (kind in ('reminder', 'execution')),
  run_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'done', 'canceled', 'failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  task_version integer,
  claimed_at timestamptz,
  lease_until timestamptz,
  finished_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists task_work_due_idx on public.task_work (run_at) where status in ('pending', 'claimed');
create index if not exists task_work_task_idx on public.task_work (task_id);
create unique index if not exists task_work_one_live_reminder_idx
  on public.task_work (task_id) where kind = 'reminder' and status in ('pending', 'claimed');

alter table public.task_work enable row level security;
-- No policies: people never read or write the queue directly.

create table if not exists public.task_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  kind text not null check (kind in ('reminder', 'assigned', 'approval', 'input', 'result', 'failure')),
  title text not null check (char_length(title) <= 300),
  body text check (body is null or char_length(body) <= 2000),
  -- Each event notifies once, however often the worker retries.
  dedupe_key text not null unique check (char_length(dedupe_key) <= 300),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists task_notifications_user_idx on public.task_notifications (user_id, created_at desc);
create index if not exists task_notifications_unread_idx on public.task_notifications (user_id) where read_at is null;

alter table public.task_notifications enable row level security;

drop policy if exists "People read their own task notifications" on public.task_notifications;
create policy "People read their own task notifications" on public.task_notifications
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_org_member(organization_id)));

drop policy if exists "People mark their own task notifications read" on public.task_notifications;
create policy "People mark their own task notifications read" on public.task_notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Keep a task's reminder in the queue in step with the task, whoever changed
-- it: a moved reminder replaces the old one, and a completed, canceled or
-- archived task's reminder is called off. A reminder already sent for the same
-- time is not queued again.
create or replace function private.sync_task_reminder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  closed boolean := new.status in ('complete', 'canceled') or new.archived_at is not null;
begin
  update public.task_work
     set status = 'canceled', finished_at = now(), last_error = 'Replaced or no longer needed.'
   where task_id = new.id
     and kind = 'reminder'
     and status in ('pending', 'claimed')
     and (closed or new.reminder_at is null or run_at is distinct from new.reminder_at);

  if not closed
     and new.reminder_at is not null
     and new.reminder_at > now() - interval '5 minutes'
     and not exists (
       select 1 from public.task_work w
        where w.task_id = new.id and w.kind = 'reminder' and w.run_at = new.reminder_at
          and w.status in ('pending', 'claimed', 'done')
     ) then
    insert into public.task_work (organization_id, task_id, kind, run_at, task_version)
    values (new.organization_id, new.id, 'reminder', new.reminder_at, new.version);
  end if;
  return new;
end;
$$;

drop trigger if exists sync_task_reminder on public.tasks;
create trigger sync_task_reminder after insert or update of reminder_at, status, archived_at on public.tasks
  for each row execute function private.sync_task_reminder();

-- Tell someone when a task is given to them by somebody else.
create or replace function private.notify_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_user_id is not null
     and (tg_op = 'INSERT' or old.assignee_user_id is distinct from new.assignee_user_id)
     and new.assignee_user_id is distinct from coalesce((select auth.uid()), new.owner_id, new.created_by) then
    insert into public.task_notifications (organization_id, user_id, task_id, kind, title, dedupe_key)
    values (
      new.organization_id, new.assignee_user_id, new.id, 'assigned',
      left('Assigned to you: ' || new.title, 300),
      'assigned:' || new.id || ':' || new.assignee_user_id || ':' || new.version
    )
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_task_assignee on public.tasks;
create trigger notify_task_assignee after insert or update of assignee_user_id on public.tasks
  for each row execute function private.notify_task_assignee();

-- The worker's claim: due rows, and rows whose last claim's lease ran out.
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

create or replace function public.task_worker_token_ok(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(length(p_token) >= 32, false)
     and exists (select 1 from vault.decrypted_secrets s where s.name = 'task_worker_token' and s.decrypted_secret = p_token);
$$;
revoke all on function public.task_worker_token_ok(text) from public, anon, authenticated;
grant execute on function public.task_worker_token_ok(text) to service_role;

-- Anything for the worker to do: due or abandoned queue rows, or a series
-- whose next occurrence is within a week.
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
         );
$$;

-- The token and the address the scheduler calls, kept in Vault.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'task_worker_token') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'task_worker_token',
      'Protects /api/tasks/worker. Generated in the database; never shown.'
    );
  end if;
  if not exists (select 1 from vault.secrets where name = 'task_worker_url') then
    perform vault.create_secret(
      'https://www.volteira.com/api/tasks/worker',
      'task_worker_url',
      'Where pg_cron calls the task worker.'
    );
  end if;
end;
$$;

-- Every minute, call the worker only when something is due.
select cron.schedule(
  'volteira-task-worker',
  '* * * * *',
  $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'task_worker_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-task-worker-token', (select decrypted_secret from vault.decrypted_secrets where name = 'task_worker_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    )
    where private.task_work_due();
  $cron$
);
