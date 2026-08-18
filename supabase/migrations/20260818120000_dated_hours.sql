-- Hours for a particular date, not just a particular weekday.
--
-- `technician_hours` stores a weekday, so a week is the same forever. Real
-- weeks are not: this week is Monday, Wednesday and Friday, next week is
-- Tuesday and Thursday, and somebody wants to work one Saturday from twelve
-- until four. None of that is expressible in a recurring pattern, and the only
-- dated thing the schema had was `blackout_periods`, which can take time away
-- and can never give it back.
--
-- So this table gives it back: dated *availability*. A row says "on this date,
-- these are the hours" and it answers for that date completely, whatever the
-- weekly pattern says. Taking a single day off stays where it already works —
-- time off — so the two never mean the same thing in two places.
--
-- `technician_id is null` means the business itself, the same reading
-- `blackout_periods` has used since business-wide closures were added.

create table if not exists public.technician_date_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Null is the business, not a missing value.
  technician_id uuid references public.technicians(id) on delete cascade,
  on_date date not null,
  starts_at time not null,
  ends_at time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint technician_date_hours_span_check check (ends_at > starts_at)
);

-- One answer per person per date. Two rows would be a split shift, which
-- nothing asks for and which would make "what are the hours on the 14th" a
-- question with two answers.
create unique index if not exists technician_date_hours_person_idx
  on public.technician_date_hours (organization_id, technician_id, on_date)
  where technician_id is not null;

create unique index if not exists technician_date_hours_business_idx
  on public.technician_date_hours (organization_id, on_date)
  where technician_id is null;

create index if not exists technician_date_hours_lookup_idx
  on public.technician_date_hours (organization_id, on_date);

alter table public.technician_date_hours enable row level security;

-- The same shape as technician_hours: the whole business can see who works
-- when, and only an owner can change it.
drop policy if exists technician_date_hours_member_read on public.technician_date_hours;
create policy technician_date_hours_member_read on public.technician_date_hours
  for select using ((select private.is_org_member(organization_id)));

drop policy if exists technician_date_hours_admin_write on public.technician_date_hours;
create policy technician_date_hours_admin_write on public.technician_date_hours
  for all using ((select private.is_org_admin(organization_id)))
  with check ((select private.is_org_admin(organization_id)));

