-- Deferred diagnostic payments.
--
-- California (and, until reviewed, any business with no operating jurisdiction
-- set) never collects a diagnostic fee before the contracted diagnostic service
-- is completed (B&P §§ 7159.5, 7159.10, 7159.14). Booking saves a payment method
-- through a Stripe SetupIntent with the customer's explicit authorization; the
-- fee is charged off-session only once the diagnostic is documented complete.
--
-- The rules are written in src/lib/diagnostic-payment-policy.ts and enforced
-- again here, where money moves, so no path (web, SMS, voice, MCP, a hand-made
-- API call) can take an advance payment or charge more than was authorized.
--
-- Nothing in here refunds, re-charges or alters an existing payment.

------------------------------------------------------------------------------
-- 1. Contractor settings (Diagnostic Payment Settings)
------------------------------------------------------------------------------

alter table public.service_settings
  add column if not exists diagnostic_jurisdiction text,
  add column if not exists diagnostic_collect_at text not null default 'after_completion',
  add column if not exists require_payment_method_at_booking boolean not null default true,
  add column if not exists auto_collect_diagnostic boolean not null default true,
  add column if not exists allow_manual_diagnostic_payment boolean not null default true,
  add column if not exists send_payment_method_reminders boolean not null default true,
  add column if not exists send_failed_payment_notices boolean not null default true,
  add column if not exists diagnostic_service_description text;

alter table public.service_settings
  drop constraint if exists service_settings_diagnostic_jurisdiction_check,
  add constraint service_settings_diagnostic_jurisdiction_check
    check (diagnostic_jurisdiction is null or diagnostic_jurisdiction ~ '^[A-Z]{2}$'),
  drop constraint if exists service_settings_diagnostic_collect_at_check,
  add constraint service_settings_diagnostic_collect_at_check
    check (diagnostic_collect_at in ('after_completion', 'at_booking')),
  drop constraint if exists service_settings_diagnostic_service_description_check,
  add constraint service_settings_diagnostic_service_description_check
    check (diagnostic_service_description is null or char_length(diagnostic_service_description) <= 300);

-- The jurisdiction a business's diagnostic rules follow: its own setting, else
-- the state of its base address. Empty when neither is known.
create or replace function private.diagnostic_jurisdiction(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    nullif(settings.diagnostic_jurisdiction, ''),
    nullif(pg_catalog.upper(pg_catalog.btrim(organization.base_state)), ''),
    ''
  )
  from public.organizations as organization
  left join public.service_settings as settings on settings.organization_id = organization.id
  where organization.id = p_organization_id;
$$;

-- Whether this business's diagnostic fee waits for completion. True for
-- California and for an unknown jurisdiction whatever the contractor chose.
create or replace function private.diagnostic_collects_after_completion(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (select private.diagnostic_jurisdiction(p_organization_id)) in ('CA', '')
      or settings.diagnostic_collect_at is distinct from 'at_booking',
    true
  )
  from (select 1) as one
  left join public.service_settings as settings on settings.organization_id = p_organization_id;
$$;

-- A contractor cannot switch a legally required safeguard off: California (or
-- no jurisdiction) refuses upfront diagnostic collection outright.
create or replace function private.guard_diagnostic_payment_settings()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  effective text;
begin
  if new.diagnostic_collect_at = 'at_booking' then
    select coalesce(
      nullif(new.diagnostic_jurisdiction, ''),
      nullif(pg_catalog.upper(pg_catalog.btrim(organization.base_state)), ''),
      ''
    ) into effective
    from public.organizations as organization
    where organization.id = new.organization_id;

    if coalesce(effective, '') in ('CA', '') then
      raise exception using errcode = '23514',
        message = 'California requires the diagnostic fee to be collected after the contracted diagnostic service is completed. Upfront collection cannot be turned on.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_diagnostic_payment_settings on public.service_settings;
create trigger guard_diagnostic_payment_settings
  before insert or update of diagnostic_collect_at, diagnostic_jurisdiction on public.service_settings
  for each row execute function private.guard_diagnostic_payment_settings();

------------------------------------------------------------------------------
-- 2. Diagnostic completion, separate from the job's operational status
------------------------------------------------------------------------------

alter table public.jobs
  add column if not exists diagnostic_completed_at timestamptz,
  add column if not exists diagnostic_completed_by uuid references auth.users(id) on delete set null,
  add column if not exists diagnostic_findings text,
  add column if not exists diagnostic_outcome text,
  add column if not exists diagnostic_repair_contract text;

alter table public.jobs
  drop constraint if exists jobs_diagnostic_outcome_check,
  add constraint jobs_diagnostic_outcome_check
    check (diagnostic_outcome is null or diagnostic_outcome in ('diagnostic_only', 'fix_now', 'schedule_later')),
  drop constraint if exists jobs_diagnostic_repair_contract_check,
  add constraint jobs_diagnostic_repair_contract_check
    check (diagnostic_repair_contract is null or diagnostic_repair_contract in ('none', 'separate', 'same_contract', 'undetermined')),
  drop constraint if exists jobs_diagnostic_findings_check,
  add constraint jobs_diagnostic_findings_check
    check (diagnostic_findings is null or char_length(diagnostic_findings) <= 4000),
  drop constraint if exists jobs_diagnostic_completion_check,
  add constraint jobs_diagnostic_completion_check
    check (diagnostic_completed_at is null or (diagnostic_outcome is not null and diagnostic_repair_contract is not null and char_length(coalesce(diagnostic_findings, '')) >= 15));

create index if not exists jobs_diagnostic_completed_by_idx on public.jobs (diagnostic_completed_by) where diagnostic_completed_by is not null;

-- Completion is recorded only through complete_diagnostic_service, which
-- checks who is asking. Signed-in members keep every other column they had.
-- (A column-level REVOKE does nothing while the table-wide UPDATE grant
-- stands, which the scenario test DD-035 caught, so this is a trigger.)
create or replace function private.guard_diagnostic_completion()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.diagnostic_completed_at, new.diagnostic_completed_by, new.diagnostic_findings,
          new.diagnostic_outcome, new.diagnostic_repair_contract)
       is distinct from
         (old.diagnostic_completed_at, old.diagnostic_completed_by, old.diagnostic_findings,
          old.diagnostic_outcome, old.diagnostic_repair_contract) then
    raise exception using errcode = '42501',
      message = 'Diagnostic completion is recorded with Complete diagnostic, not edited directly.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_diagnostic_completion on public.jobs;
create trigger guard_diagnostic_completion
  before update on public.jobs
  for each row execute function private.guard_diagnostic_completion();
revoke all on function private.guard_diagnostic_completion() from public, anon, authenticated;

------------------------------------------------------------------------------
-- 3. Payment-method authorizations and the charges made against them
------------------------------------------------------------------------------

