-- Requests from a business's own website.
--
-- An electrician with their own site has a request form on it. Until now what
-- the customer typed there reached an inbox and stopped: nothing in Volteira
-- knew the customer existed, and nobody got back to them until somebody read
-- the email. Here the site sends each request in with a key the business made,
-- and it lands as a booking request like any other, marked as from the website.
--
-- The site's own request id is the idempotency key. The site retries when it
-- cannot tell whether a send arrived, and a retry must find the request it
-- already made rather than make a second one and text the customer twice.

create table if not exists public.website_intake_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The key is shown once and only its SHA-256 is kept, so a leaked table is
  -- not a leaked key.
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  label text not null default 'Website form' check (char_length(label) between 1 and 60),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists website_intake_keys_org_idx
  on public.website_intake_keys (organization_id, created_at desc);

alter table public.website_intake_keys enable row level security;

-- Owners only, as with the ChatGPT connection: a key lets anyone holding it put
-- requests into this business and have its number text people.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'website_intake_keys'
      and policyname = 'owners manage website intake keys'
  ) then
    create policy "owners manage website intake keys" on public.website_intake_keys for all using (
      exists (
        select 1 from public.organization_members m
        where m.organization_id = website_intake_keys.organization_id
          and m.user_id = (select auth.uid()) and m.role = 'owner'
      )
    ) with check (
      exists (
        select 1 from public.organization_members m
        where m.organization_id = website_intake_keys.organization_id
          and m.user_id = (select auth.uid()) and m.role = 'owner'
      )
    );
  end if;
end;
$$;

grant select, insert, update on table public.website_intake_keys to authenticated;

alter table public.booking_requests
  add column if not exists origin text check (origin is null or origin = 'website'),
  add column if not exists external_ref text check (external_ref is null or char_length(external_ref) between 1 and 100),
  add column if not exists preferred_times text check (preferred_times is null or char_length(preferred_times) <= 300),
  add column if not exists contact_preference text
    check (contact_preference is null or contact_preference in ('phone', 'email', 'text'));

create unique index if not exists booking_requests_external_ref_idx
  on public.booking_requests (organization_id, external_ref)
  where external_ref is not null;

/**
 * Take one website request in, all or nothing.
 *
 * Finds the customer by phone (or makes one), records text consent when the box
 * was ticked, and writes the booking request. Run by the intake route with the
 * service role after it has matched the website's key to this business; nobody
 * signed in can call it.
 *
 * A previous opt-out is never overridden here. Somebody who replied STOP and
 * later ticks a box on a website has not asked us to start texting them again;
 * they can text START, and the inbound handler records that.
 */
