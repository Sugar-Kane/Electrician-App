-- ---------------------------------------------------------------------------
-- Paying before confirming, on every channel.
--
-- The web booking page holds the slot, takes the diagnostic fee, and only then
-- writes a job. A booking taken by text or over the phone went straight to a
-- confirmed job with nothing collected — same appointment, same fee quoted,
-- no money.
--
-- Both paths now produce a `booking_requests` row in `awaiting_payment`, and
-- both are finished by the same Stripe webhook. What differs is only how the
-- job gets made, because a web intake carries a name, a state and an address
-- the form insisted on, and a texted booking carries whatever somebody typed
-- into a phone — which is the entire reason `schedule_sms_booking_request`
-- exists.
-- ---------------------------------------------------------------------------

-- What the pay page needs to start a checkout ---------------------------------

/*
 * The page runs as the anonymous key and holds one unguessable token. This is
 * the only thing it may learn from it: enough to draw a Stripe line item and
 * nothing that would help somebody guess at another booking.
 */
create or replace function public.get_booking_payment_intent(p_booking_token uuid)
returns table (
  organization_id uuid,
  organization_slug text,
  business_name text,
  status text,
  fee_cents integer,
  email text,
  diagnostic_minutes integer,
  priority text,
  already_paid boolean
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    request.organization_id,
    organization.slug,
    organization.name,
    request.status,
    coalesce(request.deposit_cents, 0),
    request.email,
    coalesce(settings.diagnostic_minutes, 60),
    coalesce(request.priority, 'standard'),
    request.deposit_paid_at is not null or request.created_job_id is not null
  from public.booking_requests as request
  join public.organizations as organization
    on organization.id = request.organization_id
  left join public.service_settings as settings
    on settings.organization_id = request.organization_id
  where request.public_token = p_booking_token
  limit 1;
$fn$;

comment on function public.get_booking_payment_intent(uuid) is
  'The minimum a payment page needs about one booking, reached by its own unguessable token.';

-- Confirming a payment, whichever channel took the booking --------------------

create or replace function public.confirm_public_booking_payment(
  p_booking_token uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_amount_cents integer,
  p_currency text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  intake public.booking_requests%rowtype;
  settings public.service_settings%rowtype;
  matched_customer_id uuid;
  resolved_property_id uuid;
  job_id uuid;
  scheduling_failed text;
begin
  select * into intake
  from public.booking_requests
  where public_token = p_booking_token
    and deposit_checkout_session_id = p_checkout_session_id
  for update;

  if intake.id is null then
    raise exception using errcode = 'P0002', message = 'Booking payment record not found.';
  end if;

  -- The real idempotency condition is a job, not a status word. The two
  -- channels finish on different ones — 'confirmed' for the web, 'scheduled'
  -- for a text — and a webhook Stripe retries must return the same job either
  -- way rather than making a second one.
  if intake.created_job_id is not null then
    return intake.created_job_id;
  end if;

  if intake.status <> 'awaiting_payment'
    or p_amount_cents <> intake.deposit_cents
    or pg_catalog.lower(p_currency) <> 'usd' then
    raise exception using errcode = '22023', message = 'Booking payment does not match the intake.';
  end if;

  select * into settings
  from public.service_settings
  where organization_id = intake.organization_id;

  if intake.source in ('sms', 'voice') then
    /*
     * A texted or spoken booking, whose customer already exists and whose
     * address arrived as free text. `schedule_sms_booking_request` is the
     * function that knows how to turn that into a job — it invents the state
     * from the business's own, creates the property only when there is an
     * address, and refuses a window nobody is working.
     *
     * That refusal is the case worth handling: somebody can turn their
     * availability off during the half hour the slot is held, and a payment
     * that has already been taken must not be lost to an exception. The money
     * is recorded either way and the booking is left for a person to sort out.
     */
    begin
      job_id := public.schedule_sms_booking_request(intake.id);
    exception when others then
      scheduling_failed := pg_catalog.left(coalesce(sqlerrm, 'could not be scheduled'), 300);
      job_id := null;
    end;

    if job_id is not null then
      update public.jobs
      set diagnostic_paid = true,
          diagnostic_fee_cents = intake.deposit_cents
      where id = job_id;
    end if;
  else
    select customer.id into matched_customer_id
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

    if matched_customer_id is null then
      insert into public.customers (
        organization_id, customer_type, first_name, last_name, email, phone,
        preferred_contact, notes
      ) values (
        intake.organization_id, intake.customer_type, intake.first_name,
        intake.last_name, intake.email, intake.phone,
        case when intake.sms_consent then 'sms' else 'phone' end,
        'Created from public diagnostic booking'
      ) returning id into matched_customer_id;
    end if;

    if intake.sms_consent and pg_catalog.to_regclass('public.messaging_consent') is not null then
      insert into public.messaging_consent (
        organization_id, customer_id, channel, scope, opted_in_at, opted_out_at,
        source, proof_text
      ) values (
        intake.organization_id, matched_customer_id, 'sms', 'transactional',
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

    select property.id into resolved_property_id
    from public.properties as property
    where property.organization_id = intake.organization_id
      and property.customer_id = matched_customer_id
      and property.archived_at is null
      and pg_catalog.lower(property.address_line_1) = pg_catalog.lower(intake.address_line_1)
      and pg_catalog.lower(property.city) = pg_catalog.lower(intake.city)
      and property.state = intake.state
      and property.postal_code = intake.postal_code
    order by property.created_at
    limit 1;

    if resolved_property_id is null then
      insert into public.properties (
        organization_id, customer_id, address_line_1, address_line_2, city, state,
        postal_code, access_notes, safety_notes
      ) values (
        intake.organization_id, matched_customer_id, intake.address_line_1,
        intake.address_line_2, intake.city, intake.state, intake.postal_code,
        intake.access_notes,
        nullif(pg_catalog.array_to_string(intake.safety_flags, ', '), '')
      ) returning id into resolved_property_id;
    end if;

    insert into public.jobs (
      organization_id, customer_id, property_id, status, category, priority,
      customer_description, ai_summary, safety_flags, scheduled_start,
      scheduled_end, arrival_window_start, arrival_window_end, diagnostic_fee_cents,
      diagnostic_paid
    ) values (
      intake.organization_id, matched_customer_id, resolved_property_id, 'confirmed', intake.category,
      intake.priority, intake.description, intake.description,
      intake.safety_flags, intake.arrival_window_start,
      intake.arrival_window_start + pg_catalog.make_interval(mins => settings.diagnostic_minutes),
      intake.arrival_window_start, intake.arrival_window_end,
      intake.deposit_cents, true
    ) returning id into job_id;
  end if;

  -- The money arrived. Recorded before anything else can go wrong with it.
  insert into public.payments (
    organization_id, job_id, booking_request_id, provider_checkout_session_id,
    provider_payment_intent_id, status, amount_cents, currency, paid_at
  ) values (
    intake.organization_id, job_id, intake.id, p_checkout_session_id,
    nullif(p_payment_intent_id, ''), 'succeeded', p_amount_cents,
    pg_catalog.lower(p_currency), pg_catalog.now()
  ) on conflict (provider_checkout_session_id) do nothing;

  if job_id is null then
    -- Paid, and there is no appointment. The one outcome nobody must find out
    -- about by accident.
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
        'amount_cents', p_amount_cents, 'note', coalesce(scheduling_failed, 'unknown')
      )
    );

    return null;
  end if;

  update public.booking_requests
  set status = case when intake.source in ('sms', 'voice') then 'scheduled' else 'confirmed' end,
      deposit_paid_at = pg_catalog.now(),
      stripe_payment_intent_id = nullif(p_payment_intent_id, ''),
      customer_id = coalesce(matched_customer_id, customer_id),
      property_id = coalesce(resolved_property_id, property_id),
      created_job_id = job_id
  where id = intake.id;

  insert into public.activity_events (
    organization_id, event_type, label, entity_type, entity_id, metadata,
    booking_request_id, job_id
  ) values (
    intake.organization_id, 'booking.payment_confirmed',
    'Diagnostic fee paid, appointment confirmed', 'job', job_id,
    pg_catalog.jsonb_build_object('amount_cents', p_amount_cents, 'via', intake.source),
    intake.id, job_id
  );

  return job_id;
end;
$fn$;
