-- The visits a job has already had.
--
-- A job is often more than one trip: a diagnostic that needs a part, a panel
-- change spread over two days, a return to finish trim. The job itself keeps
-- describing the visit that is next or under way (its window on `jobs`, the
-- times in `job_technician_progress`), so the schedule, the texts and the
-- workflow all keep working unchanged. When a visit ends with the job still
-- open, what it was is copied here, the progress row is cleared for the next
-- trip, and the job is booked again.
--
-- Additive only: nothing existing is changed or removed.

create table if not exists public.job_visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  technician_id uuid references public.technicians (id) on delete set null,
  -- The window the visit was booked for, as it was on the job.
  arrival_window_start timestamptz,
  arrival_window_end timestamptz,
  trip_started_at timestamptz,
  arrived_at timestamptz,
  work_started_at timestamptz,
  ended_at timestamptz not null default now(),
  -- What was done, and why another visit is needed. Written by a person.
  note text not null default '' check (char_length(note) <= 2000),
  ended_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists job_visits_job_idx
  on public.job_visits (organization_id, job_id, ended_at desc);

alter table public.job_visits enable row level security;

-- Members of the job's business, and only for a job of that business: a row
-- cannot name one business and point at another's job.
create policy "Organization members can view job visits"
  on public.job_visits for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy "Organization members can record job visits"
  on public.job_visits for insert to authenticated
  with check (
    (select private.is_org_member(organization_id))
    and exists (
      select 1 from public.jobs as job
      where job.id = job_visits.job_id
        and job.organization_id = job_visits.organization_id
    )
  );

-- A visit that happened is history: no update or delete policy, so members
-- cannot rewrite it. The job's own deletion still removes its visits.

grant select, insert on public.job_visits to authenticated;
grant all on public.job_visits to service_role;
