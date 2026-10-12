-- Recovery tools for the support console, on the record.
--
-- Until now the console could only read, or hand an admin the whole business
-- for an hour. This adds narrow, single-purpose actions, each one an operation
-- row: who did it, to which record, why, what they were shown first, and what
-- came of it. The row is claimed before anything happens, and its key is
-- unique, so the same action cannot run twice — two tabs, two admins, or a
-- double click all end at the same row.
--
-- Two kinds of platform admin from here on:
--   owner   — can look, check, and run the tools that change things;
--   support — can look and check, never change.
-- Everybody already an admin stays an owner.
--
-- Every write to a business's records goes through a function below that
-- re-reads the operation and the record, and refuses if either is not what the
-- preview showed. Nothing widens a tenant policy, and the app needs no
-- all-powerful key to run a tool.

alter table public.platform_admins
  add column if not exists role text not null default 'owner';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'platform_admins_role_check' and conrelid = 'public.platform_admins'::regclass
  ) then
    alter table public.platform_admins
      add constraint platform_admins_role_check check (role in ('owner', 'support'));
  end if;
end;
$$;

/** An admin who may change things, not only look. */
create or replace function private.is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.platform_admins as admin
      where admin.user_id = (select auth.uid()) and admin.role = 'owner'
    );
$$;

revoke all on function private.is_platform_owner() from public, anon;
grant execute on function private.is_platform_owner() to authenticated;

/** The signed-in admin's role, or null for anybody else. */
create or replace function public.admin_my_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select admin.role from public.platform_admins as admin where admin.user_id = (select auth.uid());
$$;

revoke all on function public.admin_my_role() from public, anon;
grant execute on function public.admin_my_role() to authenticated;

create table if not exists public.support_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  tool text not null,
  target_type text not null,
  target_id uuid not null,
  reason text,
  -- Unique, so the same action on the same record cannot be claimed twice.
  idempotency_key text not null unique,
  state text not null default 'attempted'
    check (state in ('attempted', 'accepted', 'verified', 'failed', 'unknown')),
  -- What the admin was shown before choosing to go ahead.
  preview jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists support_operations_org_created_idx
  on public.support_operations(organization_id, created_at desc);
create index if not exists support_operations_target_idx
  on public.support_operations(target_id);

alter table public.support_operations enable row level security;

-- Readable by admins; written only by the functions below.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'support_operations'
      and policyname = 'Admins can see support operations'
  ) then
    create policy "Admins can see support operations"
    on public.support_operations for select
    to authenticated
    using ((select private.is_platform_admin()));
  end if;
end;
$$;

grant select on table public.support_operations to authenticated;

/**
 * Claim an operation before doing it.
 *
 * Returns the operation's id. Refuses a second claim of the same key (the
 * action already ran, or is running), a tool that changes things for a support
 * admin, and a change with no reason. Check delivery only reads the provider
 * and reconciles a status, so any admin may run it without one.
 */
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
  if p_tool not in ('check_delivery', 'retry_text', 'fix_recipient') then
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

