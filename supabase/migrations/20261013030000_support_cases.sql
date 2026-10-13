-- Support cases, and the overview that finds what needs one.
--
-- A case is support's own record of a problem somebody reported or the
-- console found: who reported it, what they saw, the records involved, who is
-- on it and when the next update is owed, and — before it can close — what
-- the cause was, what fixed it, and the evidence that it is fixed.
--
-- Lifecycle: open → waiting (on the business or a provider) → fix ready to
-- verify → closed, and back to open when it wasn't fixed after all. Moving to
-- "verify" needs the fix written down; closing needs the evidence.
--
-- Cases hold no business data and change none, so any platform admin may work
-- them, support role included. Everything is written through the functions
-- below, which refuse anybody else and record each step on the case.

create table if not exists public.support_cases (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  organization_id uuid references public.organizations(id) on delete cascade,
  opened_by uuid references auth.users(id) on delete set null,
  reporter text,
  category text not null
    check (category in ('booking', 'texting', 'email', 'payment', 'assistant', 'schedule', 'access', 'data', 'other')),
  severity text not null default 'normal' check (severity in ('low', 'normal', 'high', 'urgent')),
  symptom text not null check (char_length(symptom) between 3 and 2000),
  steps text,
  occurred_at timestamptz,
  occurred_zone text,
  assignee uuid references auth.users(id) on delete set null,
  next_update_due timestamptz,
  root_cause text,
  fix text,
  resolution_evidence text,
  state text not null default 'open' check (state in ('open', 'waiting', 'verifying', 'closed')),
  reopened_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists support_cases_state_idx on public.support_cases(state, next_update_due);
create index if not exists support_cases_org_idx on public.support_cases(organization_id, created_at desc);

create table if not exists public.support_case_links (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete cascade,
  target_type text not null
    check (target_type in ('business', 'message', 'booking', 'job', 'customer', 'payment', 'assistant', 'operation')),
  target_id uuid not null,
  label text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (case_id, target_type, target_id)
);

create table if not exists public.support_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('opened', 'note', 'state', 'assigned', 'edited', 'linked')),
  body text,
  from_state text,
  to_state text,
  -- The wall clock, not the transaction's: a case opened and linked in one
  -- step must still show "Opened" first.
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists support_case_events_case_idx on public.support_case_events(case_id, created_at);

alter table public.support_cases enable row level security;
alter table public.support_case_links enable row level security;
alter table public.support_case_events enable row level security;

do $$
declare
  entry record;
begin
  for entry in
    select * from (values
      ('support_cases', 'Admins can see support cases'),
      ('support_case_links', 'Admins can see support case links'),
      ('support_case_events', 'Admins can see support case events')
    ) as wanted(table_name, policy_name)
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = entry.table_name and policyname = entry.policy_name
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated using ((select private.is_platform_admin()))',
        entry.policy_name, entry.table_name
      );
    end if;
  end loop;
end;
$$;

grant select on table public.support_cases, public.support_case_links, public.support_case_events to authenticated;

