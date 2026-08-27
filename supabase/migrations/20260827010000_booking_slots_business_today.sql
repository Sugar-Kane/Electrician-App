-- The receptionist could not book anything after five in the afternoon.
--
-- `list_public_booking_slots` refused any `p_from_date` earlier than
-- `current_date` — the *server's* date, which is UTC. The AI intake passes the
-- *business's* date, deliberately, with a comment in `intake-shared.ts` warning
-- about exactly this hazard. From 5pm Pacific until midnight those two dates
-- disagree, so the guard rejected and the function returned nothing at all.
--
-- Measured on 2026-08-27 at 00:47 UTC, one minute after a real call that could
-- not be booked: asking from the business's date gave 0 slots, asking from
-- UTC's gave 39. Seven hours a day, eight once the clocks change, and precisely
-- the hours when somebody who has been at work all day rings an electrician.
--
-- The public booking page had the same bug pointing the other way: it passed
-- the UTC date, cleared the guard, and silently dropped the rest of the working
-- day every evening.
--
-- One cause under both. The function took a date and had no idea what timezone
-- it was in, so its guard used the server's. Now the function decides "today"
-- itself, in the timezone it already looks up, and both callers pass null.

create or replace function public.list_public_booking_slots(
  p_slug text,
  p_from_date date default null,
  p_days integer default 14
)
returns table(
  slot_start timestamp with time zone,
  slot_end timestamp with time zone,
  fee_cents integer,
  priority text
)
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  target_organization_id uuid;
  organization_timezone text;
  standard_fee integer;
  business_today date;
  first_day date;
  day_value date;
  local_window_start time;
  local_window_end time;
  candidate_start timestamptz;
  candidate_end timestamptz;
  available_technician_count integer;
  occupied_count integer;
begin
  if p_days not between 1 and 31 then
    return;
  end if;

  /*
   * The business first, because the guard below cannot be written without
   * knowing the timezone. This lookup used to sit under the guard, which is how
   * the guard ended up measuring against UTC.
   */
  select organization.id, organization.timezone, settings.diagnostic_fee_cents
  into target_organization_id, organization_timezone, standard_fee
  from public.organizations as organization
  join public.service_settings as settings
    on settings.organization_id = organization.id
  where organization.slug = pg_catalog.lower(pg_catalog.btrim(p_slug))
    and organization.archived_at is null
    and organization.base_postal_code is not null
  limit 1;

  if target_organization_id is null then
    return;
  end if;

  -- The only "today" this function recognises. A caller that computes its own
  -- is a caller that can disagree with it, which is the whole bug.
  business_today := (pg_catalog.now() at time zone organization_timezone)::date;
  first_day := coalesce(p_from_date, business_today);

  -- Still refuses a nonsense range; it just stops reading the wrong clock. A
  -- caller asking for last month, or for next year, gets nothing as before.
  if first_day < business_today or first_day > business_today + 31 then
    return;
  end if;

  for day_value in
    select generated_day::date
    from pg_catalog.generate_series(
      first_day::timestamp,
      (first_day + (p_days - 1))::timestamp,
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
      -- `window_is_staffed`. It is also what makes a call at eleven at night
      -- safe: tomorrow morning is nine hours out and clears this easily, while
      -- the rest of tonight does not.
      if candidate_start < pg_catalog.now() + interval '2 hours' then
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
            and intake.expires_at > pg_catalog.now()
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

/*
 * One live callback per customer.
 *
 * `booking_requests_one_live_slot_idx` is partial on `arrival_window_start is
 * not null`, so a callback — which has no window — sits outside it. The same
 * client fan-out that produced thirteen bookings would produce thirteen
 * callbacks, and thirteen texts to the owner once callbacks start alerting
 * anybody at all.
 *
 * Two open callbacks for one customer is never useful: the second tells nobody
 * anything the first did not. Once it is handled or dismissed the customer can
 * of course ask again.
 */
create unique index if not exists booking_requests_one_live_callback_idx
  on public.booking_requests (organization_id, customer_id)
  where intent = 'callback'
    and status in ('new', 'needs_review');