drop trigger if exists set_technician_date_hours_updated_at on public.technician_date_hours;
create trigger set_technician_date_hours_updated_at
  before update on public.technician_date_hours
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- Is anybody working then?
-- ---------------------------------------------------------------------------
--
-- One definition, because there were about to be two. The booking page asks it
-- to build a list of offers; the SMS and voice scheduler needs to ask it before
-- writing a job. Those answers drifting apart is exactly how a customer ends up
-- with an appointment on a day nobody is working, so they are the same function
-- rather than the same rules typed twice.
--
-- Deliberately *not* included here: how many people are already busy, and how
-- far ahead the booking is. Those belong to the public booking page — an owner
-- scheduling a texted request an hour from now is doing something reasonable,
-- and being told nobody is working would be a lie.
create or replace function private.window_is_staffed(
  p_organization_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  organization_timezone text;
  organization_business_hours jsonb;
  day_value date;
  local_start time;
  local_end time;
  day_config jsonb;
  business_start time;
  business_end time;
  candidate_weekday smallint;
begin
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    return false;
  end if;

  select organization.timezone, settings.business_hours
  into organization_timezone, organization_business_hours
  from public.organizations as organization
  join public.service_settings as settings
    on settings.organization_id = organization.id
  where organization.id = p_organization_id;

  if organization_timezone is null then
    return false;
  end if;

  -- The wall clock the hours are written in, not the instant they are stored as.
  day_value := (p_starts_at at time zone organization_timezone)::date;
  local_start := (p_starts_at at time zone organization_timezone)::time;
  local_end := (p_ends_at at time zone organization_timezone)::time;

  -- A window running past midnight is not something any of these hours can
  -- describe, and treating it as a short window would quietly say yes.
  if local_end <= local_start then
    return false;
  end if;

  -- Closed is closed. This outranks every dated decision below it, so opening
  -- one Saturday cannot accidentally reopen Christmas.
  if exists (
    select 1
    from public.blackout_periods as closure
    where closure.organization_id = p_organization_id
      and closure.technician_id is null
      and closure.block_type in ('hard', 'private')
      and closure.starts_at < p_ends_at
      and closure.ends_at > p_starts_at
  ) then
    return false;
  end if;

  -- The business's hours for this date. A dated row is a decision somebody made
  -- on purpose about this day, so it answers ahead of the usual week.
  select dated.starts_at, dated.ends_at
  into business_start, business_end
  from public.technician_date_hours as dated
  where dated.organization_id = p_organization_id
    and dated.technician_id is null
    and dated.on_date = day_value;

  if not found then
    day_config := organization_business_hours
      -> pg_catalog.lower(pg_catalog.to_char(day_value, 'FMDay'));

    if day_config is null
      or coalesce((day_config ->> 'enabled')::boolean, false) is false then
      return false;
    end if;

    begin
      business_start := (day_config ->> 'start')::time;
      business_end := (day_config ->> 'end')::time;
    exception when others then
      return false;
    end;
  end if;

  if local_start < business_start or local_end > business_end then
    return false;
  end if;

  -- `date_part`, not `extract`: `extract(dow from ...)` is special syntax rather
  -- than an ordinary call, so it cannot be schema-qualified, and this function
  -- runs with an empty search_path where everything must be.
  candidate_weekday := pg_catalog.date_part('dow', day_value)::smallint;

  return exists (
    select 1
    from public.technicians as technician
    where technician.organization_id = p_organization_id
      and technician.is_active
      and (
        technician.skills = '{}'::text[]
        or technician.skills && array['general_service', 'diagnostics']::text[]
      )
      and not exists (
        select 1
        from public.blackout_periods as blackout
        where blackout.technician_id = technician.id
          and blackout.block_type in ('hard', 'private')
          and blackout.starts_at < p_ends_at
          and blackout.ends_at > p_starts_at
      )
      and (
        case
          -- A date somebody set on purpose is the whole answer for that date.
          when exists (
            select 1 from public.technician_date_hours as dated
            where dated.technician_id = technician.id and dated.on_date = day_value
          ) then exists (
            select 1 from public.technician_date_hours as dated
            where dated.technician_id = technician.id
              and dated.on_date = day_value
              and dated.starts_at <= local_start
              and dated.ends_at >= local_end
          )
          -- Otherwise the usual week, if they have one.
          when exists (
            select 1 from public.technician_hours as hours
            where hours.technician_id = technician.id
          ) then exists (
            select 1 from public.technician_hours as hours
            where hours.technician_id = technician.id
              and hours.weekday = candidate_weekday
              and hours.starts_at <= local_start
              and hours.ends_at >= local_end
          )
          -- No hours set at all: available whenever the business is open, which
          -- is what every row meant before any of this existed.
          else true
        end
      )
  );
end;
$fn$;

revoke all on function private.window_is_staffed(uuid, timestamptz, timestamptz) from public;


-- ---------------------------------------------------------------------------
-- The booking page's offers, now asking that one question.
-- ---------------------------------------------------------------------------
create or replace function public.list_public_booking_slots(
  p_slug text,
  p_from_date date default current_date,
  p_days integer default 14
)
returns table(
  slot_start timestamp with time zone,
  slot_end timestamp with time zone,
  fee_cents integer,
  priority text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  target_organization_id uuid;
  organization_timezone text;
  standard_fee integer;
  day_value date;
  local_window_start time;
  local_window_end time;
  candidate_start timestamptz;
  candidate_end timestamptz;
  available_technician_count integer;
  occupied_count integer;
begin
  if p_days not between 1 and 31
    or p_from_date < current_date
    or p_from_date > current_date + 31 then
    return;
  end if;

  select organization.id, organization.timezone, settings.diagnostic_fee_cents
  into target_organization_id, organization_timezone, standard_fee
  from public.organizations as organization
  join public.service_settings as settings
    on settings.organization_id = organization.id
  where organization.slug = lower(btrim(p_slug))
    and organization.archived_at is null
    and organization.base_postal_code is not null
  limit 1;

  if target_organization_id is null then
    return;
  end if;

  for day_value in
    select generated_day::date
    from pg_catalog.generate_series(
      p_from_date::timestamp,
      (p_from_date + (p_days - 1))::timestamp,
      interval '1 day'
    ) as generated_day
  loop
    for local_window_start, local_window_end in
      select window_start, window_end
      from (values
        (time '08:00', time '10:00'),
        (time '10:00', time '12:00'),
        (time '13:00', time '15:00'),
        (time '15:00', time '17:00')
      ) as windows(window_start, window_end)
    loop
      candidate_start := (day_value + local_window_start) at time zone organization_timezone;
      candidate_end := (day_value + local_window_end) at time zone organization_timezone;

      -- Nobody books two hours from now. This is the booking page's rule, not a
      -- fact about who is working, which is why it lives here rather than in
      -- `window_is_staffed`.
      if candidate_start < now() + interval '2 hours' then
        continue;
      end if;

      -- Business hours, dated overrides, closures, personal hours and time off,
      -- all decided in one place shared with the scheduler.
      if not (select private.window_is_staffed(target_organization_id, candidate_start, candidate_end)) then
        continue;
      end if;

      select count(*)::integer
      into available_technician_count
      from public.technicians as technician
      where technician.organization_id = target_organization_id
        and technician.is_active
        and (
          technician.skills = '{}'::text[]
          or technician.skills && array['general_service', 'diagnostics']::text[]
        )
        and not exists (
          select 1
          from public.blackout_periods as blackout
          where blackout.technician_id = technician.id
            and blackout.block_type in ('hard', 'private')
            and blackout.starts_at < candidate_end
            and blackout.ends_at > candidate_start
        )
        and (
          case
            when exists (
              select 1 from public.technician_date_hours as dated
              where dated.technician_id = technician.id and dated.on_date = day_value
            ) then exists (
              select 1 from public.technician_date_hours as dated
              where dated.technician_id = technician.id
                and dated.on_date = day_value
                and dated.starts_at <= local_window_start
                and dated.ends_at >= local_window_end
            )
            when exists (
              select 1 from public.technician_hours as hours
              where hours.technician_id = technician.id
            ) then exists (
              select 1 from public.technician_hours as hours
              where hours.technician_id = technician.id
                and hours.weekday = pg_catalog.date_part('dow', day_value)::smallint
                and hours.starts_at <= local_window_start
                and hours.ends_at >= local_window_end
            )
            else true
          end
        );

      if available_technician_count = 0 then
        continue;
      end if;

      select
        (
          select count(*)
          from public.jobs as job
          where job.organization_id = target_organization_id
            and job.archived_at is null
            and job.status in (
              'awaiting_payment', 'confirmed', 'needs_review', 'assigned',
              'en_route', 'arrived', 'in_progress', 'rescheduled'
            )
            and coalesce(job.arrival_window_start, job.scheduled_start) < candidate_end
            and coalesce(job.arrival_window_end, job.scheduled_end) > candidate_start
        )
        +
        (
          select count(*)
          from public.booking_requests as intake
          where intake.organization_id = target_organization_id
            and intake.status = 'awaiting_payment'
            and intake.expires_at > now()
            and intake.arrival_window_start < candidate_end
            and intake.arrival_window_end > candidate_start
        )
      into occupied_count;

      if occupied_count < available_technician_count then
        slot_start := candidate_start;
        slot_end := candidate_end;
        fee_cents := standard_fee;
        priority := 'standard';
        return next;
      end if;
    end loop;
  end loop;
end;
$function$;


-- ---------------------------------------------------------------------------
-- The texted and spoken bookings, asking the same question.
-- ---------------------------------------------------------------------------
--
-- `create_public_booking_intake` — the web booking page — has always re-checked
-- availability at the moment it writes, under an advisory lock, by calling
-- `list_public_booking_slots` back. `schedule_sms_booking_request` never did.
--
-- It takes an arrival window and creates the job. In the ordinary run the
-- window came from the slots the scheduler was offered, so it was fine; but
-- nothing stopped a window that had gone stale between the offer and the reply,
-- or one the model simply carried over from what a customer said. The result
-- would be a job on the calendar at a time nobody is working, which is exactly
-- the failure this is meant to prevent.
--
-- Rewritten in place rather than transcribed. The body is 6KB of customer
-- matching and property resolution that has nothing to do with this change, and
-- copying it here to add four lines is how a subtle difference gets introduced.
-- The anchor is asserted first, so a body that has moved on fails the migration
-- instead of silently not being patched.
do $patch$
declare
  definition text;
  anchor text := 'raise exception using errcode = ''22023'', message = ''The arrival window ends before it starts.'';'
    || chr(10) || '  end if;';
  guard text;
begin
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'schedule_sms_booking_request';

  if definition is null then
    raise exception 'schedule_sms_booking_request is missing';
  end if;

  -- Already patched: nothing to do, and this migration stays re-runnable.
  if position('window_is_staffed' in definition) > 0 then
    return;
  end if;

  if position(anchor in definition) = 0 then
    raise exception 'schedule_sms_booking_request has changed shape; patch it by hand';
  end if;

  guard :=
    chr(10) || chr(10) ||
    '  -- Nobody is working then, so there is no job to create. The owner' || chr(10) ||
    '  -- scheduling by hand hits this too, which is the point: the answer is to' || chr(10) ||
    '  -- open the day or the hours, not to put somebody on a calendar that says' || chr(10) ||
    '  -- they are not there.' || chr(10) ||
    '  if window_start is not null' || chr(10) ||
    '    and not (select private.window_is_staffed(request.organization_id, window_start, window_end)) then' || chr(10) ||
    '    raise exception using errcode = ''23P01'',' || chr(10) ||
    '      message = ''Nobody is working then. Change the hours for that day, or pick another time.'';' || chr(10) ||
    '  end if;';

  execute replace(definition, anchor, anchor || guard);
end
$patch$;