/** The business a record belongs to, or null when there is no such record. */
create or replace function private.case_target_business(p_target_type text, p_target_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case p_target_type
    when 'business' then (select id from public.organizations where id = p_target_id)
    when 'message' then (select organization_id from public.messages where id = p_target_id)
    when 'booking' then (select organization_id from public.booking_requests where id = p_target_id)
    when 'job' then (select organization_id from public.jobs where id = p_target_id)
    when 'customer' then (select organization_id from public.customers where id = p_target_id)
    when 'payment' then (select organization_id from public.payments where id = p_target_id)
    when 'assistant' then (select organization_id from public.mcp_call_log where id = p_target_id)
    when 'operation' then (select organization_id from public.support_operations where id = p_target_id)
    else null
  end;
$$;

revoke all on function private.case_target_business(text, uuid) from public, anon, authenticated;

/** Link a record to a case, refusing one from another business. */
create or replace function private.link_case_record(p_case public.support_cases, p_target_type text, p_target_id uuid, p_label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  business uuid := private.case_target_business(p_target_type, p_target_id);
begin
  if business is null then
    raise exception using errcode = 'P0002', message = 'That record could not be found.';
  end if;
  if p_case.organization_id is not null and business <> p_case.organization_id then
    raise exception using errcode = '42501', message = 'That record belongs to another business.';
  end if;
  insert into public.support_case_links (case_id, target_type, target_id, label, created_by)
  values (p_case.id, p_target_type, p_target_id, left(nullif(trim(coalesce(p_label, '')), ''), 120), (select auth.uid()))
  on conflict (case_id, target_type, target_id) do nothing;
  insert into public.support_case_events (case_id, actor_user_id, kind, body)
  values (p_case.id, (select auth.uid()), 'linked', coalesce(nullif(trim(coalesce(p_label, '')), ''), p_target_type));
end;
$$;

revoke all on function private.link_case_record(public.support_cases, text, uuid, text) from public, anon, authenticated;

create or replace function public.admin_case_open(
  p_organization_id uuid,
  p_category text,
  p_severity text,
  p_symptom text,
  p_steps text default null,
  p_reporter text default null,
  p_occurred_at timestamptz default null,
  p_occurred_zone text default null,
  p_link_type text default null,
  p_link_id uuid default null,
  p_link_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  opened public.support_cases;
begin
  if not (select private.is_platform_admin()) then
    raise exception using errcode = '42501', message = 'Not a platform admin.';
  end if;
  if char_length(trim(coalesce(p_symptom, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Say what the problem is.';
  end if;
  if p_organization_id is not null and not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception using errcode = 'P0002', message = 'No such business.';
  end if;

  insert into public.support_cases (
    organization_id, opened_by, reporter, category, severity, symptom, steps, occurred_at, occurred_zone,
    assignee, next_update_due
  )
  values (
    p_organization_id, (select auth.uid()), left(nullif(trim(coalesce(p_reporter, '')), ''), 300), p_category,
    coalesce(p_severity, 'normal'), left(trim(p_symptom), 2000), left(nullif(trim(coalesce(p_steps, '')), ''), 4000),
    p_occurred_at, left(nullif(trim(coalesce(p_occurred_zone, '')), ''), 64),
    -- Whoever opens it owns it until somebody else takes it, with an update owed tomorrow.
    (select auth.uid()), date_trunc('minute', now()) + interval '1 day'
  )
  returning * into opened;

  insert into public.support_case_events (case_id, actor_user_id, kind, to_state, body)
  values (opened.id, (select auth.uid()), 'opened', 'open', left(trim(p_symptom), 300));

  if p_link_type is not null and p_link_id is not null then
    perform private.link_case_record(opened, p_link_type, p_link_id, p_link_label);
  end if;

  perform private.record_admin_action(
    'case.opened',
    p_organization_id,
    jsonb_build_object('case', opened.id, 'number', opened.number, 'category', p_category, 'severity', opened.severity)
  );
  return opened.id;
end;
$$;

revoke all on function public.admin_case_open(uuid, text, text, text, text, text, timestamptz, text, text, uuid, text) from public, anon;
grant execute on function public.admin_case_open(uuid, text, text, text, text, text, timestamptz, text, text, uuid, text) to authenticated;

/** The case as it is now, locked, if it hasn't changed since the page was shown. */
create or replace function private.case_for_change(p_case_id uuid, p_expected_updated_at timestamptz)
returns public.support_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  found public.support_cases;
begin
  if not (select private.is_platform_admin()) then
    raise exception using errcode = '42501', message = 'Not a platform admin.';
  end if;
  select * into found from public.support_cases where id = p_case_id for update;
  if found.id is null then
    raise exception using errcode = 'P0002', message = 'No such case.';
  end if;
  if p_expected_updated_at is not null and found.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'PT409', message = 'Somebody changed this case since you opened it. Look again.';
  end if;
  return found;
end;
$$;

revoke all on function private.case_for_change(uuid, timestamptz) from public, anon, authenticated;

/** Change a case's details. Only the fields given are changed. */
create or replace function public.admin_case_edit(p_case_id uuid, p_expected_updated_at timestamptz, p_fields jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current public.support_cases := private.case_for_change(p_case_id, p_expected_updated_at);
  fields jsonb := coalesce(p_fields, '{}'::jsonb);
  changed text[];
  stamp timestamptz := clock_timestamp();
begin
  if fields ? 'symptom' and char_length(trim(coalesce(fields->>'symptom', ''))) < 3 then
    raise exception using errcode = '22023', message = 'Say what the problem is.';
  end if;

  -- Only what actually changed goes on the timeline; a form saved untouched records nothing.
  select array_agg(entry.key order by entry.key) into changed
  from jsonb_each_text(fields) as entry(key, value)
  where case entry.key
    when 'reporter' then left(nullif(trim(entry.value), ''), 300) is distinct from current.reporter
    when 'category' then entry.value is not null and entry.value is distinct from current.category
    when 'severity' then entry.value is not null and entry.value is distinct from current.severity
    when 'symptom' then left(trim(entry.value), 2000) is distinct from current.symptom
    when 'steps' then left(nullif(trim(entry.value), ''), 4000) is distinct from current.steps
    when 'occurred_at' then nullif(entry.value, '')::timestamptz is distinct from current.occurred_at
    when 'occurred_zone' then left(nullif(trim(entry.value), ''), 64) is distinct from current.occurred_zone
    when 'next_update_due' then nullif(entry.value, '')::timestamptz is distinct from current.next_update_due
    when 'root_cause' then left(nullif(trim(entry.value), ''), 4000) is distinct from current.root_cause
    when 'fix' then left(nullif(trim(entry.value), ''), 4000) is distinct from current.fix
    when 'resolution_evidence' then left(nullif(trim(entry.value), ''), 4000) is distinct from current.resolution_evidence
    else false
  end;
  if coalesce(cardinality(changed), 0) = 0 then
    return current.updated_at;
  end if;

  update public.support_cases set
    reporter = case when fields ? 'reporter' then left(nullif(trim(fields->>'reporter'), ''), 300) else reporter end,
    category = case when fields->>'category' is not null then fields->>'category' else category end,
    severity = case when fields->>'severity' is not null then fields->>'severity' else severity end,
    symptom = case when fields ? 'symptom' then left(trim(fields->>'symptom'), 2000) else symptom end,
    steps = case when fields ? 'steps' then left(nullif(trim(fields->>'steps'), ''), 4000) else steps end,
    occurred_at = case when fields ? 'occurred_at' then nullif(fields->>'occurred_at', '')::timestamptz else occurred_at end,
    occurred_zone = case when fields ? 'occurred_zone' then left(nullif(trim(fields->>'occurred_zone'), ''), 64) else occurred_zone end,
    next_update_due = case when fields ? 'next_update_due' then nullif(fields->>'next_update_due', '')::timestamptz else next_update_due end,
    root_cause = case when fields ? 'root_cause' then left(nullif(trim(fields->>'root_cause'), ''), 4000) else root_cause end,
    fix = case when fields ? 'fix' then left(nullif(trim(fields->>'fix'), ''), 4000) else fix end,
    resolution_evidence = case when fields ? 'resolution_evidence' then left(nullif(trim(fields->>'resolution_evidence'), ''), 4000) else resolution_evidence end,
    updated_at = stamp
  where id = p_case_id;

  insert into public.support_case_events (case_id, actor_user_id, kind, body)
  values (p_case_id, (select auth.uid()), 'edited', array_to_string(changed, ', '));
  return stamp;
end;
$$;

revoke all on function public.admin_case_edit(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.admin_case_edit(uuid, timestamptz, jsonb) to authenticated;

/**
 * Move a case along its lifecycle.
 *
 * open ⇄ waiting, either → verifying (needs the fix written down), verifying →
 * closed (needs the evidence), anything → closed with evidence, and closed →
 * open to reopen, which needs a note saying why.
 */
create or replace function public.admin_case_move(p_case_id uuid, p_expected_updated_at timestamptz, p_to_state text, p_note text default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current public.support_cases := private.case_for_change(p_case_id, p_expected_updated_at);
  note text := nullif(trim(coalesce(p_note, '')), '');
  stamp timestamptz := clock_timestamp();
begin
  if p_to_state not in ('open', 'waiting', 'verifying', 'closed') or p_to_state = current.state then
    raise exception using errcode = '22023', message = 'That isn''t a move this case can make.';
  end if;
  if current.state = 'closed' and p_to_state <> 'open' then
    raise exception using errcode = '22023', message = 'A closed case can only be reopened.';
  end if;
  if p_to_state = 'verifying' and current.fix is null then
    raise exception using errcode = '22023', message = 'Write down the fix before asking for it to be verified.';
  end if;
  if p_to_state = 'closed' and current.resolution_evidence is null then
    raise exception using errcode = '22023', message = 'Write down the evidence that it''s fixed before closing.';
  end if;
  if current.state = 'closed' and note is null then
    raise exception using errcode = '22023', message = 'Say why it''s being reopened.';
  end if;

  update public.support_cases set
    state = p_to_state,
    closed_at = case when p_to_state = 'closed' then stamp else null end,
    reopened_count = reopened_count + case when current.state = 'closed' then 1 else 0 end,
    next_update_due = case when p_to_state = 'closed' then null else coalesce(next_update_due, date_trunc('minute', stamp) + interval '1 day') end,
    updated_at = stamp
  where id = p_case_id;

  insert into public.support_case_events (case_id, actor_user_id, kind, from_state, to_state, body)
  values (p_case_id, (select auth.uid()), 'state', current.state, p_to_state, left(note, 2000));

  perform private.record_admin_action(
    'case.moved',
    current.organization_id,
    jsonb_build_object('case', current.id, 'number', current.number, 'from', current.state, 'to', p_to_state)
  );
  return stamp;
end;
$$;

revoke all on function public.admin_case_move(uuid, timestamptz, text, text) from public, anon;
grant execute on function public.admin_case_move(uuid, timestamptz, text, text) to authenticated;

/** Give a case to an admin, or to nobody. */
create or replace function public.admin_case_assign(p_case_id uuid, p_assignee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current public.support_cases := private.case_for_change(p_case_id, null);
begin
  if p_assignee is not null and not exists (select 1 from public.platform_admins where user_id = p_assignee) then
    raise exception using errcode = '22023', message = 'Only a Volteira admin can be given a case.';
  end if;
  update public.support_cases set assignee = p_assignee, updated_at = clock_timestamp() where id = p_case_id;
  insert into public.support_case_events (case_id, actor_user_id, kind, body)
  values (
    p_case_id, (select auth.uid()), 'assigned',
    coalesce((select email::text from auth.users where id = p_assignee), 'nobody')
  );
end;
$$;

revoke all on function public.admin_case_assign(uuid, uuid) from public, anon;
grant execute on function public.admin_case_assign(uuid, uuid) to authenticated;

create or replace function public.admin_case_note(p_case_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current public.support_cases := private.case_for_change(p_case_id, null);
begin
  if char_length(trim(coalesce(p_body, ''))) < 2 then
    raise exception using errcode = '22023', message = 'Write the note first.';
  end if;
  update public.support_cases set updated_at = clock_timestamp() where id = p_case_id;
  insert into public.support_case_events (case_id, actor_user_id, kind, body)
  values (p_case_id, (select auth.uid()), 'note', left(trim(p_body), 4000));
end;
$$;

revoke all on function public.admin_case_note(uuid, text) from public, anon;
grant execute on function public.admin_case_note(uuid, text) to authenticated;

create or replace function public.admin_case_link(p_case_id uuid, p_target_type text, p_target_id uuid, p_label text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current public.support_cases := private.case_for_change(p_case_id, null);
begin
  perform private.link_case_record(current, p_target_type, p_target_id, p_label);
  update public.support_cases set updated_at = clock_timestamp() where id = p_case_id;
end;
$$;

revoke all on function public.admin_case_link(uuid, text, uuid, text) from public, anon;
grant execute on function public.admin_case_link(uuid, text, uuid, text) to authenticated;

/** Cases, most urgent first: overdue updates, then severity, then newest. */
create or replace function public.admin_cases(
  p_state text default null,
  p_organization_id uuid default null,
  p_assignee uuid default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  number bigint,
  organization_id uuid,
  organization_name text,
  organization_timezone text,
  category text,
  severity text,
  symptom text,
  state text,
  assignee_email text,
  next_update_due timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  closed_at timestamptz,
  link_count integer,
  overdue boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id, c.number, c.organization_id, organization.name, coalesce(organization.timezone, 'America/Los_Angeles'),
    c.category, c.severity, left(c.symptom, 300), c.state, assignee.email::text, c.next_update_due,
    c.created_at, c.updated_at, c.closed_at,
    (select count(*)::integer from public.support_case_links as link where link.case_id = c.id),
    c.state <> 'closed' and c.next_update_due < now()
  from public.support_cases as c
  left join public.organizations as organization on organization.id = c.organization_id
  left join auth.users as assignee on assignee.id = c.assignee
  where (select private.is_platform_admin())
    and (
      p_state is null
      or (p_state = 'active' and c.state <> 'closed')
      or c.state = p_state
    )
    and (p_organization_id is null or c.organization_id = p_organization_id)
    and (p_assignee is null or c.assignee = p_assignee)
  order by
    (c.state <> 'closed' and c.next_update_due < now()) desc,
    array_position(array['urgent', 'high', 'normal', 'low'], c.severity),
    c.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 300));
$$;

revoke all on function public.admin_cases(text, uuid, uuid, integer) from public, anon;
grant execute on function public.admin_cases(text, uuid, uuid, integer) to authenticated;

/** One case with its records, its timeline, and the operations run on its records. */
create or replace function public.admin_case_detail(p_case_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not (select private.is_platform_admin()) then null else (
    select jsonb_build_object(
      'case', to_jsonb(c) || jsonb_build_object(
        'organization_name', organization.name,
        'organization_timezone', coalesce(organization.timezone, 'America/Los_Angeles'),
        'opened_by_email', opener.email,
        'assignee_email', assignee.email,
        'overdue', c.state <> 'closed' and c.next_update_due < now()
      ),
      'links', coalesce((
        select jsonb_agg(jsonb_build_object(
          'type', link.target_type, 'id', link.target_id, 'label', link.label, 'created_at', link.created_at,
          'job_number', (select job.job_number from public.jobs as job where link.target_type = 'job' and job.id = link.target_id)
        ) order by link.created_at)
        from public.support_case_links as link where link.case_id = c.id
      ), '[]'::jsonb),
      'events', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', event.kind, 'body', event.body, 'from_state', event.from_state, 'to_state', event.to_state,
          'created_at', event.created_at, 'actor', actor.email
        ) order by event.created_at)
        from public.support_case_events as event
        left join auth.users as actor on actor.id = event.actor_user_id
        where event.case_id = c.id
      ), '[]'::jsonb),
      'operations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', op.id, 'tool', op.tool, 'state', op.state, 'created_at', op.created_at, 'reason', op.reason
        ) order by op.created_at desc)
        from public.support_operations as op
        where op.target_id in (select link.target_id from public.support_case_links as link where link.case_id = c.id)
           or op.id in (select link.target_id from public.support_case_links as link where link.case_id = c.id and link.target_type = 'operation')
      ), '[]'::jsonb),
      'admins', coalesce((
        select jsonb_agg(jsonb_build_object('id', admin.user_id, 'email', users.email, 'role', admin.role) order by users.email)
        from public.platform_admins as admin
        join auth.users as users on users.id = admin.user_id
      ), '[]'::jsonb)
    )
    from public.support_cases as c
    left join public.organizations as organization on organization.id = c.organization_id
    left join auth.users as opener on opener.id = c.opened_by
    left join auth.users as assignee on assignee.id = c.assignee
    where c.id = p_case_id
  ) end;
$$;

revoke all on function public.admin_case_detail(uuid) from public, anon;
grant execute on function public.admin_case_detail(uuid) to authenticated;

/**
 * What is going wrong across every business right now, from the records
 * themselves. One row per business and kind, with when it started, when it
 * last happened, how often, and the most recent record to open.
 *
 * Past visits and setup gaps are worked out in the app with the same rules the
 * rest of the console uses; this covers what only the database can see.
 */
create or replace function public.admin_overview_issues()
returns table (
  kind text,
  organization_id uuid,
  first_at timestamptz,
  last_at timestamptz,
  occurrences integer,
  target_type text,
  target_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with failed_texts as (
    -- Failed in the last week, and nothing sent or delivered in that conversation since.
    select message.organization_id, message.id, message.created_at
    from public.messages as message
    where message.direction = 'outbound'
      and message.status in ('failed', 'undelivered')
      and message.created_at > now() - interval '7 days'
      and not exists (
        select 1 from public.messages as later
        where later.conversation_id = message.conversation_id
          and later.direction = 'outbound'
          and later.created_at > message.created_at
          and later.status in ('sent', 'delivered')
      )
  ),
  failed_alerts as (
    -- A booking whose owner alert never went by any channel.
    select request.organization_id, request.id, request.created_at
    from public.booking_requests as request
    where request.created_at > now() - interval '7 days'
      and request.archived_at is null
      and exists (
        select 1 from jsonb_array_elements(request.notification_results) as attempt
        where attempt->>'audience' = 'owner' and coalesce((attempt->>'ok')::boolean, false) = false
      )
      and not exists (
        select 1 from jsonb_array_elements(request.notification_results) as attempt
        where attempt->>'audience' = 'owner' and coalesce((attempt->>'ok')::boolean, false) = true
      )
  ),
  assistant_problems as (
    -- A tool that failed outright, or a claim to have saved something with no booking behind it.
    select log.organization_id, log.id, log.created_at
    from public.mcp_call_log as log
    where log.created_at > now() - interval '7 days'
      and log.method = 'tools/call'
      and log.organization_id is not null
      and (
        (log.is_error and coalesce(log.result_text, '') not like 'NOT BOOKED%')
        or (
          log.session_key is not null
          and log.tool_name in ('book_visit', 'request_callback')
          and log.booking_request_id is null
          and coalesce(log.result_text, '') ~ '^(Booked:|Held, not yet confirmed|No appointment was booked automatically|Callback logged|The live transfer was unavailable|Live transfer started)'
        )
      )
  ),
  paid_unbooked as (
    -- Money taken for a booking that is neither confirmed, scheduled nor a job.
    select request.organization_id, request.id, coalesce(payment.paid_at, payment.created_at) as at
    from public.payments as payment
    join public.booking_requests as request on request.id = payment.booking_request_id
    where payment.status = 'succeeded'
      and request.created_job_id is null
      and request.status not in ('confirmed', 'scheduled')
  )
  select 'text_failing', organization_id, min(created_at), max(created_at), count(*)::integer,
         'message', (array_agg(id order by created_at desc))[1]
  from failed_texts group by organization_id
  union all
  select 'alert_failing', organization_id, min(created_at), max(created_at), count(*)::integer,
         'booking', (array_agg(id order by created_at desc))[1]
  from failed_alerts group by organization_id
  union all
  select 'assistant_problem', organization_id, min(created_at), max(created_at), count(*)::integer,
         'assistant', (array_agg(id order by created_at desc))[1]
  from assistant_problems group by organization_id
  union all
  select 'paid_unbooked', organization_id, at, at, 1, 'booking', id
  from paid_unbooked
  where (select private.is_platform_admin());
$$;

revoke all on function public.admin_overview_issues() from public, anon;
grant execute on function public.admin_overview_issues() to authenticated;

/** Visits whose time has passed and whose job isn't finished, for the overview to sort with Today's rules. */
create or replace function public.admin_overdue_visits(p_limit integer default 500)
returns table (
  id uuid,
  organization_id uuid,
  job_number bigint,
  customer_name text,
  status text,
  category text,
  scheduled_start timestamptz,
  scheduled_end timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    job.id, job.organization_id, job.job_number,
    coalesce(nullif(trim(customer.company_name), ''), nullif(trim(concat_ws(' ', customer.first_name, customer.last_name)), ''), ''),
    job.status, job.category, job.scheduled_start, job.scheduled_end
  from public.jobs as job
  join public.organizations as organization on organization.id = job.organization_id and organization.archived_at is null
  left join public.customers as customer on customer.id = job.customer_id
  where (select private.is_platform_admin())
    and job.archived_at is null
    and job.scheduled_start is not null
    and job.scheduled_start < now()
    and job.status not in ('completed', 'canceled')
  order by job.scheduled_start desc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

revoke all on function public.admin_overdue_visits(integer) from public, anon;
grant execute on function public.admin_overdue_visits(integer) to authenticated;

/** Facts about the platform itself that the overview states plainly. */
create or replace function public.admin_platform_facts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not (select private.is_platform_admin()) then null else jsonb_build_object(
    'subscriptions', (select count(*) from public.organization_subscriptions),
    'open_cases', (select count(*) from public.support_cases where state <> 'closed'),
    'overdue_cases', (select count(*) from public.support_cases where state <> 'closed' and next_update_due < now())
  ) end;
$$;

revoke all on function public.admin_platform_facts() from public, anon;
grant execute on function public.admin_platform_facts() to authenticated;
