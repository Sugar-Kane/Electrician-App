-- One table for "a customer asked for work", whoever they asked through.
--
-- There were two. `sms_booking_requests` held bookings taken by text — and,
-- since the voice-calls migration, bookings taken by phone as well, because
-- `voice_calls.booking_request_id` points here. The name has been wrong for a
-- while: it is the inbound-request table, not the SMS table.
--
-- `booking_intakes` held bookings taken through the public web page, with its
-- own thirty-minute checkout hold and its own status words. Nothing in the
-- application ever read it directly — it is reached only through SECURITY
-- DEFINER functions — which is what makes it safe to fold in: the blast radius
-- is SQL, not React.
--
-- The two disagreed about everything they shared. A name was `contact_name`
-- here and `first_name`/`last_name` there; the problem was `description` here
-- and `customer_description` there; money taken up front was `deposit_cents`
-- here and `diagnostic_fee_cents` there. Two vocabularies for one idea is how
-- the dashboard came to count one of them and not the other.

alter table public.sms_booking_requests rename to booking_requests;

-- Where the request came from. Not derived from which columns are filled in:
-- a web booking with no address and a text booking with no address look
-- identical, and the difference decides what the customer has been told.
alter table public.booking_requests
  add column if not exists source text not null default 'sms'
    check (source in ('sms', 'voice', 'web', 'owner'));

comment on column public.booking_requests.source is
  'How the customer asked: by text, by phone, through the booking page, or typed in by the business.';

-- Voice bookings have always landed in this table; they were never labelled.
update public.booking_requests r
set source = 'voice'
where exists (select 1 from public.voice_calls v where v.booking_request_id = r.id);

-- The columns the web booking page needs and this table did not have. Nullable
-- to a fault: a text booking knows a phone number and little else, and a NOT
-- NULL here would stop the SMS path writing a row at all.
alter table public.booking_requests
  add column if not exists customer_type text
    check (customer_type is null or customer_type in ('residential', 'commercial')),
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists address_line_2 text,
  add column if not exists access_notes text,
  add column if not exists category text,
  add column if not exists priority text
    check (priority is null or priority in ('standard', 'emergency', 'after_hours')),
  add column if not exists safety_answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(safety_answers) = 'object'),
  add column if not exists safety_outcome text
    check (safety_outcome is null or safety_outcome in
      ('standard', 'urgent_review', 'emergency_services', 'utility_referral')),
  add column if not exists service_area_status text
    check (service_area_status is null or service_area_status in ('inside', 'outside', 'unverified')),
  add column if not exists service_distance_miles numeric(8, 1),
  add column if not exists property_id uuid references public.properties (id) on delete set null,
  -- The consent ledger the sending path reads. Carried across verbatim: these
  -- answer "prove they agreed to be texted", and a reconciliation that lost
  -- them would be a compliance problem, not a tidy-up.
  add column if not exists transactional_contact_consent boolean not null default false,
  add column if not exists consented_at timestamptz,
  add column if not exists sms_consent boolean not null default false,
  add column if not exists sms_consent_at timestamptz,
  add column if not exists sms_consent_source text,
  add column if not exists sms_consent_disclosure text,
  add column if not exists stripe_payment_intent_id text,
  -- The web page holds a slot for thirty minutes while the customer pays.
  -- Null on every other source, which hold nothing.
  add column if not exists expires_at timestamptz;

-- The two status vocabularies, unioned rather than translated. confirmed and
-- scheduled are the same state under two names, as are canceled and dismissed;
-- they are kept apart here so the live web booking functions keep working, and
-- unifying them is a follow-up rather than part of a rename.
alter table public.booking_requests drop constraint if exists sms_booking_requests_status_check;
alter table public.booking_requests drop constraint if exists booking_requests_status_check;
alter table public.booking_requests
  add constraint booking_requests_status_check check (status in (
    'new', 'needs_review', 'awaiting_payment', 'safety_escalated',
    'confirmed', 'scheduled', 'dismissed', 'canceled', 'expired'
  ));

-- Owner-entered work is a booking the business made on the customer's behalf,
-- so it arrives already decided and must never be able to arrive as open.
alter table public.booking_requests drop constraint if exists booking_requests_owner_is_resolved;
alter table public.booking_requests
  add constraint booking_requests_owner_is_resolved check (
    source <> 'owner' or status in ('scheduled', 'confirmed', 'dismissed', 'canceled')
  );

create index if not exists booking_requests_source_idx
  on public.booking_requests (organization_id, source, created_at desc);

-- The one the dashboard runs on every load: what is still waiting on somebody.
drop index if exists public.booking_requests_open_idx;
create index booking_requests_open_idx
  on public.booking_requests (organization_id, status)
  where status in ('new', 'needs_review');