/** Record how an operation ended. Once, and only by whoever started it. */
create or replace function public.admin_operation_finish(
  p_operation_id uuid,
  p_state text,
  p_result jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  finished public.support_operations;
begin
  if p_state not in ('accepted', 'verified', 'failed', 'unknown') then
    raise exception using errcode = '22023', message = 'Unknown outcome.';
  end if;

  update public.support_operations
  set state = p_state, result = coalesce(p_result, '{}'::jsonb), finished_at = now()
  where id = p_operation_id
    and actor_user_id = (select auth.uid())
    and state = 'attempted'
    and finished_at is null
  returning * into finished;

  if finished.id is null then
    return false;
  end if;

  perform private.record_admin_action(
    'operation.finished',
    finished.organization_id,
    jsonb_build_object('operation', finished.id, 'tool', finished.tool, 'outcome', p_state)
  );
  return true;
end;
$$;

revoke all on function public.admin_operation_finish(uuid, text, jsonb) from public, anon;
grant execute on function public.admin_operation_finish(uuid, text, jsonb) to authenticated;

/** The operation this admin is running now, for the functions that do the work. */
create or replace function private.running_operation(p_operation_id uuid, p_tool text, p_target uuid)
returns public.support_operations
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  found public.support_operations;
begin
  select * into found from public.support_operations
  where id = p_operation_id
    and actor_user_id = (select auth.uid())
    and tool = p_tool
    and target_id = p_target
    and state = 'attempted'
    and finished_at is null;
  if found.id is null then
    raise exception using errcode = '42501', message = 'Not an operation you are running.';
  end if;
  return found;
end;
$$;

revoke all on function private.running_operation(uuid, text, uuid) from public, anon;

/**
 * Everything the console needs to decide about one text, read in one moment.
 *
 * The rules that decide whether it can be sent again live in the app
 * (src/lib/recovery/text-recovery.ts); this gathers their inputs.
 */
create or replace function public.admin_message_facts(p_organization_id uuid, p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  message public.messages;
  conversation public.conversations;
begin
  if not (select private.is_platform_admin()) then
    return null;
  end if;

  select * into message from public.messages where id = p_message_id;
  if message.id is null or message.organization_id <> p_organization_id then
    return null;
  end if;
  select * into conversation from public.conversations where id = message.conversation_id;

  return jsonb_build_object(
    'message', jsonb_build_object(
      'id', message.id, 'organization_id', message.organization_id, 'conversation_id', message.conversation_id,
      'direction', message.direction, 'status', message.status, 'error_code', message.error_code,
      'error_detail', message.error_detail, 'body', message.body, 'created_at', message.created_at,
      'updated_at', message.updated_at, 'sent_at', message.sent_at, 'delivered_at', message.delivered_at,
      'provider_message_id', message.provider_message_id
    ),
    'customer', (
      select jsonb_build_object(
        'id', c.id,
        'name', coalesce(nullif(trim(c.company_name), ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Customer'),
        'phone', coalesce(c.phone, '')
      )
      from public.customers as c where c.id = conversation.customer_id
    ),
    'consent', (
      select jsonb_build_object('opted_in_at', consent.opted_in_at, 'opted_out_at', consent.opted_out_at)
      from public.messaging_consent as consent
      where consent.organization_id = p_organization_id
        and consent.customer_id = conversation.customer_id
        and consent.channel = 'sms' and consent.scope = 'transactional'
    ),
    'job', (
      select jsonb_build_object('job_number', j.job_number, 'status', j.status)
      from public.jobs as j where j.id = conversation.job_id
    ),
    'messaging', (
      select jsonb_build_object(
        'service_sid', coalesce(settings.messaging_service_sid, ''),
        'quiet_start', coalesce(settings.quiet_hours_start::text, '21:00:00'),
        'quiet_end', coalesce(settings.quiet_hours_end::text, '08:00:00'),
        'timezone', coalesce(organization.timezone, 'America/Los_Angeles')
      )
      from public.organizations as organization
      left join public.messaging_settings as settings on settings.organization_id = organization.id
      where organization.id = p_organization_id
    ),
    'later_sends', coalesce((
      select jsonb_agg(jsonb_build_object('status', later.status, 'same_body', later.body = message.body, 'created_at', later.created_at))
      from public.messages as later
      where later.conversation_id = message.conversation_id
        and later.direction = 'outbound'
        and later.created_at > message.created_at
        and later.id <> message.id
    ), '[]'::jsonb),
    'recipient_fixed_at', (
      select max(op.finished_at) from public.support_operations as op
      where op.tool = 'fix_recipient' and op.state in ('accepted', 'verified')
        and op.target_id = conversation.customer_id and op.finished_at > message.created_at
    ),
    'operations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', op.id, 'tool', op.tool, 'state', op.state, 'created_at', op.created_at,
        'finished_at', op.finished_at, 'reason', op.reason, 'result', op.result, 'actor', users.email
      ) order by op.created_at desc)
      from public.support_operations as op
      left join auth.users as users on users.id = op.actor_user_id
      where op.target_id = message.id
        -- A number corrected from this text's page targets the customer, but
        -- belongs in this text's story too.
        or (op.tool = 'fix_recipient' and op.target_id = conversation.customer_id and op.preview->>'message' = message.id::text)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_message_facts(uuid, uuid) from public, anon;
grant execute on function public.admin_message_facts(uuid, uuid) to authenticated;

/**
 * Record what Twilio says now about a text, as part of a Check delivery.
 *
 * Only ever moves a status forward: a "sent" that arrives after "delivered"
 * is ignored, the same rule the status callback follows.
 */
create or replace function public.admin_apply_delivery_status(
  p_operation_id uuid,
  p_message_id uuid,
  p_status text,
  p_error_code text default null,
  p_error_detail text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  op public.support_operations := private.running_operation(p_operation_id, 'check_delivery', p_message_id);
  current_status text;
begin
  select status into current_status from public.messages
  where id = p_message_id and organization_id = op.organization_id;
  if current_status is null then
    raise exception using errcode = '42501', message = 'That text is not in this business.';
  end if;

  if p_status not in ('queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed') then
    return current_status;
  end if;
  if p_status = 'sent' and current_status not in ('queued', 'sending') then
    return current_status;
  end if;
  if p_status = current_status then
    return current_status;
  end if;

  update public.messages
  set status = p_status,
      delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
      error_code = case when p_status in ('failed', 'undelivered') then left(p_error_code, 40) else error_code end,
      error_detail = case when p_status in ('failed', 'undelivered') then left(p_error_detail, 500) else error_detail end
  where id = p_message_id;

  return p_status;
end;
$$;

revoke all on function public.admin_apply_delivery_status(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.admin_apply_delivery_status(uuid, uuid, text, text, text) to authenticated;

/**
 * Write down a retried text before it goes, as the app does for every text.
 *
 * Re-checks what the preview promised, here, at the last moment: the original
 * still failed, the customer's number is the one shown, and they have not
 * opted out. Returns the new message's id; the app then sends it.
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
    raise exception using errcode = '40001', message = 'That text no longer looks failed.';
  end if;

  select * into conversation from public.conversations where id = original.conversation_id;
  select coalesce(c.phone, '') into phone from public.customers as c where c.id = conversation.customer_id;
  if phone is distinct from coalesce(p_expected_phone, '') then
    raise exception using errcode = '40001', message = 'The customer''s number changed since the preview.';
  end if;

  select exists (
    select 1 from public.messaging_consent as consent
    where consent.organization_id = op.organization_id
      and consent.customer_id = conversation.customer_id
      and consent.channel = 'sms' and consent.scope = 'transactional'
      and consent.opted_in_at is not null and consent.opted_out_at is null
  ) into consent_ok;
  if not consent_ok then
    raise exception using errcode = '40001', message = 'The customer has not agreed to texts, or replied STOP.';
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

revoke all on function public.admin_retry_text_begin(uuid, uuid, text) from public, anon;
grant execute on function public.admin_retry_text_begin(uuid, uuid, text) to authenticated;

/** What Twilio said about the retried text. */
create or replace function public.admin_retry_text_result(
  p_operation_id uuid,
  p_message_id uuid,
  p_new_message_id uuid,
  p_ok boolean,
  p_status text,
  p_provider_message_id text,
  p_error_code text,
  p_error_detail text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  op public.support_operations := private.running_operation(p_operation_id, 'retry_text', p_message_id);
  updated integer;
begin
  update public.messages
  set status = case
        when p_ok and p_status = 'delivered' then 'delivered'
        when p_ok then 'sent'
        when p_error_code = 'network_error' then 'sending'
        else 'failed' end,
      provider_message_id = case when p_ok then left(p_provider_message_id, 80) else provider_message_id end,
      sent_at = case when p_ok then now() else sent_at end,
      error_code = case when p_ok then null else left(p_error_code, 40) end,
      error_detail = case when p_ok then null else left(p_error_detail, 500) end
  where id = p_new_message_id
    and organization_id = op.organization_id
    and conversation_id = (select m.conversation_id from public.messages as m where m.id = p_message_id);
  get diagnostics updated = row_count;

  if p_ok and updated > 0 then
    update public.conversations set last_message_at = now()
    where id = (select m.conversation_id from public.messages as m where m.id = p_new_message_id);
  end if;

  -- 21610 is the carrier's STOP list: the customer opted out somewhere this
  -- system did not see. Bring the record in line, as the app's own send does.
  if not p_ok and p_error_code = '21610' then
    update public.messaging_consent
    set opted_out_at = now()
    where organization_id = op.organization_id
      and channel = 'sms' and scope = 'transactional'
      and customer_id = (
        select conversation.customer_id
        from public.messages as m
        join public.conversations as conversation on conversation.id = m.conversation_id
        where m.id = p_message_id
      );
  end if;
  return updated > 0;
end;
$$;

revoke all on function public.admin_retry_text_result(uuid, uuid, uuid, boolean, text, text, text, text) from public, anon;
grant execute on function public.admin_retry_text_result(uuid, uuid, uuid, boolean, text, text, text, text) to authenticated;

/**
 * Correct one customer's phone number.
 *
 * Refuses if the number on file is no longer the one the preview showed, so
 * two people fixing the same record cannot overwrite each other blind. The
 * business's own history records the change, by Volteira support, with the
 * number it replaced, so they can see it and undo it.
 */
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
    raise exception using errcode = '40001', message = 'The number changed since the preview.';
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

revoke all on function public.admin_fix_customer_phone(uuid, uuid, text, text) from public, anon;
grant execute on function public.admin_fix_customer_phone(uuid, uuid, text, text) to authenticated;

/** The recovery history, newest first, optionally for one business or tool. */
create or replace function public.admin_operations(
  p_organization_id uuid default null,
  p_tool text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  organization_id uuid,
  organization_name text,
  organization_timezone text,
  actor_email text,
  tool text,
  target_type text,
  target_id uuid,
  reason text,
  state text,
  preview jsonb,
  result jsonb,
  created_at timestamptz,
  finished_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    op.id, op.organization_id, organization.name, coalesce(organization.timezone, 'America/Los_Angeles'),
    users.email::text, op.tool, op.target_type, op.target_id, op.reason, op.state, op.preview, op.result,
    op.created_at, op.finished_at
  from public.support_operations as op
  join public.organizations as organization on organization.id = op.organization_id
  left join auth.users as users on users.id = op.actor_user_id
  where (select private.is_platform_admin())
    and (p_organization_id is null or op.organization_id = p_organization_id)
    and (p_tool is null or op.tool = p_tool)
  order by op.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 300));
$$;

revoke all on function public.admin_operations(uuid, text, integer) from public, anon;
grant execute on function public.admin_operations(uuid, text, integer) to authenticated;

/**
 * Working inside a business and inviting into one change things, so both now
 * need an owner. Unchanged otherwise.
 */
create or replace function public.admin_begin_impersonation(
  p_organization_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  already_member boolean;
  session_id uuid;
  why text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not (select private.is_platform_admin()) then
    raise exception using errcode = '42501', message = 'Not a platform admin.';
  end if;
  if not (select private.is_platform_owner()) then
    raise exception using errcode = '42501', message = 'A support admin can look and check, not change.';
  end if;

  if why is null or char_length(why) < 3 then
    raise exception using errcode = '22023', message = 'Say why you need to make changes in this business.';
  end if;

  if not exists (
    select 1 from public.organizations
    where id = p_organization_id and archived_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'No such business.';
  end if;

  perform public.admin_end_impersonation();

  select exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = actor
  ) into already_member;

  insert into public.impersonation_sessions (
    admin_user_id, organization_id, granted_membership, reason
  )
  values (actor, p_organization_id, not already_member, left(why, 200))
  returning id into session_id;

  if not already_member then
    insert into public.organization_members (organization_id, user_id, role, impersonation_session_id)
    values (p_organization_id, actor, 'admin', session_id);
  end if;

  perform private.record_admin_action(
    'impersonation.started',
    p_organization_id,
    jsonb_build_object('session', session_id, 'granted_membership', not already_member, 'reason', left(why, 200))
  );

  return session_id;
end;
$$;

revoke all on function public.admin_begin_impersonation(uuid, text) from public, anon;
grant execute on function public.admin_begin_impersonation(uuid, text) to authenticated;

create or replace function public.admin_invite_to_organization(
  p_organization_id uuid,
  p_email text,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := lower(trim(p_email));
  new_token uuid;
begin
  if not (select private.is_platform_admin()) then
    raise exception using errcode = '42501', message = 'Not a platform admin.';
  end if;
  if not (select private.is_platform_owner()) then
    raise exception using errcode = '42501', message = 'A support admin can look and check, not change.';
  end if;

  if normalized !~ '^[^@[:space:]]+@[^@.[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception using errcode = '22023', message = 'That is not an email address.';
  end if;

  if p_role not in ('owner', 'admin', 'dispatcher', 'technician', 'accountant') then
    raise exception using errcode = '22023', message = 'Unknown role.';
  end if;

  -- Replace any live invitation, so the newest link is the one that works.
  update public.organization_invitations
  set revoked_at = now()
  where organization_id = p_organization_id
    and email = normalized
    and accepted_at is null
    and revoked_at is null;

  insert into public.organization_invitations (organization_id, email, role, invited_by)
  values (p_organization_id, normalized, p_role, (select auth.uid()))
  returning token into new_token;

  perform private.record_admin_action(
    'invitation.sent',
    p_organization_id,
    jsonb_build_object('email', normalized, 'role', p_role)
  );

  return new_token;
end;
$$;

revoke all on function public.admin_invite_to_organization(uuid, text, text) from public, anon;
grant execute on function public.admin_invite_to_organization(uuid, text, text) to authenticated;
