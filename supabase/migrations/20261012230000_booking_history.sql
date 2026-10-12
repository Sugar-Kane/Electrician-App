-- Booking requests that aren't work: hidden, never deleted.
--
-- A sales call, spam, a test, or the same person asking twice used to sit in
-- the waiting list until somebody pressed Dismiss, and then looked exactly like
-- a real request somebody turned away. Now a request can be hidden as one of
-- those, with who did it and when, and brought back exactly as it was.
--
-- A request that became a job, or has money behind it (a deposit, a payment, a
-- payment link the customer may still use) can't be hidden. Those need the job
-- cancelled or the money refunded, by a person, in the open.
--
-- Hiding moves the request to `dismissed`, so every count of what is waiting
-- (the list, Today, search, the intake's one-live-request rules) leaves it out
-- without learning a new column. The status it had is kept for bringing it
-- back.
--
-- The same refusals live in src/lib/booking-duplicates.ts, so the page offers
-- only what will work. These are the ones that hold.

alter table public.booking_requests
  add column if not exists classification text,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archived_status text,
  add column if not exists duplicate_of uuid references public.booking_requests(id) on delete set null,
  add column if not exists duplicate_reviewed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_requests_classification_check' and conrelid = 'public.booking_requests'::regclass
  ) then
    alter table public.booking_requests
      add constraint booking_requests_classification_check
      check (classification is null or classification in ('sales', 'spam', 'test', 'other'));
  end if;
end;
$$;

create index if not exists booking_requests_org_archived_idx
  on public.booking_requests(organization_id, archived_at desc)
  where archived_at is not null;
create index if not exists booking_requests_duplicate_of_idx
  on public.booking_requests(duplicate_of)
  where duplicate_of is not null;

/** Why a request can't be hidden, or null when it can. */
create or replace function private.booking_hide_refusal(p_request public.booking_requests)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_request.archived_at is not null then 'It''s already hidden.'
    when p_request.created_job_id is not null then 'It became a job, so it''s real work. Cancel the job instead if it shouldn''t happen.'
    when p_request.deposit_paid_at is not null
      or p_request.stripe_payment_intent_id is not null
      or exists (select 1 from public.payments as payment where payment.booking_request_id = p_request.id)
      then 'Money was taken for it. Refund it first if it shouldn''t stand.'
    when p_request.status in ('confirmed', 'scheduled') then 'It''s booked.'
    when p_request.status = 'awaiting_payment' then 'A payment link is out, and the customer may still pay.'
    else null
  end;
$$;

revoke all on function private.booking_hide_refusal(public.booking_requests) from public, anon, authenticated;