comment on table public.booking_requests is
  'Every request for work, whatever it came in through. Categorised by source, not by which columns happen to be filled in.';

-- ---------------------------------------------------------------------------
-- Functions.
--
-- PL/pgSQL keeps its body as text, so renaming a table does not update the
-- functions that read it — they simply start failing at runtime. These rewrite
-- the stored definitions in place rather than restating several thousand lines
-- of unchanged logic, which would be a far larger thing to review.
-- ---------------------------------------------------------------------------

do $outer$
declare fn record; new_def text;
begin
  for fn in
    select p.oid, p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%public.sms_booking_requests%'
  loop
    -- Only the qualified table reference. schedule_sms_booking_request is
    -- singular, so the function's own name is left alone.
    new_def := replace(pg_get_functiondef(fn.oid),
                       'public.sms_booking_requests', 'public.booking_requests');
    execute new_def;
  end loop;
end $outer$;

do $outer$
declare fn record; new_def text;
begin
  for fn in
    select p.oid, p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname in ('attach_public_booking_checkout','expire_public_booking_checkout',
                        'get_public_booking_confirmation','list_public_booking_slots',
                        'confirm_public_booking_payment')
      and pg_get_functiondef(p.oid) like '%public.booking_intakes%'
  loop
    new_def := pg_get_functiondef(fn.oid);
    new_def := replace(new_def, 'public.booking_intakes', 'public.booking_requests');
    -- Columns carrying the same meaning under a different name.
    new_def := replace(new_def, 'stripe_checkout_session_id', 'deposit_checkout_session_id');
    new_def := replace(new_def, 'diagnostic_fee_cents', 'deposit_cents');
    new_def := replace(new_def, 'converted_job_id', 'created_job_id');
    new_def := replace(new_def, 'converted_customer_id', 'customer_id');
    new_def := replace(new_def, 'converted_property_id', 'property_id');
    new_def := replace(new_def, 'customer_description', 'description');
    execute new_def;
  end loop;
end $outer$;

-- The rename above is deliberately blunt, and it reached one place it should
-- not have: service_settings has a diagnostic_fee_cents column of its own,
-- which is the fee the business charges and was never renamed. Only the
-- booking row's copy of the amount became deposit_cents.
do $outer$
declare fn record;
begin
  for fn in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ilike '%settings.deposit_cents%'
  loop
    execute replace(pg_get_functiondef(fn.oid),
                    'settings.deposit_cents', 'settings.diagnostic_fee_cents');
  end loop;
end $outer$;

-- A payment recorded against a booking pointed at booking_intakes, which is
-- about to stop existing. The column keeps its meaning and loses the old
-- table's name with it.
alter table public.payments drop constraint if exists payments_booking_intake_id_fkey;
alter table public.payments rename column booking_intake_id to booking_request_id;
alter table public.payments
  add constraint payments_booking_request_id_fkey
  foreign key (booking_request_id) references public.booking_requests (id) on delete set null;

comment on column public.payments.booking_request_id is
  'The request this payment settled, whatever source it came in through.';

-- confirm_public_booking_payment needs three fixes the blunt rename could not
-- make, all found by running the paid booking flow end to end rather than by
-- reading it.
do $outer$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'confirm_public_booking_payment';

  -- 1. The jobs table was never renamed, and the rename reached into its
  --    insert. Jobs still has customer_description and diagnostic_fee_cents.
  d := replace(d, '    description, ai_summary, safety_flags, scheduled_start,',
                  '    customer_description, ai_summary, safety_flags, scheduled_start,');
  d := replace(d, 'arrival_window_end, deposit_cents,' || chr(10) || '    diagnostic_paid',
                  'arrival_window_end, diagnostic_fee_cents,' || chr(10) || '    diagnostic_paid');

  -- 2. `converted_property_id = property_id` was unambiguous. `property_id =
  --    property_id` is not: the right-hand side resolves to the column, so the
  --    update set it to itself and lost the property on every paid booking.
  d := replace(d, '  property_id uuid;', '  resolved_property_id uuid;');
  d := replace(d, 'select property.id into property_id', 'select property.id into resolved_property_id');
  d := replace(d, 'if property_id is null then', 'if resolved_property_id is null then');
  d := replace(d, ') returning id into property_id;', ') returning id into resolved_property_id;');
  d := replace(d, 'matched_customer_id, property_id, ''confirmed''',
                  'matched_customer_id, resolved_property_id, ''confirmed''');
  d := replace(d, 'property_id = property_id,', 'property_id = resolved_property_id,');

  -- 3. The payments column renamed above.
  d := replace(d, 'booking_intake_id', 'booking_request_id');

  execute d;
end $outer$;
