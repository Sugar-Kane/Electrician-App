-- The diagnostic visit is $180 and two hours.
--
-- It was $100 and one hour, set in four places that had to agree: the column
-- default on `service_settings`, the same default copied onto `jobs` and
-- `booking_requests`, a handful of `coalesce(..., 10000)` fallbacks inside the
-- booking functions, and the pilot copy on the onboarding screen. The
-- TypeScript side is changed in the same commit.
--
-- Historic rows are deliberately left alone. A job already done at $100 was
-- done at $100, and a customer already quoted $100 is owed that price — moving
-- either would be rewriting a record rather than changing a setting.

-- ---------------------------------------------------------------------------
-- Defaults.
-- ---------------------------------------------------------------------------

alter table public.service_settings
  alter column diagnostic_fee_cents set default 18000;

alter table public.service_settings
  alter column diagnostic_minutes set default 120;

alter table public.jobs
  alter column diagnostic_fee_cents set default 18000;

-- Not `booking_requests`. It descends from `sms_booking_requests`, which never
-- had a fee column — the one in the 2026-08-04 migration belonged to
-- `booking_intakes`, a different table that this one replaced. What it carries
-- is `deposit_cents`, and that is written per booking from the settings above
-- rather than defaulted.

-- ---------------------------------------------------------------------------
-- The settings every business is actually running on.
--
-- Only rows still sitting on the old default move. There is no UI for the fee
-- yet, so in practice that is all of them — but a business that had been given
-- a different figure by hand keeps it, which is what makes this safe to run
-- again later.
-- ---------------------------------------------------------------------------

update public.service_settings
  set diagnostic_fee_cents = 18000
  where diagnostic_fee_cents = 10000;

update public.service_settings
  set diagnostic_minutes = 120
  where diagnostic_minutes = 60;

-- ---------------------------------------------------------------------------
-- The fallbacks inside the booking functions.
--
-- These only fire for an organization with no `service_settings` row at all,
-- but they are the number the app would quote in that state, and one of them
-- was worse than stale: `coalesce(settings.diagnostic_fee_cents, 0)` in
-- `schedule_sms_booking_request` wrote a *free* diagnostic where every other
-- path wrote $100.
--
-- Rewritten in place rather than restated, the same way the one-booking-table
-- migration rewrote every function that named the old table. A function body is
-- stored as text, so this edits exactly the constant and leaves several hundred
-- lines of unchanged logic out of the diff.
-- ---------------------------------------------------------------------------

do $outer$
declare
  fn record;
  new_def text;
  touched integer := 0;
begin
  for fn in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind = 'f'
      and (
        pg_get_functiondef(p.oid) like '%settings.diagnostic_fee_cents, 10000%'
        or pg_get_functiondef(p.oid) like '%settings.diagnostic_fee_cents, 0)%'
        or pg_get_functiondef(p.oid) like '%settings.diagnostic_minutes, 60%'
      )
  loop
    new_def := pg_get_functiondef(fn.oid);
    new_def := replace(new_def, 'settings.diagnostic_fee_cents, 10000',
                                'settings.diagnostic_fee_cents, 18000');
    new_def := replace(new_def, 'settings.diagnostic_fee_cents, 0)',
                                'settings.diagnostic_fee_cents, 18000)');
    new_def := replace(new_def, 'settings.diagnostic_minutes, 60',
                                'settings.diagnostic_minutes, 120');
    execute new_def;
    touched := touched + 1;
  end loop;

  -- Said out loud rather than passing quietly. If the constants have moved,
  -- this migration did nothing and the old figure is still in the database,
  -- which is the one outcome that must not look like success.
  if touched = 0 then
    raise exception
      'no booking function carried a $100 or 60-minute fallback — check whether they were already rewritten';
  end if;

  raise notice 'rewrote % booking function(s) onto the $180 two-hour diagnostic', touched;
end $outer$;