/** Same phone number (last ten digits) or same email address. */
create or replace function private.booking_same_contact(a public.booking_requests, b public.booking_requests)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (
      char_length(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g')) >= 10
      and right(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g'), 10)
        = right(regexp_replace(coalesce(b.phone, ''), '[^0-9]', '', 'g'), 10)
    )
    or (
      position('@' in coalesce(a.email, '')) > 0
      and lower(trim(a.email)) = lower(trim(coalesce(b.email, '')))
    );
$$;

revoke all on function private.booking_same_contact(public.booking_requests, public.booking_requests) from public, anon, authenticated;

/**
 * Hide one request, as not a service request or as a duplicate of another.
 *
 * Shared by the business's own screen and the support console; each checks
 * who is asking before calling it. Nothing is sent to the customer.
 */
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
    raise exception using errcode = '40001', message = why;
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

revoke all on function private.hide_booking_request(uuid, text, uuid, uuid, boolean) from public, anon, authenticated;

/**
 * Keep one request and hide the others as its duplicates. All or nothing:
 * another business's request, a different person's, or one with work or money
 * behind it stops the lot.
 */
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
    raise exception using errcode = '40001', message = 'The one to keep is hidden. Bring it back first.';
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

revoke all on function private.hide_duplicate_booking_requests(uuid, uuid, uuid[], uuid, boolean) from public, anon, authenticated;

/** Bring a hidden request back, to the status it had. Returns that status. */
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
    raise exception using errcode = '40001', message = 'It isn''t hidden.';
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

revoke all on function private.restore_booking_request(uuid, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The business's own screen. Any member may do these, as any member may
-- dismiss a request today.

create or replace function public.hide_booking_not_service(p_request_id uuid, p_classification text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid;
begin
  if p_classification not in ('sales', 'spam', 'test', 'other') then
    raise exception using errcode = '22023', message = 'Say what it was.';
  end if;
  select organization_id into organization from public.booking_requests where id = p_request_id;
  if organization is null or not (select private.is_org_member(organization)) then
    raise exception using errcode = '42501', message = 'That request could not be found.';
  end if;
  perform private.hide_booking_request(p_request_id, p_classification, null, (select auth.uid()), false);
end;
$$;

revoke all on function public.hide_booking_not_service(uuid, text) from public, anon;
grant execute on function public.hide_booking_not_service(uuid, text) to authenticated;

create or replace function public.hide_duplicate_bookings(p_keep_id uuid, p_duplicate_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid;
begin
  select organization_id into organization from public.booking_requests where id = p_keep_id;
  if organization is null or not (select private.is_org_member(organization)) then
    raise exception using errcode = '42501', message = 'That request could not be found.';
  end if;
  return private.hide_duplicate_booking_requests(organization, p_keep_id, p_duplicate_ids, (select auth.uid()), false);
end;
$$;

revoke all on function public.hide_duplicate_bookings(uuid, uuid[]) from public, anon;
grant execute on function public.hide_duplicate_bookings(uuid, uuid[]) to authenticated;

create or replace function public.restore_booking(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid;
begin
  select organization_id into organization from public.booking_requests where id = p_request_id;
  if organization is null or not (select private.is_org_member(organization)) then
    raise exception using errcode = '42501', message = 'That request could not be found.';
  end if;
  return private.restore_booking_request(p_request_id, (select auth.uid()), false);
end;
$$;

revoke all on function public.restore_booking(uuid) from public, anon;
grant execute on function public.restore_booking(uuid) to authenticated;

/** "These are different requests": stop suggesting them as duplicates. */
create or replace function public.mark_bookings_distinct(p_request_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizations uuid[];
  marked integer;
begin
  select array_agg(distinct organization_id) into organizations
  from public.booking_requests where id = any(p_request_ids);
  if coalesce(cardinality(organizations), 0) <> 1 or not (select private.is_org_member(organizations[1])) then
    raise exception using errcode = '42501', message = 'Those requests could not be found.';
  end if;
  update public.booking_requests set duplicate_reviewed_at = now() where id = any(p_request_ids);
  get diagnostics marked = row_count;
  return marked;
end;
$$;

revoke all on function public.mark_bookings_distinct(uuid[]) from public, anon;
grant execute on function public.mark_bookings_distinct(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- The support console: the same three, as owner-only operations.

create or replace function public.admin_hide_booking_not_service(
  p_operation_id uuid,
  p_request_id uuid,
  p_classification text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  op public.support_operations := private.running_operation(p_operation_id, 'classify_booking', p_request_id);
begin
  if not (select private.is_platform_owner()) then
    raise exception using errcode = '42501', message = 'A support admin can look and check, not change.';
  end if;
  if p_classification not in ('sales', 'spam', 'test', 'other') then
    raise exception using errcode = '22023', message = 'Say what it was.';
  end if;
  if not exists (select 1 from public.booking_requests where id = p_request_id and organization_id = op.organization_id) then
    raise exception using errcode = '42501', message = 'That request belongs to another business.';
  end if;
  perform private.hide_booking_request(p_request_id, p_classification, null, (select auth.uid()), true);
end;
$$;

revoke all on function public.admin_hide_booking_not_service(uuid, uuid, text) from public, anon;
grant execute on function public.admin_hide_booking_not_service(uuid, uuid, text) to authenticated;

create or replace function public.admin_hide_duplicate_bookings(
  p_operation_id uuid,
  p_keep_id uuid,
  p_duplicate_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  op public.support_operations := private.running_operation(p_operation_id, 'merge_duplicates', p_keep_id);
begin
  if not (select private.is_platform_owner()) then
    raise exception using errcode = '42501', message = 'A support admin can look and check, not change.';
  end if;
  return private.hide_duplicate_booking_requests(op.organization_id, p_keep_id, p_duplicate_ids, (select auth.uid()), true);
end;
$$;

revoke all on function public.admin_hide_duplicate_bookings(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.admin_hide_duplicate_bookings(uuid, uuid, uuid[]) to authenticated;

create or replace function public.admin_restore_booking(p_operation_id uuid, p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  op public.support_operations := private.running_operation(p_operation_id, 'restore_booking', p_request_id);
begin
  if not (select private.is_platform_owner()) then
    raise exception using errcode = '42501', message = 'A support admin can look and check, not change.';
  end if;
  if not exists (select 1 from public.booking_requests where id = p_request_id and organization_id = op.organization_id) then
    raise exception using errcode = '42501', message = 'That request belongs to another business.';
  end if;
  return private.restore_booking_request(p_request_id, (select auth.uid()), true);
end;
$$;

revoke all on function public.admin_restore_booking(uuid, uuid) from public, anon;
grant execute on function public.admin_restore_booking(uuid, uuid) to authenticated;

/** The console's booking list, with what it needs to decide what may be hidden. */
create or replace function public.admin_booking_list(p_organization_id uuid, p_limit integer default 40)
returns table (
  booking_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  status text,
  intent text,
  source text,
  contact_name text,
  phone text,
  email text,
  description text,
  arrival_window_start timestamptz,
  arrival_window_end timestamptz,
  intake_answer_count integer,
  created_job_id uuid,
  notification_results jsonb,
  deposit_paid_at timestamptz,
  stripe_payment_intent_id text,
  payment_count integer,
  classification text,
  archived_at timestamptz,
  archived_by_email text,
  archived_status text,
  duplicate_of uuid,
  duplicate_reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    request.id,
    request.created_at,
    request.updated_at,
    request.status,
    request.intent,
    request.source,
    request.contact_name,
    request.phone,
    request.email,
    left(coalesce(request.description, ''), 300),
    request.arrival_window_start,
    request.arrival_window_end,
    coalesce(jsonb_array_length(request.intake_answers), 0),
    request.created_job_id,
    request.notification_results,
    request.deposit_paid_at,
    request.stripe_payment_intent_id,
    (select count(*)::integer from public.payments as payment where payment.booking_request_id = request.id),
    request.classification,
    request.archived_at,
    users.email::text,
    request.archived_status,
    request.duplicate_of,
    request.duplicate_reviewed_at
  from public.booking_requests as request
  left join auth.users as users on users.id = request.archived_by
  where request.organization_id = p_organization_id
    and (select private.is_platform_admin())
  order by request.created_at desc
  limit greatest(1, least(coalesce(p_limit, 40), 150));
$$;

revoke all on function public.admin_booking_list(uuid, integer) from public, anon;
grant execute on function public.admin_booking_list(uuid, integer) to authenticated;

/** Claim an operation before doing it. As before, with the booking tools added. */
create or replace function public.admin_operation_start(
  p_organization_id uuid,
  p_tool text,
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_key text,
  p_preview jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  why text := nullif(trim(coalesce(p_reason, '')), '');
  changes boolean := p_tool <> 'check_delivery';
  entry uuid;
begin
  if not (select private.is_platform_admin()) then
    raise exception using errcode = '42501', message = 'Not a platform admin.';
  end if;
  if p_tool not in (
    'check_delivery', 'retry_text', 'fix_recipient', 'classify_booking', 'merge_duplicates', 'restore_booking'
  ) then
    raise exception using errcode = '22023', message = 'Unknown tool.';
  end if;
  if changes and not (select private.is_platform_owner()) then
    raise exception using errcode = '42501', message = 'A support admin can look and check, not change.';
  end if;
  if changes and (why is null or char_length(why) < 3) then
    raise exception using errcode = '22023', message = 'Say why. The reason goes on the record.';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception using errcode = 'P0002', message = 'No such business.';
  end if;
  if char_length(coalesce(p_key, '')) < 8 then
    raise exception using errcode = '22023', message = 'No operation key.';
  end if;

  insert into public.support_operations (
    organization_id, actor_user_id, tool, target_type, target_id, reason, idempotency_key, preview
  )
  values (
    p_organization_id, (select auth.uid()), p_tool, left(coalesce(p_target_type, ''), 40), p_target_id,
    left(why, 300), left(p_key, 200), coalesce(p_preview, '{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing
  returning id into entry;

  if entry is null then
    raise exception using errcode = '23505', message = 'This was already done, or is being done now.';
  end if;

  perform private.record_admin_action(
    'operation.started',
    p_organization_id,
    jsonb_build_object('operation', entry, 'tool', p_tool, 'target', p_target_id, 'reason', left(why, 300))
  );

  return entry;
end;
$$;

revoke all on function public.admin_operation_start(uuid, text, text, uuid, text, text, jsonb) from public, anon;
grant execute on function public.admin_operation_start(uuid, text, text, uuid, text, text, jsonb) to authenticated;
