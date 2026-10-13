/**
 * Refusals that come back instead of spinning.
 *
 * The recovery tools (20261012210000) and the booking history tools
 * (20261012230000) refuse a change whose record moved on since the preview with
 * SQLSTATE 40001. PostgREST runs every call inside a transaction that it
 * retries for as long as it fails with 40001, so such a refusal never reached
 * the app: the request hung while the database rolled the same call back
 * thousands of times a second.
 *
 * The same five functions again, unchanged except that they refuse with
 * PostgREST's PT409: an HTTP 409 Conflict carrying the same message, which is
 * not retried. Grants are kept by `create or replace`.
 */

create or replace function public.admin_retry_text_begin(
  p_operation_id uuid,
  p_message_id uuid,
  p_expected_phone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  op public.support_operations := private.running_operation(p_operation_id, 'retry_text', p_message_id);
  original public.messages;
  conversation public.conversations;
  phone text;
  consent_ok boolean;
  created uuid;
begin
  if not (select private.is_platform_owner()) then
    raise exception using errcode = '42501', message = 'A support admin can look and check, not change.';
  end if;

  select * into original from public.messages where id = p_message_id for update;
  if original.id is null or original.organization_id <> op.organization_id then
    raise exception using errcode = '42501', message = 'That text is not in this business.';
  end if;
  if original.direction <> 'outbound' or original.status not in ('failed', 'undelivered') then
    raise exception using errcode = 'PT409', message = 'That text no longer looks failed.';
  end if;

  select * into conversation from public.conversations where id = original.conversation_id;
  select coalesce(c.phone, '') into phone from public.customers as c where c.id = conversation.customer_id;
  if phone is distinct from coalesce(p_expected_phone, '') then
    raise exception using errcode = 'PT409', message = 'The customer''s number changed since the preview.';
  end if;

  select exists (
    select 1 from public.messaging_consent as consent
    where consent.organization_id = op.organization_id
      and consent.customer_id = conversation.customer_id
      and consent.channel = 'sms' and consent.scope = 'transactional'
      and consent.opted_in_at is not null and consent.opted_out_at is null
  ) into consent_ok;
  if not consent_ok then
    raise exception using errcode = 'PT409', message = 'The customer has not agreed to texts, or replied STOP.';
  end if;

  insert into public.messages (
    organization_id, conversation_id, direction, body, status, approved_by, approved_at
  )
  values (
    op.organization_id, original.conversation_id, 'outbound', original.body, 'sending',
    (select auth.uid()), now()
  )
  returning id into created;

  return created;
end;
$$;

create or replace function public.admin_fix_customer_phone(
  p_operation_id uuid,
  p_customer_id uuid,
  p_expected_phone text,
  p_new_phone text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  op public.support_operations := private.running_operation(p_operation_id, 'fix_recipient', p_customer_id);
  customer public.customers;
begin
  if not (select private.is_platform_owner()) then
    raise exception using errcode = '42501', message = 'A support admin can look and check, not change.';
  end if;
  if coalesce(p_new_phone, '') !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'That is not a number that can be texted.';
  end if;

  select * into customer from public.customers where id = p_customer_id for update;
  if customer.id is null or customer.organization_id <> op.organization_id then
    raise exception using errcode = '42501', message = 'That customer is not in this business.';
  end if;
  if coalesce(customer.phone, '') is distinct from coalesce(p_expected_phone, '') then
    raise exception using errcode = 'PT409', message = 'The number changed since the preview.';
  end if;
  -- One number per customer in a business; say so rather than fail on the index.
  if exists (
    select 1 from public.customers as other
    where other.organization_id = customer.organization_id
      and other.id <> customer.id
      and right(regexp_replace(coalesce(other.phone, ''), '[^0-9]', '', 'g'), 10)
        = right(regexp_replace(p_new_phone, '[^0-9]', '', 'g'), 10)
  ) then
    raise exception using errcode = '23505', message = 'Another customer in this business already has that number.';
  end if;

  update public.customers set phone = p_new_phone, updated_at = now() where id = p_customer_id;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, label, entity_type, entity_id, customer_id, metadata
  )
  values (
    op.organization_id, (select auth.uid()), 'customer.phone_corrected',
    'Phone number corrected by Volteira support', 'customer', p_customer_id, p_customer_id,
    jsonb_build_object('previous_phone', coalesce(customer.phone, ''), 'reason', op.reason, 'operation', op.id)
  );

  return p_new_phone;
end;
$$;

create or replace function private.hide_booking_request(
  p_request_id uuid,
  p_classification text,
  p_duplicate_of uuid,
  p_actor uuid,
  p_by_support boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.booking_requests;
  why text;
begin
  select * into request from public.booking_requests where id = p_request_id for update;
  if request.id is null then
    raise exception using errcode = 'P0002', message = 'That request could not be found.';
  end if;

  why := private.booking_hide_refusal(request);
  if why is not null then
    raise exception using errcode = 'PT409', message = why;
  end if;

  update public.booking_requests
  set archived_status = request.status,
      status = 'dismissed',
      classification = p_classification,
      duplicate_of = p_duplicate_of,
      archived_at = now(),
      archived_by = p_actor,
      handled_by = coalesce(p_actor, handled_by),
      handled_at = now()
  where id = p_request_id;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, label, entity_type, entity_id, customer_id, booking_request_id, metadata
  )
  values (
    request.organization_id,
    p_actor,
    case when p_duplicate_of is null then 'booking.not_service' else 'booking.duplicate_hidden' end,
    case when p_duplicate_of is null then 'Hidden: not a service request' else 'Hidden as a duplicate' end
      || case when p_by_support then ' (by Volteira support)' else '' end,
    'booking_request',
    request.id,
    request.customer_id,
    request.id,
    jsonb_build_object(
      'classification', p_classification,
      'duplicate_of', p_duplicate_of,
      'previous_status', request.status,
      'by_support', p_by_support
    )
  );
end;
$$;

create or replace function private.hide_duplicate_booking_requests(
  p_organization_id uuid,
  p_keep_id uuid,
  p_duplicate_ids uuid[],
  p_actor uuid,
  p_by_support boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  keep public.booking_requests;
  other public.booking_requests;
  other_id uuid;
  hidden integer := 0;
begin
  select * into keep from public.booking_requests where id = p_keep_id for update;
  if keep.id is null or keep.organization_id <> p_organization_id then
    raise exception using errcode = '42501', message = 'That request belongs to another business.';
  end if;
  if keep.archived_at is not null then
    raise exception using errcode = 'PT409', message = 'The one to keep is hidden. Bring it back first.';
  end if;
  if coalesce(cardinality(p_duplicate_ids), 0) = 0 or p_keep_id = any(p_duplicate_ids) then
    raise exception using errcode = '22023', message = 'Choose one request to keep and at least one other.';
  end if;

  foreach other_id in array (select array_agg(distinct id) from unnest(p_duplicate_ids) as id) loop
    select * into other from public.booking_requests where id = other_id for update;
    if other.id is null or other.organization_id <> p_organization_id then
      raise exception using errcode = '42501', message = 'That request belongs to another business.';
    end if;
    if not private.booking_same_contact(keep, other) then
      raise exception using errcode = '22023', message = 'These aren''t from the same phone number or email.';
    end if;
    perform private.hide_booking_request(other_id, null, p_keep_id, p_actor, p_by_support);
    hidden := hidden + 1;
  end loop;

  update public.booking_requests set duplicate_reviewed_at = now() where id = p_keep_id;
  return hidden;
end;
$$;

create or replace function private.restore_booking_request(p_request_id uuid, p_actor uuid, p_by_support boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.booking_requests;
  back text;
begin
  select * into request from public.booking_requests where id = p_request_id for update;
  if request.id is null then
    raise exception using errcode = 'P0002', message = 'That request could not be found.';
  end if;
  if request.archived_at is null then
    raise exception using errcode = 'PT409', message = 'It isn''t hidden.';
  end if;

  back := coalesce(request.archived_status, 'needs_review');
  begin
    update public.booking_requests
    set status = back,
        classification = null,
        duplicate_of = null,
        archived_at = null,
        archived_by = null,
        archived_status = null,
        -- Brought back on purpose: don't suggest it as a duplicate again.
        duplicate_reviewed_at = case when request.duplicate_of is not null then now() else duplicate_reviewed_at end
    where id = p_request_id;
  exception when unique_violation then
    raise exception using errcode = '23505',
      message = 'This customer has another open request for the same thing. Answer or hide that one first.';
  end;

  if request.duplicate_of is not null then
    update public.booking_requests set duplicate_reviewed_at = now() where id = request.duplicate_of;
  end if;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, label, entity_type, entity_id, customer_id, booking_request_id, metadata
  )
  values (
    request.organization_id,
    p_actor,
    'booking.restored',
    'Brought back from hidden' || case when p_by_support then ' (by Volteira support)' else '' end,
    'booking_request',
    request.id,
    request.customer_id,
    request.id,
    jsonb_build_object(
      'was', coalesce(request.classification, case when request.duplicate_of is not null then 'duplicate' end),
      'status', back,
      'by_support', p_by_support
    )
  );
  return back;
end;
$$;
