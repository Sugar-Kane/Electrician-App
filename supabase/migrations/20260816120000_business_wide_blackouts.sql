-- Closing the whole business for a day.
--
-- `technician_id` was not null, so every blackout had to name somebody. Shutting
-- for Christmas meant adding a row per electrician and remembering to add
-- another the day a new one joins — and the day somebody forgot, the booking
-- page would cheerfully sell an appointment on a public holiday.
--
-- Null now means the business, not a missing value. That reading only works
-- because there was no other way to get a null in this column: it has been not
-- null since the table was created, so no existing row is ambiguous.
alter table public.blackout_periods
  alter column technician_id drop not null;

-- The per-technician index does not serve these rows, because they have no
-- technician to look up by.
create index if not exists blackout_periods_business_wide_idx
  on public.blackout_periods (organization_id, starts_at, ends_at)
  where technician_id is null;

-- Teach the booking page to respect them.
--
-- The check goes at the window, before anybody is counted. A business-wide
-- closure is not "everybody happens to be busy" — there is no arithmetic that
-- makes a slot on a closed day bookable, so the loop skips it outright rather
-- than filtering it down to zero available electricians.
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
  organization_business_hours jsonb;
  standard_fee integer;
  day_value date;
  day_key text;
  day_config jsonb;
  business_start time;
  business_end time;
  local_window_start time;
  local_window_end time;
  candidate_start timestamptz;
  candidate_end timestamptz;
  candidate_weekday smallint;
  available_technician_count integer;
  occupied_count integer;
begin
  if p_days not between 1 and 31
    or p_from_date < current_date
    or p_from_date > current_date + 31 then
    return;
  end if;

  select organization.id, organization.timezone, settings.business_hours,
    settings.diagnostic_fee_cents
  into target_organization_id, organization_timezone, organization_business_hours,
    standard_fee
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
    day_key := lower(pg_catalog.to_char(day_value, 'FMDay'));
    day_config := organization_business_hours -> day_key;

    if day_config is null or coalesce((day_config ->> 'enabled')::boolean, false) is false then
      continue;
    end if;

    begin
      business_start := (day_config ->> 'start')::time;
      business_end := (day_config ->> 'end')::time;
    exception when others then
      continue;
    end;

    -- `date_part`, not `extract`. `extract(dow from ...)` is special syntax
    -- rather than an ordinary call, so it cannot be schema-qualified — and this
    -- function runs with an empty search_path, where everything must be.
    candidate_weekday := pg_catalog.date_part('dow', day_value)::smallint;

    for local_window_start, local_window_end in
      select window_start, window_end
      from (values
        (time '08:00', time '10:00'),
        (time '10:00', time '12:00'),
        (time '13:00', time '15:00'),
        (time '15:00', time '17:00')
      ) as windows(window_start, window_end)
    loop
      if local_window_start < business_start or local_window_end > business_end then
        continue;
      end if;

      candidate_start := (day_value + local_window_start) at time zone organization_timezone;
      candidate_end := (day_value + local_window_end) at time zone organization_timezone;

      if candidate_start < now() + interval '2 hours' then
        continue;
      end if;

      -- Closed. Nobody is offered, however many electricians are free.
      if exists (
        select 1
        from public.blackout_periods as closure
        where closure.organization_id = target_organization_id
          and closure.technician_id is null
          and closure.block_type in ('hard', 'private')
          and closure.starts_at < candidate_end
          and closure.ends_at > candidate_start
      ) then
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
          -- No hours set: available whenever the business is open, which is
          -- what every existing row means today.
          not exists (
            select 1
            from public.technician_hours as hours
            where hours.technician_id = technician.id
          )
          or exists (
            select 1
            from public.technician_hours as hours
            where hours.technician_id = technician.id
              and hours.weekday = candidate_weekday
              and hours.starts_at <= local_window_start
              and hours.ends_at >= local_window_end
          )
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