create or replace function public.website_intake(p_organization_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text := left(pg_catalog.btrim(coalesce(p_payload->>'reference', '')), 100);
  v_first text := left(pg_catalog.btrim(coalesce(p_payload->>'firstName', '')), 80);
  v_last text := left(pg_catalog.btrim(coalesce(p_payload->>'lastName', '')), 80);
  v_phone text := left(pg_catalog.btrim(coalesce(p_payload->>'phone', '')), 30);
  v_email text := left(pg_catalog.btrim(coalesce(p_payload->>'email', '')), 254);
  v_address text := left(pg_catalog.btrim(coalesce(p_payload->>'address', '')), 200);
  v_city text := left(pg_catalog.btrim(coalesce(p_payload->>'city', '')), 80);
  v_postal text := pg_catalog.btrim(coalesce(p_payload->>'postalCode', ''));
  v_service text := left(pg_catalog.btrim(coalesce(p_payload->>'service', '')), 80);
  v_service_name text := left(pg_catalog.btrim(coalesce(p_payload->>'serviceName', '')), 120);
  v_description text := left(pg_catalog.btrim(coalesce(p_payload->>'description', '')), 2000);
  v_preferred text := left(pg_catalog.btrim(coalesce(p_payload->>'preferredTimes', '')), 300);
  v_contact text := coalesce(p_payload->>'contactMethod', '');
  v_sms boolean := coalesce((p_payload->>'smsConsent')::boolean, false);
  v_disclosure text := left(pg_catalog.btrim(coalesce(p_payload->>'smsDisclosure', '')), 1000);
  v_site text := left(pg_catalog.btrim(coalesce(p_payload->>'site', '')), 120);
  v_request uuid;
  v_customer uuid;
  v_known_first text;
  v_opted_out timestamptz;
  v_consent text := 'none';
begin
  if p_organization_id is null or not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception using errcode = 'P0002', message = 'No such business.';
  end if;
  if v_ref = '' then
    raise exception using errcode = '22023', message = 'A request reference is required.';
  end if;
  if v_first = '' then
    raise exception using errcode = '22023', message = 'A first name is required.';
  end if;
  if pg_catalog.length(pg_catalog.regexp_replace(v_phone, '[^0-9]', '', 'g')) < 10 then
    raise exception using errcode = '22023', message = 'A phone number with at least ten digits is required.';
  end if;
  if v_contact not in ('phone', 'email', 'text') then
    v_contact := 'phone';
  end if;
  if v_postal !~ '^[0-9]{5}(-[0-9]{4})?$' then
    v_postal := '';
  end if;
  if v_disclosure = '' then
    v_sms := false;
  end if;

  -- The same request again: hand back what the first one made.
  select request.id, request.customer_id into v_request, v_customer
  from public.booking_requests as request
  where request.organization_id = p_organization_id and request.external_ref = v_ref;
  if v_request is not null then
    return jsonb_build_object('request_id', v_request, 'customer_id', v_customer, 'duplicate', true, 'consent', 'unchanged');
  end if;

  v_customer := public.find_or_create_customer_by_phone(
    p_organization_id, v_phone, v_first, nullif(v_last, ''),
    case when v_contact = 'text' then 'sms' else 'phone' end,
    'Created from a website request.'
  );

  -- Fill in what is missing; never rename somebody the business already knows.
  -- "Text" and "Caller" are the placeholders the text and phone intakes use
  -- until somebody says who they are.
  select customer.first_name into v_known_first from public.customers as customer where customer.id = v_customer;
  update public.customers as customer
  set first_name = case when coalesce(v_known_first, '') in ('', 'Text', 'Caller') then v_first else customer.first_name end,
      last_name = case when coalesce(v_known_first, '') in ('', 'Text', 'Caller') then nullif(v_last, '') else customer.last_name end,
      email = coalesce(nullif(customer.email, ''), nullif(v_email, ''))
  where customer.id = v_customer;

  if v_sms then
    select consent.opted_out_at into v_opted_out
    from public.messaging_consent as consent
    where consent.customer_id = v_customer and consent.channel = 'sms' and consent.scope = 'transactional';
    if not found then
      insert into public.messaging_consent (
        organization_id, customer_id, channel, scope, opted_in_at, opted_out_at, source, proof_text
      ) values (
        p_organization_id, v_customer, 'sms', 'transactional', now(), null, 'booking_form',
        left(pg_catalog.format('[website request form%s] %s',
          case when v_site <> '' then ', ' || v_site else '' end, v_disclosure), 2000)
      );
      v_consent := 'recorded';
    elsif v_opted_out is not null then
      v_consent := 'opted_out';
    else
      v_consent := 'existing';
    end if;
  end if;

  insert into public.booking_requests (
    organization_id, customer_id, status, intent, phone, contact_name, first_name, last_name, email,
    description, address_line_1, city, postal_code, category, urgency,
    source, communication_channel, created_by, origin, external_ref, preferred_times, contact_preference,
    transactional_contact_consent, consented_at,
    sms_consent, sms_consent_at, sms_consent_source, sms_consent_disclosure,
    intake_answers, model_decision, notification_results
  ) values (
    p_organization_id, v_customer, 'new', 'visit', v_phone,
    pg_catalog.btrim(v_first || ' ' || v_last), v_first, nullif(v_last, ''), nullif(v_email, ''),
    coalesce(nullif(v_description, ''),
      left('Website request: ' || coalesce(nullif(v_service_name, ''), nullif(v_service, ''), 'service'), 2000)),
    nullif(v_address, ''), nullif(v_city, ''), nullif(v_postal, ''),
    left(coalesce(nullif(v_service_name, ''), nullif(v_service, '')), 80), 'routine',
    'web', 'web', 'customer', 'website', v_ref, nullif(v_preferred, ''), v_contact,
    true, now(),
    v_sms, case when v_sms then now() end, case when v_sms then 'website_form' end,
    case when v_sms then v_disclosure end,
    '[]'::jsonb, '{}'::jsonb, '[]'::jsonb
  )
  on conflict (organization_id, external_ref) where external_ref is not null do nothing
  returning id into v_request;

  -- Another delivery of the same request won the race between the check above
  -- and this insert. Its row is the answer, and this delivery changes nothing
  -- further (the consent it may have written is the same consent).
  if v_request is null then
    select request.id, request.customer_id into v_request, v_customer
    from public.booking_requests as request
    where request.organization_id = p_organization_id and request.external_ref = v_ref;
    return jsonb_build_object('request_id', v_request, 'customer_id', v_customer, 'duplicate', true, 'consent', 'unchanged');
  end if;

  insert into public.activity_events (
    organization_id, event_type, label, entity_type, entity_id, customer_id, booking_request_id, metadata
  ) values (
    p_organization_id, 'booking.website_request', 'Request from your website', 'booking_request', v_request,
    v_customer, v_request,
    jsonb_build_object('service', v_service, 'contact_method', v_contact, 'sms_consent', v_sms, 'reference', v_ref)
  );

  return jsonb_build_object('request_id', v_request, 'customer_id', v_customer, 'duplicate', false, 'consent', v_consent);
end;
$$;

revoke all on function public.website_intake(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.website_intake(uuid, jsonb) to service_role;
