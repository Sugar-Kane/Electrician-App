-- When each technician set off, got there, started, and finished.
--
-- `jobs.status` records where a job is and cannot record when it got there.
-- That gap is why the four-button status strip existed: a technician tapped
-- "Arrived", the row changed to 'arrived', and the time they actually turned up
-- was gone. A customer asking "what time did he get here" was answered from
-- somebody's memory, and an arrival window that was missed looked identical to
-- one that was met.
--
-- Timestamps live per technician rather than on the job because arrival belongs
-- to a person, not to the work. Two electricians on a panel change arrive in two
-- vans at two times, and writing either one onto the job means the second to
-- arrive overwrites the first, or does not arrive at all.
--
-- `jobs.status` is still written alongside this and is still the job's overall
-- state. The schedule, the dashboard, the booking flow and the invoice path all
-- read it, and a second source of truth they did not know about would be worse
-- than the gap this closes.
--
-- Named for the job rather than as `technician_job_status`: every other
-- job-owned table here is `job_*`, and nothing in this row is a status. They are
-- four times and a note about how one of them was recorded.

create table if not exists public.job_technician_progress (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Progress dies with the job. Times against a job that no longer exists
  -- cannot be read, reported on, or explained to a customer.
  job_id uuid not null references public.jobs (id) on delete cascade,
  -- Nullable, because an owner-operator working alone often has no technician
  -- record of their own. Losing the arrival time of the only person who went is
  -- a worse outcome than an unattributed row.
  technician_id uuid references public.technicians (id) on delete set null,
  trip_started_at timestamptz,
  arrived_at timestamptz,
  -- How arrival was decided, which is the difference between a time a system
  -- observed and a time somebody typed. Both are legitimate; a dispute over an
  -- arrival window is not the moment to discover nobody recorded which.
  arrival_source text check (arrival_source in ('geofence', 'manual')),
  work_started_at timestamptz,
  completed_at timestamptz,
  -- When the customer was told, not whether. A null here after the matching
  -- event means nobody was told — which is a real answer, and the one an office
  -- needs when somebody complains they had no warning.
  --
  -- Two columns rather than one flag, because they answer different questions
  -- and a customer can legitimately get one and not the other: the business may
  -- send "on the way" and not "arrived", quiet hours are evaluated per message,
  -- and a technician can arrive at a job they never started a trip for.
  customer_en_route_notified_at timestamptz,
  customer_arrival_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per person per job. `nulls not distinct` is what makes that true for
-- the unattributed row as well: without it Postgres treats every null
-- technician as a different technician, and an owner-operator would collect a
-- fresh row — and a fresh arrival time — on every tap.
create unique index if not exists job_technician_progress_unique_idx
  on public.job_technician_progress (job_id, technician_id) nulls not distinct;

-- An arrival cannot be recorded without saying how it was decided, and a source
-- cannot be recorded without an arrival. Either alone is a half-written row that
-- reads as fact later.
alter table public.job_technician_progress
  drop constraint if exists job_technician_progress_arrival_source_check;
alter table public.job_technician_progress
  add constraint job_technician_progress_arrival_source_check
  check ((arrived_at is null) = (arrival_source is null));

-- "Who is out right now", answered without scanning the table.
create index if not exists job_technician_progress_technician_idx
  on public.job_technician_progress (organization_id, technician_id, arrived_at desc);

alter table public.job_technician_progress enable row level security;

-- Membership of the owning organization is the whole rule, through the
-- foundation helper rather than an inline subquery — one definition of "may see
-- this" is easier to keep right than a copy per table.
create policy "Organization members can view job progress"
  on public.job_technician_progress for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy "Organization members can record job progress"
  on public.job_technician_progress for insert to authenticated
  with check ((select private.is_org_member(organization_id)));

create policy "Organization members can change job progress"
  on public.job_technician_progress for update to authenticated
  using ((select private.is_org_member(organization_id)))
  with check ((select private.is_org_member(organization_id)));

create trigger set_job_technician_progress_updated_at
  before update on public.job_technician_progress
  for each row execute function public.set_updated_at();

comment on table public.job_technician_progress is
  'When each technician set off for a job, reached it, started work and finished. Arrival is per technician because two vans arrive at two times.';
comment on column public.job_technician_progress.arrival_source is
  'geofence when the app recognised arrival from the phone''s location, manual when somebody said so.';
comment on column public.job_technician_progress.customer_en_route_notified_at is
  'When the "on the way" text actually went. Null after a trip started means nobody was told.';
comment on column public.job_technician_progress.customer_arrival_notified_at is
  'When the arrival text actually went. Null after an arrival means nobody was told.';

-- How close counts as being there.
--
-- Per business rather than per deployment, because the answer differs by the
-- work: a residential service van wants a tight circle so the house across the
-- road is outside it, and an outfit working ranches and industrial parks needs
-- one wide enough that the gate counts. 120 metres is about 400 feet.
--
-- Bounded rather than free: a radius smaller than a good GPS fix describes an
-- arrival that can never happen, and the app would silently stop detecting
-- anything with no way to tell why.
alter table public.service_settings
  add column if not exists arrival_radius_meters integer not null default 120;

alter table public.service_settings
  drop constraint if exists service_settings_arrival_radius_check;
alter table public.service_settings
  add constraint service_settings_arrival_radius_check
  check (arrival_radius_meters between 40 and 1600);

comment on column public.service_settings.arrival_radius_meters is
  'Radius of the automatic-arrival geofence around a service address, in metres. 120m is about 400ft.';