create table if not exists public.diagnostic_payment_authorizations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_request_id uuid references public.booking_requests(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd' check (currency = 'usd'),
  state text not null default 'setup_pending' check (state in (
    'setup_pending', 'payment_method_saved', 'processing', 'succeeded', 'failed',
    'requires_action', 'revoked', 'cancelled', 'expired', 'refunded'
  )),
  agreement_version text not null check (char_length(agreement_version) between 1 and 40),
  agreement_text text not null check (char_length(agreement_text) between 20 and 2000),
  agreement_fingerprint text not null check (agreement_fingerprint ~ '^[0-9a-f]{8}$'),
  language text not null default 'en' check (language in ('en', 'es')),
  accepted_via text not null check (accepted_via in ('web', 'sms', 'voice', 'portal')),
  accepted_at timestamptz not null default now(),
  accepted_ip text check (accepted_ip is null or char_length(accepted_ip) <= 64),
  accepted_user_agent text check (accepted_user_agent is null or char_length(accepted_user_agent) <= 400),
  stripe_account_id text check (stripe_account_id is null or stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  stripe_customer_id text check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_checkout_session_id text check (stripe_checkout_session_id is null or stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  stripe_setup_intent_id text check (stripe_setup_intent_id is null or stripe_setup_intent_id ~ '^seti_[A-Za-z0-9]+$'),
  stripe_payment_method_id text check (stripe_payment_method_id is null or stripe_payment_method_id ~ '^pm_[A-Za-z0-9]+$'),
  -- Display metadata Stripe returns. Never a card number, expiry or CVC.
  payment_method_brand text check (payment_method_brand is null or char_length(payment_method_brand) <= 30),
  payment_method_last4 text check (payment_method_last4 is null or payment_method_last4 ~ '^[0-9]{4}$'),
  setup_completed_at timestamptz,
  revoked_at timestamptz,
  cancelled_at timestamptz,
  last_failure_code text check (last_failure_code is null or char_length(last_failure_code) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint diagnostic_authorization_saved_has_method check (
    state not in ('payment_method_saved', 'processing', 'succeeded')
    or stripe_payment_method_id is not null
    or state = 'succeeded'
  )
);

create unique index if not exists diagnostic_authorizations_setup_intent_key
  on public.diagnostic_payment_authorizations (stripe_setup_intent_id) where stripe_setup_intent_id is not null;
create unique index if not exists diagnostic_authorizations_checkout_key
  on public.diagnostic_payment_authorizations (stripe_checkout_session_id) where stripe_checkout_session_id is not null;
-- One live authorization per booking.
create unique index if not exists diagnostic_authorizations_one_live_per_booking
  on public.diagnostic_payment_authorizations (booking_request_id)
  where booking_request_id is not null and state not in ('revoked', 'cancelled', 'expired');
create index if not exists diagnostic_authorizations_org_idx on public.diagnostic_payment_authorizations (organization_id, created_at desc);
create index if not exists diagnostic_authorizations_job_idx on public.diagnostic_payment_authorizations (job_id) where job_id is not null;
create index if not exists diagnostic_authorizations_customer_idx on public.diagnostic_payment_authorizations (customer_id) where customer_id is not null;
create index if not exists diagnostic_authorizations_pm_idx on public.diagnostic_payment_authorizations (stripe_payment_method_id) where stripe_payment_method_id is not null;

create table if not exists public.diagnostic_charges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  authorization_id uuid not null references public.diagnostic_payment_authorizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd' check (currency = 'usd'),
  status text not null default 'processing' check (status in ('processing', 'succeeded', 'failed', 'requires_action', 'canceled')),
  via text not null check (via in ('app', 'mcp', 'auto', 'recovery')),
  initiated_by uuid references auth.users(id) on delete set null,
  idempotency_key text not null unique,
  stripe_payment_intent_id text unique check (stripe_payment_intent_id is null or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
  stripe_checkout_session_id text unique check (stripe_checkout_session_id is null or stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  failure_code text check (failure_code is null or char_length(failure_code) <= 80),
  failure_message text check (failure_message is null or char_length(failure_message) <= 300),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The database-level guard against a double charge: one live or successful
-- charge per authorization, however many requests race for it.
create unique index if not exists diagnostic_charges_one_live_per_authorization
  on public.diagnostic_charges (authorization_id) where status in ('processing', 'succeeded');
create index if not exists diagnostic_charges_org_idx on public.diagnostic_charges (organization_id, created_at desc);
create index if not exists diagnostic_charges_job_idx on public.diagnostic_charges (job_id);
create index if not exists diagnostic_charges_initiated_by_idx on public.diagnostic_charges (initiated_by) where initiated_by is not null;

do $$
declare
  t text;
begin
  foreach t in array array['diagnostic_payment_authorizations', 'diagnostic_charges'] loop
    execute pg_catalog.format('drop trigger if exists set_%1$s_updated_at on public.%1$I', t);
    execute pg_catalog.format('create trigger set_%1$s_updated_at before update on public.%1$I for each row execute function public.set_updated_at()', t);
    execute pg_catalog.format('drop trigger if exists zz_tenant_owner_immutable on public.%1$I', t);
    execute pg_catalog.format('create trigger zz_tenant_owner_immutable before update of organization_id on public.%1$I for each row execute function private.keep_tenant_owner()', t);
    execute pg_catalog.format('alter table public.%1$I enable row level security', t);
    execute pg_catalog.format('revoke all on public.%1$I from public, anon, authenticated', t);
    execute pg_catalog.format('grant select on public.%1$I to authenticated', t);
    execute pg_catalog.format('grant all on public.%1$I to service_role', t);
  end loop;
end
$$;

drop trigger if exists zz_tenant_references_guard on public.diagnostic_payment_authorizations;
create trigger zz_tenant_references_guard
  before insert or update on public.diagnostic_payment_authorizations
  for each row execute function private.guard_tenant_references('booking_request_id', 'booking_requests', 'job_id', 'jobs', 'customer_id', 'customers');
drop trigger if exists zz_tenant_references_guard on public.diagnostic_charges;
create trigger zz_tenant_references_guard
  before insert or update on public.diagnostic_charges
  for each row execute function private.guard_tenant_references('authorization_id', 'diagnostic_payment_authorizations', 'job_id', 'jobs');

-- Members read their own business's rows. Nobody signed in writes them: every
-- change goes through the functions below, run by server code.
drop policy if exists "Members view diagnostic payment authorizations" on public.diagnostic_payment_authorizations;
create policy "Members view diagnostic payment authorizations" on public.diagnostic_payment_authorizations
  for select to authenticated
  using ((select private.is_org_member(organization_id)));
drop policy if exists "Members view diagnostic charges" on public.diagnostic_charges;
create policy "Members view diagnostic charges" on public.diagnostic_charges
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

------------------------------------------------------------------------------
-- 4. Payments recorded from an off-session PaymentIntent have no Checkout
------------------------------------------------------------------------------

alter table public.payments alter column provider_checkout_session_id drop not null;
alter table public.payments
  drop constraint if exists payments_provider_reference_check,
  add constraint payments_provider_reference_check
    check (provider_checkout_session_id is not null or provider_payment_intent_id is not null);
create index if not exists payments_provider_payment_intent_idx
  on public.payments (provider_payment_intent_id) where provider_payment_intent_id is not null;

------------------------------------------------------------------------------
-- 5. Stripe Customer mapping: written only by server code
------------------------------------------------------------------------------

-- The table was writable by any member, so a member could point their customer
-- at another business's Stripe Customer. Payment-method ownership is checked
-- against it, so it is now service-role only (like stripe_connect_accounts).
drop policy if exists "Organization members can add Stripe customers" on public.stripe_customers;
drop policy if exists "Organization members can update Stripe customers" on public.stripe_customers;
drop policy if exists "Organization members can remove Stripe customers" on public.stripe_customers;
revoke insert, update, delete, truncate on public.stripe_customers from public, anon, authenticated;
grant select on public.stripe_customers to authenticated;

------------------------------------------------------------------------------
-- 6. Booking a confirmed intake as a job (shared by paid and setup bookings)
------------------------------------------------------------------------------

-- Lifted out of confirm_public_booking_payment unchanged so a booking whose
-- payment method was saved is scheduled exactly like one that paid. The only
-- difference is p_diagnostic_paid: a deferred booking's fee is not paid yet.
create or replace function private.book_confirmed_intake(
  p_intake_id uuid,
  p_at timestamptz,
  p_diagnostic_paid boolean,
  out o_job_id uuid,
  out o_customer_id uuid,
  out o_property_id uuid,
  out o_failure text
)
language plpgsql
security definer
set search_path to ''
as $$
declare
  intake public.booking_requests%rowtype;
  settings public.service_settings%rowtype;
  resolved_state text;
begin
  select * into intake from public.booking_requests where id = p_intake_id;
  select * into settings from public.service_settings where organization_id = intake.organization_id;

  if intake.arrival_window_start is not null
     and intake.arrival_window_start <= coalesce(p_at, pg_catalog.now()) then
    o_failure := 'confirmed after the appointment time had started';
    return;
  end if;

  if intake.source in ('sms', 'voice') then
    begin
      o_job_id := public.schedule_sms_booking_request(intake.id);
    exception when others then
      o_failure := pg_catalog.left(coalesce(sqlerrm, 'could not be scheduled'), 300);
      o_job_id := null;
    end;

    if o_job_id is not null then
      update public.jobs
      set diagnostic_paid = p_diagnostic_paid,
          diagnostic_fee_cents = intake.deposit_cents
      where id = o_job_id;
    end if;
    return;
  end if;

  select coalesce(nullif(pg_catalog.btrim(intake.state), ''), organization.base_state, '')
  into resolved_state
  from public.organizations as organization
  where organization.id = intake.organization_id;
  resolved_state := coalesce(resolved_state, nullif(pg_catalog.btrim(intake.state), ''), '');

  select customer.id into o_customer_id
  from public.customers as customer
  where customer.organization_id = intake.organization_id
    and customer.archived_at is null
    and (
      pg_catalog.lower(customer.email) = intake.email
      or pg_catalog.regexp_replace(coalesce(customer.phone, ''), '[^0-9]', '', 'g')
        = pg_catalog.regexp_replace(intake.phone, '[^0-9]', '', 'g')
    )
  order by customer.created_at
  limit 1;

  if o_customer_id is null then
    insert into public.customers (
      organization_id, customer_type, first_name, last_name, email, phone,
      preferred_contact, notes
    ) values (
      intake.organization_id, coalesce(intake.customer_type, 'residential'), intake.first_name,
      intake.last_name, intake.email, intake.phone,
      case when intake.sms_consent then 'sms' else 'phone' end,
      'Created from public diagnostic booking'
    ) returning id into o_customer_id;
  end if;

  if intake.sms_consent and pg_catalog.to_regclass('public.messaging_consent') is not null then
    insert into public.messaging_consent (
      organization_id, customer_id, channel, scope, opted_in_at, opted_out_at,
      source, proof_text
    ) values (
      intake.organization_id, o_customer_id, 'sms', 'transactional',
      coalesce(intake.sms_consent_at, pg_catalog.now()), null, 'booking_form',
      intake.sms_consent_disclosure
    )
    on conflict (customer_id, channel, scope) do update
    set opted_in_at = excluded.opted_in_at,
        opted_out_at = null,
        source = excluded.source,
        proof_text = excluded.proof_text
    where messaging_consent.opted_out_at is null
       or messaging_consent.opted_out_at < excluded.opted_in_at;
  end if;

  select property.id into o_property_id
  from public.properties as property
  where property.organization_id = intake.organization_id
    and property.customer_id = o_customer_id
    and property.archived_at is null
    and pg_catalog.lower(property.address_line_1) = pg_catalog.lower(intake.address_line_1)
    and pg_catalog.lower(property.city) = pg_catalog.lower(intake.city)
    and property.state = resolved_state
    and property.postal_code = intake.postal_code
  order by property.created_at
  limit 1;

  if o_property_id is null then
    insert into public.properties (
      organization_id, customer_id, address_line_1, address_line_2, city, state,
      postal_code, access_notes, safety_notes
    ) values (
      intake.organization_id, o_customer_id, intake.address_line_1,
      intake.address_line_2, intake.city, resolved_state, intake.postal_code,
      intake.access_notes,
      nullif(pg_catalog.array_to_string(intake.safety_flags, ', '), '')
    ) returning id into o_property_id;
  end if;

  insert into public.jobs (
    organization_id, customer_id, property_id, status, category, priority,
    customer_description, ai_summary, safety_flags, scheduled_start,
    scheduled_end, arrival_window_start, arrival_window_end, diagnostic_fee_cents,
    diagnostic_paid
  ) values (
    intake.organization_id, o_customer_id, o_property_id, 'confirmed',
    coalesce(nullif(intake.category, ''), 'diagnostic'),
    coalesce(intake.priority, 'standard'), intake.description, intake.description,
    coalesce(intake.safety_flags, '{}'::text[]), intake.arrival_window_start,
    intake.arrival_window_start + pg_catalog.make_interval(mins => coalesce(settings.diagnostic_minutes, 120)),
    intake.arrival_window_start, intake.arrival_window_end,
    intake.deposit_cents, p_diagnostic_paid
  ) returning id into o_job_id;
end;
$$;

revoke all on function private.book_confirmed_intake(uuid, timestamptz, boolean) from public, anon, authenticated;

-- The paid booking, as before, now through the shared scheduler. A Checkout
-- session that belongs to a payment-method authorization is never a payment.
create or replace function public.confirm_public_booking_payment(p_booking_token uuid, p_checkout_session_id text, p_payment_intent_id text, p_amount_cents integer, p_currency text, p_paid_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  intake public.booking_requests%rowtype;
  booked record;
begin
  select * into intake
  from public.booking_requests
  where public_token = p_booking_token
    and deposit_checkout_session_id = p_checkout_session_id
  for update;

  if intake.id is null then
    raise exception using errcode = 'P0002', message = 'Booking payment record not found.';
  end if;

  if intake.created_job_id is not null then
    return intake.created_job_id;
  end if;

  if intake.status = 'needs_review' and intake.deposit_paid_at is not null then
    return null;
  end if;

  if exists (
    select 1 from public.diagnostic_payment_authorizations
    where stripe_checkout_session_id = p_checkout_session_id
  ) then
    raise exception using errcode = '22023', message = 'That checkout saved a payment method; it is not a payment.';
  end if;

  if intake.status <> 'awaiting_payment'
    or p_amount_cents <> intake.deposit_cents
    or pg_catalog.lower(p_currency) <> 'usd' then
    raise exception using errcode = '22023', message = 'Booking payment does not match the intake.';
  end if;

  select * into booked from private.book_confirmed_intake(intake.id, coalesce(p_paid_at, pg_catalog.now()), true);

  insert into public.payments (
    organization_id, job_id, booking_request_id, provider_checkout_session_id,
    provider_payment_intent_id, status, amount_cents, currency, paid_at
  ) values (
    intake.organization_id, booked.o_job_id, intake.id, p_checkout_session_id,
    nullif(p_payment_intent_id, ''), 'succeeded', p_amount_cents,
    pg_catalog.lower(p_currency), coalesce(p_paid_at, pg_catalog.now())
  ) on conflict (provider_checkout_session_id) do nothing;

  if booked.o_job_id is null then
    update public.booking_requests
    set status = 'needs_review',
        deposit_paid_at = pg_catalog.now(),
        stripe_payment_intent_id = nullif(p_payment_intent_id, '')
    where id = intake.id;

    insert into public.activity_events (
      organization_id, event_type, label, booking_request_id, metadata
    ) values (
      intake.organization_id, 'booking.paid_but_unscheduled',
      'Paid, but the time could no longer be booked', intake.id,
      pg_catalog.jsonb_build_object(
        'amount_cents', p_amount_cents,
        'note', coalesce(pg_catalog.replace(booked.o_failure, 'confirmed after', 'paid after'), 'unknown')
      )
    );

    return null;
  end if;

  update public.booking_requests
  set status = case when intake.source in ('sms', 'voice') then 'scheduled' else 'confirmed' end,
      deposit_paid_at = pg_catalog.now(),
      stripe_payment_intent_id = nullif(p_payment_intent_id, ''),
      customer_id = coalesce(booked.o_customer_id, customer_id),
      property_id = coalesce(booked.o_property_id, property_id),
      created_job_id = booked.o_job_id
  where id = intake.id;

  insert into public.activity_events (
    organization_id, event_type, label, entity_type, entity_id, metadata,
    booking_request_id, job_id
  ) values (
    intake.organization_id, 'booking.payment_confirmed',
    'Diagnostic fee paid, appointment confirmed', 'job', booked.o_job_id,
    pg_catalog.jsonb_build_object('amount_cents', p_amount_cents, 'via', intake.source),
    intake.id, booked.o_job_id
  );

  return booked.o_job_id;
end;
$function$;

revoke all on function public.confirm_public_booking_payment(uuid, text, text, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.confirm_public_booking_payment(uuid, text, text, integer, text, timestamptz) to service_role;

------------------------------------------------------------------------------
-- 7. Recording the customer's authorization, before Stripe is involved
------------------------------------------------------------------------------

create or replace function public.record_diagnostic_authorization(
  p_booking_token uuid,
  p_via text,
  p_language text,
  p_agreement_text text,
  p_agreement_version text,
  p_agreement_fingerprint text,
  p_ip text default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  intake public.booking_requests%rowtype;
  existing public.diagnostic_payment_authorizations%rowtype;
  created uuid;
begin
  select * into intake from public.booking_requests where public_token = p_booking_token for update;
  if intake.id is null then
    raise exception using errcode = 'P0002', message = 'Booking not found.';
  end if;
  if intake.status <> 'awaiting_payment' then
    raise exception using errcode = '22023', message = 'This booking is not waiting for a payment method.';
  end if;
  if coalesce(intake.deposit_cents, 0) <= 0 then
    raise exception using errcode = '22023', message = 'This booking has no diagnostic fee to authorize.';
  end if;
  if not (select private.diagnostic_collects_after_completion(intake.organization_id)) then
    raise exception using errcode = '22023', message = 'This business collects its diagnostic fee at booking.';
  end if;

  -- The agreed amount is the quoted fee, frozen on the booking. The text
  -- must state it, so the record proves what the customer read.
  if pg_catalog.strpos(p_agreement_text, '$' || (intake.deposit_cents / 100)::text) = 0 then
    raise exception using errcode = '22023', message = 'The authorization text does not state the booked fee.';
  end if;

  select * into existing
  from public.diagnostic_payment_authorizations
  where booking_request_id = intake.id
    and state not in ('revoked', 'cancelled', 'expired')
  for update;

  if existing.id is not null then
    if existing.state = 'setup_pending'
       and (existing.amount_cents <> intake.deposit_cents or existing.agreement_fingerprint <> p_agreement_fingerprint) then
      update public.diagnostic_payment_authorizations
      set state = 'expired'
      where id = existing.id;
    else
      return existing.id;
    end if;
  end if;

  insert into public.diagnostic_payment_authorizations (
    organization_id, booking_request_id, customer_id, amount_cents, agreement_version,
    agreement_text, agreement_fingerprint, language, accepted_via, accepted_ip, accepted_user_agent
  ) values (
    intake.organization_id, intake.id, intake.customer_id, intake.deposit_cents, p_agreement_version,
    p_agreement_text, p_agreement_fingerprint,
    case when p_language = 'es' then 'es' else 'en' end,
    p_via, pg_catalog.left(p_ip, 64), pg_catalog.left(p_user_agent, 400)
  ) returning id into created;

  insert into public.activity_events (organization_id, event_type, label, booking_request_id, metadata)
  values (
    intake.organization_id, 'diagnostic.authorization_accepted',
    'Authorized saving a payment method; nothing charged', intake.id,
    pg_catalog.jsonb_build_object('amount_cents', intake.deposit_cents, 'via', p_via, 'version', p_agreement_version)
  );

  return created;
end;
$$;

-- Ties the authorization to the Stripe objects made for it, and to the booking.
create or replace function public.attach_diagnostic_setup_checkout(
  p_authorization_id uuid,
  p_checkout_session_id text,
  p_stripe_customer_id text,
  p_stripe_account_id text
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  auth_row public.diagnostic_payment_authorizations%rowtype;
begin
  select * into auth_row from public.diagnostic_payment_authorizations where id = p_authorization_id for update;
  if auth_row.id is null or auth_row.state <> 'setup_pending' then
    return false;
  end if;
  if not exists (
    select 1 from public.stripe_connect_accounts
    where organization_id = auth_row.organization_id and stripe_account_id = p_stripe_account_id
  ) then
    raise exception using errcode = '42501', message = 'That Stripe account does not belong to this business.';
  end if;

  update public.diagnostic_payment_authorizations
  set stripe_checkout_session_id = p_checkout_session_id,
      stripe_customer_id = p_stripe_customer_id,
      stripe_account_id = p_stripe_account_id
  where id = auth_row.id;
  return true;
end;
$$;

-- A booking in a deferred business only takes a checkout its authorization
-- made. A payment-mode session cannot be attached to it, so no advance
-- diagnostic payment can confirm one.
create or replace function public.attach_public_booking_checkout(p_booking_token uuid, p_checkout_session_id text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  intake public.booking_requests%rowtype;
  updated_count integer;
begin
  if p_checkout_session_id !~ '^cs_(test_|live_)[A-Za-z0-9]+' then
    return false;
  end if;

  select * into intake from public.booking_requests where public_token = p_booking_token;
  if intake.id is null then
    return false;
  end if;

  if (select private.diagnostic_collects_after_completion(intake.organization_id))
     and not exists (
       select 1 from public.diagnostic_payment_authorizations
       where booking_request_id = intake.id
         and stripe_checkout_session_id = p_checkout_session_id
         and state = 'setup_pending'
     ) then
    return false;
  end if;

  update public.booking_requests
  set deposit_checkout_session_id = p_checkout_session_id
  where public_token = p_booking_token
    and status = 'awaiting_payment'
    and expires_at > pg_catalog.now()
    and (
      deposit_checkout_session_id is null
      or deposit_checkout_session_id = p_checkout_session_id
    );

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$function$;

------------------------------------------------------------------------------
-- 8. Payment method saved: the appointment is confirmed, nothing is charged
------------------------------------------------------------------------------

create or replace function public.confirm_public_booking_setup(
  p_booking_token uuid,
  p_checkout_session_id text,
  p_setup_intent_id text,
  p_payment_method_id text,
  p_stripe_customer_id text,
  p_stripe_account_id text,
  p_brand text,
  p_last4 text,
  p_completed_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  intake public.booking_requests%rowtype;
  auth_row public.diagnostic_payment_authorizations%rowtype;
  booked record;
begin
  select * into intake
  from public.booking_requests
  where public_token = p_booking_token
    and deposit_checkout_session_id = p_checkout_session_id
  for update;
  if intake.id is null then
    raise exception using errcode = 'P0002', message = 'Booking setup record not found.';
  end if;

  select * into auth_row
  from public.diagnostic_payment_authorizations
  where booking_request_id = intake.id
    and stripe_checkout_session_id = p_checkout_session_id
  for update;
  if auth_row.id is null then
    raise exception using errcode = 'P0002', message = 'No authorization for that setup.';
  end if;

  -- Ownership: the Stripe objects must be on this business's own account and
  -- the Customer the session was created for.
  if p_stripe_account_id is distinct from auth_row.stripe_account_id
     or not exists (
       select 1 from public.stripe_connect_accounts
       where organization_id = intake.organization_id and stripe_account_id = p_stripe_account_id
     ) then
    raise exception using errcode = '42501', message = 'The payment method is not on this business''s Stripe account.';
  end if;
  if p_stripe_customer_id is distinct from auth_row.stripe_customer_id then
    raise exception using errcode = '42501', message = 'The payment method was saved for a different customer.';
  end if;

  -- A retried webhook, or the return page racing it.
  if auth_row.state <> 'setup_pending' then
    return intake.created_job_id;
  end if;
  if intake.created_job_id is not null then
    return intake.created_job_id;
  end if;
  if intake.status <> 'awaiting_payment' then
    raise exception using errcode = '22023', message = 'This booking is no longer waiting for a payment method.';
  end if;

  update public.diagnostic_payment_authorizations
  set state = 'payment_method_saved',
      stripe_setup_intent_id = p_setup_intent_id,
      stripe_payment_method_id = p_payment_method_id,
      payment_method_brand = nullif(pg_catalog.left(pg_catalog.lower(p_brand), 30), ''),
      payment_method_last4 = case when p_last4 ~ '^[0-9]{4}$' then p_last4 end,
      setup_completed_at = coalesce(p_completed_at, pg_catalog.now())
  where id = auth_row.id;

  select * into booked from private.book_confirmed_intake(intake.id, coalesce(p_completed_at, pg_catalog.now()), false);

  if booked.o_job_id is null then
    update public.booking_requests
    set status = 'needs_review'
    where id = intake.id;

    insert into public.activity_events (organization_id, event_type, label, booking_request_id, metadata)
    values (
      intake.organization_id, 'booking.payment_method_saved_but_unscheduled',
      'Payment method saved, but the time could no longer be booked. Nothing was charged.', intake.id,
      pg_catalog.jsonb_build_object('amount_cents', auth_row.amount_cents, 'note', coalesce(booked.o_failure, 'unknown'))
    );
    return null;
  end if;

  update public.booking_requests
  set status = case when intake.source in ('sms', 'voice') then 'scheduled' else 'confirmed' end,
      customer_id = coalesce(booked.o_customer_id, customer_id),
      property_id = coalesce(booked.o_property_id, property_id),
      created_job_id = booked.o_job_id
  where id = intake.id
  returning * into intake;

  update public.diagnostic_payment_authorizations
  set job_id = booked.o_job_id,
      customer_id = intake.customer_id
  where id = auth_row.id;

  if intake.customer_id is not null then
    insert into public.stripe_customers (organization_id, customer_id, stripe_account_id, stripe_customer_id)
    values (intake.organization_id, intake.customer_id, p_stripe_account_id, p_stripe_customer_id)
    on conflict do nothing;
  end if;

  insert into public.activity_events (
    organization_id, event_type, label, entity_type, entity_id, metadata, booking_request_id, job_id
  ) values (
    intake.organization_id, 'booking.payment_method_saved',
    'Payment method saved, appointment confirmed. No diagnostic payment collected.', 'job', booked.o_job_id,
    pg_catalog.jsonb_build_object('authorized_cents', auth_row.amount_cents, 'via', intake.source),
    intake.id, booked.o_job_id
  );

  return booked.o_job_id;
end;
$$;

-- When the business does not require a saved payment method: the booking is
-- confirmed with nothing saved and nothing charged.
create or replace function public.confirm_public_booking_without_payment_method(p_booking_token uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  intake public.booking_requests%rowtype;
  settings public.service_settings%rowtype;
  booked record;
begin
  select * into intake from public.booking_requests where public_token = p_booking_token for update;
  if intake.id is null then
    raise exception using errcode = 'P0002', message = 'Booking not found.';
  end if;
  if intake.created_job_id is not null then
    return intake.created_job_id;
  end if;
  select * into settings from public.service_settings where organization_id = intake.organization_id;
  if not (select private.diagnostic_collects_after_completion(intake.organization_id))
     or coalesce(settings.require_payment_method_at_booking, true) then
    raise exception using errcode = '22023', message = 'This business requires a saved payment method to book.';
  end if;
  if intake.status <> 'awaiting_payment' then
    raise exception using errcode = '22023', message = 'This booking is not waiting to be confirmed.';
  end if;

  select * into booked from private.book_confirmed_intake(intake.id, pg_catalog.now(), false);
  if booked.o_job_id is null then
    update public.booking_requests set status = 'needs_review' where id = intake.id;
    return null;
  end if;

  update public.booking_requests
  set status = case when intake.source in ('sms', 'voice') then 'scheduled' else 'confirmed' end,
      customer_id = coalesce(booked.o_customer_id, customer_id),
      property_id = coalesce(booked.o_property_id, property_id),
      created_job_id = booked.o_job_id
  where id = intake.id;

  insert into public.activity_events (
    organization_id, event_type, label, entity_type, entity_id, booking_request_id, job_id
  ) values (
    intake.organization_id, 'booking.confirmed_without_payment_method',
    'Appointment confirmed. No payment method saved; the diagnostic fee is billed after completion.', 'job',
    booked.o_job_id, intake.id, booked.o_job_id
  );
  return booked.o_job_id;
end;
$$;

-- A setup that expired, or a checkout that ended without one.
create or replace function public.expire_diagnostic_setup(p_checkout_session_id text)
returns boolean
language sql
security definer
set search_path to ''
as $$
  with expired as (
    update public.diagnostic_payment_authorizations
    set state = 'expired'
    where stripe_checkout_session_id = p_checkout_session_id
      and state = 'setup_pending'
    returning 1
  )
  select exists (select 1 from expired);
$$;

------------------------------------------------------------------------------
-- 9. Completing the diagnostic (separate from the job's status)
------------------------------------------------------------------------------

create or replace function public.complete_diagnostic_service(
  p_job_id uuid,
  p_outcome text,
  p_findings text,
  p_separate_repair_contract boolean default false,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  job public.jobs%rowtype;
  actor uuid := coalesce((select auth.uid()), p_actor);
  member_role text;
  assigned boolean;
  repair text;
  findings text := pg_catalog.btrim(coalesce(p_findings, ''));
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'Sign in to complete a diagnostic.';
  end if;

  select * into job from public.jobs where id = p_job_id for update;
  if job.id is null then
    raise exception using errcode = 'P0002', message = 'Job not found.';
  end if;

  select membership.role into member_role
  from public.organization_members as membership
  where membership.organization_id = job.organization_id and membership.user_id = actor;

  select exists (
    select 1 from public.technicians as technician
    where technician.id = job.technician_id and technician.user_id = actor
  ) into assigned;

  -- Owners and admins, or the technician assigned to this job. A dispatcher,
  -- an accountant, an AI agent or another business cannot.
  if member_role is null or not (member_role in ('owner', 'admin') or (member_role = 'technician' and assigned)) then
    raise exception using errcode = '42501', message = 'You are not allowed to complete this diagnostic.';
  end if;

  if job.status = 'canceled' then
    raise exception using errcode = '22023', message = 'This job is canceled.';
  end if;
  if job.diagnostic_completed_at is not null then
    return pg_catalog.jsonb_build_object(
      'completed_at', job.diagnostic_completed_at,
      'repair_contract', job.diagnostic_repair_contract,
      'already', true
    );
  end if;
  if p_outcome not in ('diagnostic_only', 'fix_now', 'schedule_later') then
    raise exception using errcode = '22023', message = 'That is not a way a diagnostic ends.';
  end if;
  if pg_catalog.char_length(findings) < 15 then
    raise exception using errcode = '22023', message = 'Document the diagnostic findings (at least a sentence).';
  end if;

  repair := case
    when p_outcome = 'diagnostic_only' then 'none'
    when p_outcome = 'fix_now' then 'same_contract'
    when coalesce(p_separate_repair_contract, false) then 'separate'
    else 'undetermined'
  end;

  update public.jobs
  set diagnostic_completed_at = pg_catalog.now(),
      diagnostic_completed_by = actor,
      diagnostic_findings = pg_catalog.left(findings, 4000),
      diagnostic_outcome = p_outcome,
      diagnostic_repair_contract = repair
  where id = job.id
  returning * into job;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, label, entity_type, entity_id, job_id, metadata
  ) values (
    job.organization_id, actor, 'diagnostic.completed', 'Diagnostic service completed', 'job', job.id, job.id,
    pg_catalog.jsonb_build_object('outcome', p_outcome, 'repair_contract', repair)
  );

  return pg_catalog.jsonb_build_object('completed_at', job.diagnostic_completed_at, 'repair_contract', repair, 'already', false);
end;
$$;

------------------------------------------------------------------------------
-- 10. Claiming a charge: every eligibility rule, under a lock
------------------------------------------------------------------------------

create or replace function public.claim_diagnostic_charge(
  p_job_id uuid,
  p_amount_cents integer,
  p_via text,
  p_actor uuid default null,
  p_checkout_session_id text default null
)
returns table (
  charge_id uuid,
  authorization_id uuid,
  stripe_account_id text,
  stripe_customer_id text,
  stripe_payment_method_id text,
  amount_cents integer,
  idempotency_key text
)
language plpgsql
security definer
set search_path to ''
as $$
declare
  job public.jobs%rowtype;
  auth_row public.diagnostic_payment_authorizations%rowtype;
  settings public.service_settings%rowtype;
  member_role text;
  technicians_bill boolean;
  new_id uuid := gen_random_uuid();
  refuse text;
begin
  if p_via not in ('app', 'mcp', 'auto', 'recovery') then
    raise exception using errcode = '42501', message = 'That route cannot collect payments.';
  end if;

  select * into job from public.jobs where id = p_job_id for update;
  if job.id is null then
    raise exception using errcode = 'P0002', message = 'Job not found.';
  end if;

  select * into auth_row
  from public.diagnostic_payment_authorizations as a
  where a.job_id = job.id
  order by (a.state in ('revoked', 'cancelled', 'expired')), a.created_at desc
  limit 1
  for update;

  select * into settings from public.service_settings where organization_id = job.organization_id;

  if p_via in ('app', 'mcp') then
    select membership.role, organization.technicians_can_edit_billing
    into member_role, technicians_bill
    from public.organization_members as membership
    join public.organizations as organization on organization.id = membership.organization_id
    where membership.organization_id = job.organization_id and membership.user_id = p_actor;
    if member_role is null then
      refuse := 'Only a member of this business can collect its payments.';
    elsif member_role = 'technician' and not coalesce(technicians_bill, false) then
      refuse := 'Your role cannot take payments for this business.';
    end if;
  end if;

  refuse := coalesce(refuse, case
    when not (select private.diagnostic_collects_after_completion(job.organization_id))
      then 'This business collects its diagnostic fee at booking.'
    when p_via = 'auto' and not coalesce(settings.auto_collect_diagnostic, true)
      then 'Automatic collection is turned off for this business.'
    when p_via in ('app', 'mcp') and not coalesce(settings.allow_manual_diagnostic_payment, true)
      then 'Manual collection after completion is turned off for this business.'
    when job.status = 'canceled' then 'The job is canceled; nothing is collected.'
    when job.diagnostic_completed_at is null then 'The diagnostic service has not been marked complete.'
    when pg_catalog.char_length(coalesce(job.diagnostic_findings, '')) < 15 then 'Document the diagnostic findings before collecting.'
    when job.diagnostic_repair_contract not in ('none', 'separate')
      then 'The repair is part of the same contract as the diagnostic. Collect when that contracted work is complete, on the final invoice.'
    when job.diagnostic_paid then 'The diagnostic fee is already paid.'
    when auth_row.id is null then 'The customer has not authorized a saved payment method.'
    when auth_row.organization_id <> job.organization_id then 'The authorization belongs to another business.'
    when auth_row.state = 'revoked' then 'The customer revoked the payment authorization.'
    when auth_row.state in ('cancelled', 'expired') then 'The payment authorization is no longer valid.'
    when auth_row.state in ('succeeded', 'refunded') then 'The diagnostic fee was already collected.'
    when auth_row.state = 'setup_pending' then 'The customer has not finished saving a payment method.'
    when auth_row.state = 'processing' then 'A payment for this diagnostic is already processing.'
    when p_via = 'recovery' and auth_row.state not in ('failed', 'requires_action', 'payment_method_saved')
      then 'There is no payment to recover.'
    when p_via <> 'recovery' and auth_row.stripe_payment_method_id is null then 'No saved payment method is on file.'
    when p_amount_cents is distinct from auth_row.amount_cents or p_amount_cents <= 0
      then 'Only the authorized amount can be collected.'
    when exists (
      select 1 from public.contracts as contract
      where contract.job_id = job.id and contract.status = 'signed' and contract.kind = 'agreement'
        and coalesce(contract.total_cents, 0) > auth_row.amount_cents
    ) then 'This diagnostic is part of a larger signed contract that is not complete.'
    when exists (
      select 1 from public.payments as payment
      where payment.job_id = job.id and payment.status in ('succeeded', 'pending')
        and payment.booking_request_id is not distinct from auth_row.booking_request_id
        and auth_row.booking_request_id is not null
    ) then 'A diagnostic payment is already recorded for this job.'
    when exists (
      select 1 from public.job_line_items as line
      join public.invoices as invoice on invoice.id = line.invoice_id
      where line.job_id = job.id and line.description = 'Diagnostic fee'
        and invoice.status not in ('draft', 'void')
    ) then 'The diagnostic fee is already on a sent invoice. Collect it on that invoice instead.'
    when not exists (
      select 1 from public.stripe_connect_accounts as account
      where account.organization_id = job.organization_id
        and account.stripe_account_id = auth_row.stripe_account_id
        and account.charges_enabled
    ) then 'This business''s Stripe account cannot take this payment.'
    else null
  end);

  -- A customer still inside a contract's right to cancel, or who cancelled it,
  -- is not charged (private.job_cancellation_hold, from the home improvement
  -- contracts migration; skipped on a database that does not have it yet).
  if refuse is null and pg_catalog.to_regprocedure('private.job_cancellation_hold(uuid)') is not null then
    execute 'select private.job_cancellation_hold($1)' into refuse using job.id;
  end if;

  if refuse is not null then
    raise exception using errcode = 'P0001', message = refuse;
  end if;

  begin
    insert into public.diagnostic_charges (
      id, organization_id, authorization_id, job_id, amount_cents, via, initiated_by,
      idempotency_key, stripe_checkout_session_id
    ) values (
      new_id, job.organization_id, auth_row.id, job.id, auth_row.amount_cents, p_via,
      case when p_via in ('app', 'mcp') then p_actor end,
      'diagnostic-charge-' || new_id::text, p_checkout_session_id
    );
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'A payment for this diagnostic is already processing.';
  end;

  update public.diagnostic_payment_authorizations as a set state = 'processing' where a.id = auth_row.id;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, label, entity_type, entity_id, job_id, metadata
  ) values (
    job.organization_id, case when p_via in ('app', 'mcp') then p_actor end,
    'diagnostic.payment_started', 'Diagnostic payment started', 'job', job.id, job.id,
    pg_catalog.jsonb_build_object('amount_cents', auth_row.amount_cents, 'via', p_via)
  );

  return query select new_id, auth_row.id, auth_row.stripe_account_id, auth_row.stripe_customer_id,
    auth_row.stripe_payment_method_id, auth_row.amount_cents, 'diagnostic-charge-' || new_id::text;
end;
$$;

------------------------------------------------------------------------------
-- 11. Recording what Stripe says happened (idempotent, order-safe)
------------------------------------------------------------------------------

create or replace function public.record_diagnostic_charge_result(
  p_charge_id uuid,
  p_outcome text,
  p_payment_intent_id text default null,
  p_amount_cents integer default null,
  p_failure_code text default null,
  p_failure_message text default null,
  p_occurred_at timestamptz default null,
  p_payment_method_id text default null,
  p_brand text default null,
  p_last4 text default null
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  charge public.diagnostic_charges%rowtype;
  auth_row public.diagnostic_payment_authorizations%rowtype;
  at timestamptz := coalesce(p_occurred_at, pg_catalog.now());
begin
  if p_outcome not in ('succeeded', 'failed', 'requires_action', 'canceled') then
    raise exception using errcode = '22023', message = 'Unknown payment outcome.';
  end if;

  select * into charge from public.diagnostic_charges where id = p_charge_id for update;
  if charge.id is null then
    raise exception using errcode = 'P0002', message = 'Diagnostic charge not found.';
  end if;
  select * into auth_row from public.diagnostic_payment_authorizations where id = charge.authorization_id for update;

  if p_amount_cents is not null and p_amount_cents <> charge.amount_cents then
    raise exception using errcode = '22023', message = 'The payment amount does not match the authorized charge.';
  end if;
  if p_payment_intent_id is not null and charge.stripe_payment_intent_id is not null
     and charge.stripe_payment_intent_id <> p_payment_intent_id then
    raise exception using errcode = '22023', message = 'The payment does not belong to this charge.';
  end if;

  -- Never move a succeeded payment back, whatever arrives later.
  if charge.status = 'succeeded' then
    return 'succeeded';
  end if;

  if p_outcome = 'succeeded' then
    update public.diagnostic_charges
    set status = 'succeeded', settled_at = at,
        stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
        failure_code = null, failure_message = null
    where id = charge.id;

    update public.diagnostic_payment_authorizations
    set state = case when state = 'refunded' then state else 'succeeded' end,
        last_failure_code = null,
        stripe_payment_method_id = coalesce(p_payment_method_id, stripe_payment_method_id),
        payment_method_brand = coalesce(nullif(pg_catalog.left(pg_catalog.lower(p_brand), 30), ''), payment_method_brand),
        payment_method_last4 = coalesce(case when p_last4 ~ '^[0-9]{4}$' then p_last4 end, payment_method_last4)
    where id = auth_row.id;

    update public.jobs set diagnostic_paid = true where id = charge.job_id and not diagnostic_paid;

    if not exists (
      select 1 from public.payments
      where provider_payment_intent_id = coalesce(p_payment_intent_id, charge.stripe_payment_intent_id)
    ) then
      insert into public.payments (
        organization_id, job_id, booking_request_id, provider_checkout_session_id,
        provider_payment_intent_id, status, amount_cents, currency, paid_at
      ) values (
        charge.organization_id, charge.job_id, auth_row.booking_request_id, charge.stripe_checkout_session_id,
        coalesce(p_payment_intent_id, charge.stripe_payment_intent_id), 'succeeded', charge.amount_cents, 'usd', at
      );
    end if;

    insert into public.activity_events (
      organization_id, event_type, label, entity_type, entity_id, job_id, booking_request_id, metadata
    ) values (
      charge.organization_id, 'diagnostic.payment_succeeded', 'Authorized diagnostic payment collected',
      'job', charge.job_id, charge.job_id, auth_row.booking_request_id,
      pg_catalog.jsonb_build_object('amount_cents', charge.amount_cents, 'via', charge.via)
    );
    return 'succeeded';
  end if;

  update public.diagnostic_charges
  set status = case when p_outcome = 'requires_action' then 'requires_action' when p_outcome = 'canceled' then 'canceled' else 'failed' end,
      stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
      failure_code = pg_catalog.left(p_failure_code, 80),
      failure_message = pg_catalog.left(p_failure_message, 300),
      settled_at = at
  where id = charge.id;

  if auth_row.state in ('processing', 'payment_method_saved', 'failed', 'requires_action') then
    update public.diagnostic_payment_authorizations
    set state = case
          when p_outcome = 'requires_action' then 'requires_action'
          when p_outcome = 'canceled' and auth_row.state = 'processing' then 'failed'
          when p_outcome = 'canceled' then auth_row.state
          else 'failed'
        end,
        last_failure_code = coalesce(pg_catalog.left(p_failure_code, 80), last_failure_code)
    where id = auth_row.id;
  end if;

  if p_outcome <> 'canceled' then
    insert into public.activity_events (
      organization_id, event_type, label, entity_type, entity_id, job_id, metadata
    ) values (
      charge.organization_id,
      case when p_outcome = 'requires_action' then 'diagnostic.payment_requires_action' else 'diagnostic.payment_failed' end,
      case when p_outcome = 'requires_action' then 'Diagnostic payment needs the customer to verify their card' else 'Diagnostic payment failed' end,
      'job', charge.job_id, charge.job_id,
      pg_catalog.jsonb_build_object('amount_cents', charge.amount_cents, 'code', pg_catalog.left(p_failure_code, 80))
    );
  end if;

  return (select state from public.diagnostic_payment_authorizations where id = auth_row.id);
end;
$$;

------------------------------------------------------------------------------
-- 12. Revocation, cancellation and refunds
------------------------------------------------------------------------------

-- The customer withdraws their authorization. The appointment stands; the fee
-- can then only be billed by invoice after completion.
create or replace function public.revoke_diagnostic_authorization(p_booking_token uuid)
returns table (stripe_account_id text, stripe_payment_method_id text)
language plpgsql
security definer
set search_path to ''
as $$
declare
  auth_row public.diagnostic_payment_authorizations%rowtype;
begin
  select a.* into auth_row
  from public.diagnostic_payment_authorizations as a
  join public.booking_requests as booking on booking.id = a.booking_request_id
  where booking.public_token = p_booking_token
    and a.state in ('setup_pending', 'payment_method_saved', 'failed', 'requires_action')
  order by a.created_at desc
  limit 1
  for update of a;

  if auth_row.id is null then
    return;
  end if;

  update public.diagnostic_payment_authorizations
  set state = 'revoked', revoked_at = pg_catalog.now()
  where id = auth_row.id;

  insert into public.activity_events (
    organization_id, event_type, label, booking_request_id, job_id, metadata
  ) values (
    auth_row.organization_id, 'diagnostic.authorization_revoked',
    'Customer revoked the saved payment method authorization', auth_row.booking_request_id, auth_row.job_id,
    pg_catalog.jsonb_build_object('amount_cents', auth_row.amount_cents)
  );

  return query select auth_row.stripe_account_id, auth_row.stripe_payment_method_id;
end;
$$;

-- Stripe says the payment method was detached (in its dashboard, or by us).
create or replace function public.diagnostic_payment_method_detached(p_stripe_account_id text, p_payment_method_id text)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  changed integer;
begin
  update public.diagnostic_payment_authorizations
  set state = 'revoked', revoked_at = coalesce(revoked_at, pg_catalog.now())
  where stripe_account_id = p_stripe_account_id
    and stripe_payment_method_id = p_payment_method_id
    and state in ('payment_method_saved', 'failed', 'requires_action');
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function private.cancel_diagnostic_authorizations()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_table_name = 'jobs' then
    if new.status = 'canceled' and old.status is distinct from 'canceled' then
      update public.diagnostic_payment_authorizations
      set state = 'cancelled', cancelled_at = pg_catalog.now()
      where job_id = new.id
        and state in ('setup_pending', 'payment_method_saved', 'failed', 'requires_action');
    end if;
  elsif tg_table_name = 'booking_requests' then
    if new.status in ('canceled', 'dismissed', 'expired') and old.status is distinct from new.status then
      update public.diagnostic_payment_authorizations
      set state = case when new.status = 'expired' and state = 'setup_pending' then 'expired' else 'cancelled' end,
          cancelled_at = pg_catalog.now()
      where booking_request_id = new.id
        and job_id is null
        and state in ('setup_pending', 'payment_method_saved');
    end if;
  elsif tg_table_name = 'payments' then
    if new.status = 'refunded' and old.status is distinct from 'refunded' and new.provider_payment_intent_id is not null then
      update public.diagnostic_payment_authorizations as a
      set state = 'refunded'
      from public.diagnostic_charges as charge
      where charge.authorization_id = a.id
        and charge.stripe_payment_intent_id = new.provider_payment_intent_id
        and a.state = 'succeeded';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists cancel_diagnostic_authorizations on public.jobs;
create trigger cancel_diagnostic_authorizations after update of status on public.jobs
  for each row execute function private.cancel_diagnostic_authorizations();
drop trigger if exists cancel_diagnostic_authorizations on public.booking_requests;
create trigger cancel_diagnostic_authorizations after update of status on public.booking_requests
  for each row execute function private.cancel_diagnostic_authorizations();
drop trigger if exists refund_diagnostic_authorizations on public.payments;
create trigger refund_diagnostic_authorizations after update of status on public.payments
  for each row execute function private.cancel_diagnostic_authorizations();

------------------------------------------------------------------------------
-- 13. What the public pages may read (thin, token- or slug-scoped)
------------------------------------------------------------------------------

create or replace function public.get_public_diagnostic_policy(p_slug text)
returns table (
  organization_id uuid,
  business_name text,
  fee_cents integer,
  jurisdiction text,
  collect_after_completion boolean,
  require_payment_method boolean,
  credit_toward_repairs boolean,
  service_description text
)
language sql
stable
security definer
set search_path to ''
as $$
  select organization.id, organization.name, coalesce(settings.diagnostic_fee_cents, 18000),
    (select private.diagnostic_jurisdiction(organization.id)),
    (select private.diagnostic_collects_after_completion(organization.id)),
    coalesce(settings.require_payment_method_at_booking, true),
    coalesce(settings.credit_diagnostic_to_repair, true),
    settings.diagnostic_service_description
  from public.organizations as organization
  left join public.service_settings as settings on settings.organization_id = organization.id
  where organization.slug = p_slug and organization.archived_at is null
  limit 1;
$$;

create or replace function public.get_booking_diagnostic_status(p_booking_token uuid)
returns table (
  business_name text,
  collect_after_completion boolean,
  require_payment_method boolean,
  credit_toward_repairs boolean,
  fee_cents integer,
  authorization_state text,
  authorized_cents integer,
  payment_method_brand text,
  payment_method_last4 text,
  accepted_at timestamptz,
  diagnostic_completed boolean,
  booking_status text,
  language text
)
language sql
stable
security definer
set search_path to ''
as $$
  select organization.name,
    (select private.diagnostic_collects_after_completion(organization.id)),
    coalesce(settings.require_payment_method_at_booking, true),
    coalesce(settings.credit_diagnostic_to_repair, true),
    coalesce(booking.deposit_cents, settings.diagnostic_fee_cents, 18000),
    auth_row.state, auth_row.amount_cents, auth_row.payment_method_brand, auth_row.payment_method_last4,
    auth_row.accepted_at, job.diagnostic_completed_at is not null, booking.status, booking.language
  from public.booking_requests as booking
  join public.organizations as organization on organization.id = booking.organization_id
  left join public.service_settings as settings on settings.organization_id = booking.organization_id
  left join public.jobs as job on job.id = booking.created_job_id
  left join lateral (
    select a.* from public.diagnostic_payment_authorizations as a
    where a.booking_request_id = booking.id
    order by (a.state in ('cancelled', 'expired')), a.created_at desc
    limit 1
  ) as auth_row on true
  where booking.public_token = p_booking_token
  limit 1;
$$;

------------------------------------------------------------------------------
-- 14. Stripe webhook replay protection (the table existed, unused)
------------------------------------------------------------------------------

-- True when this event should be processed now: first delivery, or a retry
-- of one that failed. False for a duplicate of one already processed.
create or replace function public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_stripe_account_id text,
  p_object_id text
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  current_status text;
begin
  insert into public.stripe_webhook_events (stripe_event_id, event_type, stripe_account_id, object_id, organization_id, attempts)
  values (
    p_event_id, p_event_type, p_stripe_account_id, pg_catalog.left(p_object_id, 255),
    (select account.organization_id from public.stripe_connect_accounts as account where account.stripe_account_id = p_stripe_account_id limit 1),
    1
  )
  on conflict (stripe_event_id) do update
  set attempts = public.stripe_webhook_events.attempts + 1
  returning processing_status into current_status;

  return current_status in ('pending', 'failed');
end;
$$;

create or replace function public.finish_stripe_webhook_event(p_event_id text, p_status text, p_error text default null)
returns void
language sql
security definer
set search_path to ''
as $$
  update public.stripe_webhook_events
  set processing_status = p_status,
      last_error = pg_catalog.left(p_error, 300),
      processed_at = case when p_status in ('processed', 'ignored') then pg_catalog.now() else processed_at end
  where stripe_event_id = p_event_id
    and p_status in ('processed', 'failed', 'ignored');
$$;

------------------------------------------------------------------------------
-- 15. Who may call what
------------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.record_diagnostic_authorization(uuid, text, text, text, text, text, text, text)',
    'public.attach_diagnostic_setup_checkout(uuid, text, text, text)',
    'public.attach_public_booking_checkout(uuid, text)',
    'public.confirm_public_booking_setup(uuid, text, text, text, text, text, text, text, timestamptz)',
    'public.confirm_public_booking_without_payment_method(uuid)',
    'public.expire_diagnostic_setup(text)',
    'public.claim_diagnostic_charge(uuid, integer, text, uuid, text)',
    'public.record_diagnostic_charge_result(uuid, text, text, integer, text, text, timestamptz, text, text, text)',
    'public.revoke_diagnostic_authorization(uuid)',
    'public.diagnostic_payment_method_detached(text, text)',
    'public.claim_stripe_webhook_event(text, text, text, text)',
    'public.finish_stripe_webhook_event(text, text, text)'
  ] loop
    execute pg_catalog.format('revoke all on function %s from public, anon, authenticated', fn);
    execute pg_catalog.format('grant execute on function %s to service_role', fn);
  end loop;

  -- Signed-in members complete diagnostics (the function checks the role);
  -- server code passes the actor for MCP calls.
  revoke all on function public.complete_diagnostic_service(uuid, text, text, boolean, uuid) from public, anon;
  grant execute on function public.complete_diagnostic_service(uuid, text, text, boolean, uuid) to authenticated, service_role;

  -- Public, thin reads.
  revoke all on function public.get_public_diagnostic_policy(text) from public;
  grant execute on function public.get_public_diagnostic_policy(text) to anon, authenticated, service_role;
  revoke all on function public.get_booking_diagnostic_status(uuid) from public;
  grant execute on function public.get_booking_diagnostic_status(uuid) to anon, authenticated, service_role;

  foreach fn in array array[
    'private.diagnostic_jurisdiction(uuid)',
    'private.diagnostic_collects_after_completion(uuid)',
    'private.guard_diagnostic_payment_settings()',
    'private.cancel_diagnostic_authorizations()'
  ] loop
    execute pg_catalog.format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end
$$;
