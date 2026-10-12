-- The support console's read-only workspace for one business.
--
-- Everything here reads; nothing changes a business's records. Each function
-- refuses (returns nothing) for anyone who is not a platform admin, like the
-- console functions before it, and none widens a tenant policy.
--
-- Private details (customer phone numbers, email addresses, the words of a
-- text) are returned to the server and hidden by the console until an admin
-- gives a reason to see them. That reason is an audit row, and the console only
-- shows them on a page that carries a fresh one of the admin's own.

/** Records which part of a business support opened. */
create or replace function public.admin_view_organization(p_organization_id uuid, p_tab text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    return false;
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    return false;
  end if;

  perform private.record_admin_action(
    'organization.viewed',
    p_organization_id,
    jsonb_build_object('tab', left(coalesce(p_tab, ''), 60))
  );
  return true;
end;
$$;

revoke all on function public.admin_view_organization(uuid, text) from public, anon;
grant execute on function public.admin_view_organization(uuid, text) to authenticated;

/**
 * Asking to see a business's private details, with a reason.
 *
 * Returns the audit row's id. The console puts it on the page address and
 * checks it with admin_reveal_valid, so private details appear only on a page
 * that was asked for, by this admin, in the last fifteen minutes.
 */
create or replace function public.admin_record_reveal(
  p_organization_id uuid,
  p_scope text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  why text := nullif(trim(coalesce(p_reason, '')), '');
  entry uuid;
begin
  if not (select private.is_platform_admin()) then
    raise exception using errcode = '42501', message = 'Not a platform admin.';
  end if;
  if why is null or char_length(why) < 3 then
    raise exception using errcode = '22023', message = 'Say why you need to see private details.';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception using errcode = 'P0002', message = 'No such business.';
  end if;

  insert into public.platform_admin_audit (admin_user_id, action, organization_id, detail)
  values (
    (select auth.uid()),
    'record.revealed',
    p_organization_id,
    jsonb_build_object('scope', left(coalesce(p_scope, ''), 80), 'reason', left(why, 200))
  )
  returning id into entry;

  return entry;
end;
$$;

revoke all on function public.admin_record_reveal(uuid, text, text) from public, anon;
grant execute on function public.admin_record_reveal(uuid, text, text) to authenticated;

/** Whether a reveal is this admin's own, for this business, and still fresh. */
create or replace function public.admin_reveal_valid(p_audit_id uuid, p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_platform_admin())
    and exists (
      select 1 from public.platform_admin_audit as entry
      where entry.id = p_audit_id
        and entry.action = 'record.revealed'
        and entry.organization_id = p_organization_id
        and entry.admin_user_id = (select auth.uid())
        and entry.created_at > now() - interval '15 minutes'
    );
$$;

revoke all on function public.admin_reveal_valid(uuid, uuid) from public, anon;
grant execute on function public.admin_reveal_valid(uuid, uuid) to authenticated;

/**
 * One search box for the whole platform.
 *
 * Finds a business by name or id, a person by email, a job or invoice by
 * number, a customer or booking by part of a phone number, and any record by
 * id. Results carry a masked phone at most. Every search is on the trail,
 * because a phone number search reaches across every business at once.
 */
create or replace function public.admin_search(p_query text)
returns table (
  kind text,
  organization_id uuid,
  organization_name text,
  ref text,
  title text,
  detail text,
  at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  q text := left(trim(coalesce(p_query, '')), 80);
  digits text;
  pattern text;
  number_only boolean;
  found_id uuid;
begin
  if not (select private.is_platform_admin()) or char_length(q) < 2 then
    return;
  end if;

  perform private.record_admin_action('search.run', null, jsonb_build_object('query', q));

  digits := regexp_replace(q, '\D', '', 'g');
  number_only := q ~ '^[0-9\s().+#-]+$';
  pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  if q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    found_id := q::uuid;
    return query
      select 'business', o.id, o.name, o.id::text, o.name, coalesce(o.base_city, ''), o.created_at
      from public.organizations as o where o.id = found_id;
    return query
      select 'job', j.organization_id, o.name, j.job_number::text, 'Job #' || j.job_number, j.status, j.created_at
      from public.jobs as j join public.organizations as o on o.id = j.organization_id where j.id = found_id;
    return query
      select 'invoice', i.organization_id, o.name, coalesce(j.job_number::text, ''), 'Invoice #' || i.invoice_number, i.status, i.created_at
      from public.invoices as i join public.organizations as o on o.id = i.organization_id
      left join public.jobs as j on j.id = i.job_id where i.id = found_id;
    return query
      select 'booking', b.organization_id, o.name, b.id::text, coalesce(nullif(b.contact_name, ''), 'Booking request'), b.status, b.created_at
      from public.booking_requests as b join public.organizations as o on o.id = b.organization_id where b.id = found_id;
    return query
      select 'customer', c.organization_id, o.name, c.id::text,
        coalesce(nullif(trim(c.company_name), ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Customer'),
        case when c.phone is null then '' else '••• ' || right(regexp_replace(c.phone, '\D', '', 'g'), 4) end, c.created_at
      from public.customers as c join public.organizations as o on o.id = c.organization_id where c.id = found_id;
    return query
      select 'person', m.organization_id, o.name, u.id::text, u.email::text, coalesce(m.role, 'no business'), u.created_at
      from auth.users as u
      left join public.organization_members as m on m.user_id = u.id
      left join public.organizations as o on o.id = m.organization_id
      where u.id = found_id;
    return;
  end if;

  if position('@' in q) > 0 then
    return query
      select 'person', m.organization_id, o.name, u.id::text, u.email::text, coalesce(m.role, 'no business'), u.created_at
      from auth.users as u
      left join public.organization_members as m on m.user_id = u.id
      left join public.organizations as o on o.id = m.organization_id
      where u.email ilike pattern
      order by u.created_at desc limit 20;
    return query
      select 'customer', c.organization_id, o.name, c.id::text,
        coalesce(nullif(trim(c.company_name), ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Customer'),
        'email on file', c.created_at
      from public.customers as c join public.organizations as o on o.id = c.organization_id
      where c.email ilike pattern
      order by c.created_at desc limit 20;
    return;
  end if;

  if number_only and q ~ '^#?[0-9]{1,9}$' then
    return query
      select 'job', j.organization_id, o.name, j.job_number::text,
        'Job #' || j.job_number || ' · ' ||
          coalesce(nullif(trim(c.company_name), ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Customer'),
        j.status, coalesce(j.scheduled_start, j.created_at)
      from public.jobs as j
      join public.organizations as o on o.id = j.organization_id
      left join public.customers as c on c.id = j.customer_id
      where j.job_number = digits::bigint
      order by j.created_at desc limit 20;
    return query
      select 'invoice', i.organization_id, o.name, coalesce(j.job_number::text, ''), 'Invoice #' || i.invoice_number, i.status, i.created_at
      from public.invoices as i
      join public.organizations as o on o.id = i.organization_id
      left join public.jobs as j on j.id = i.job_id
      where i.invoice_number = digits::bigint
      order by i.created_at desc limit 20;
  end if;

  if number_only and char_length(digits) >= 4 then
    return query
      select 'customer', c.organization_id, o.name, c.id::text,
        coalesce(nullif(trim(c.company_name), ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Customer'),
        '••• ' || right(regexp_replace(c.phone, '\D', '', 'g'), 4), c.created_at
      from public.customers as c join public.organizations as o on o.id = c.organization_id
      where regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || digits || '%'
      order by c.created_at desc limit 20;
    return query
      select 'booking', b.organization_id, o.name, b.id::text, coalesce(nullif(b.contact_name, ''), 'Booking request'),
        b.status || ' · ••• ' || right(regexp_replace(b.phone, '\D', '', 'g'), 4), b.created_at
      from public.booking_requests as b join public.organizations as o on o.id = b.organization_id
      where regexp_replace(coalesce(b.phone, ''), '\D', '', 'g') like '%' || digits || '%'
      order by b.created_at desc limit 20;
  end if;

  if not number_only then
    return query
      select 'business', o.id, o.name, o.id::text, o.name, coalesce(o.base_city, ''), o.created_at
      from public.organizations as o
      where o.name ilike pattern or coalesce(o.base_city, '') ilike pattern
      order by o.created_at desc limit 20;
    return query
      select 'customer', c.organization_id, o.name, c.id::text,
        coalesce(nullif(trim(c.company_name), ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Customer'),
        case when c.phone is null then '' else '••• ' || right(regexp_replace(c.phone, '\D', '', 'g'), 4) end, c.created_at
      from public.customers as c join public.organizations as o on o.id = c.organization_id
      where concat_ws(' ', c.first_name, c.last_name) ilike pattern or coalesce(c.company_name, '') ilike pattern
      order by c.created_at desc limit 20;
  end if;
end;
$$;

revoke all on function public.admin_search(text) from public, anon;
grant execute on function public.admin_search(text) to authenticated;

/** A business's jobs, newest first, with where each agreement stands. */
create or replace function public.admin_org_jobs(
  p_organization_id uuid,
  p_customer_id uuid default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  job_number bigint,
  status text,
  category text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  created_at timestamptz,
  canceled_at timestamptz,
  customer_id uuid,
  customer_name text,
  city text,
  technician_name text,
  agreement_sent boolean,
  agreement_signed boolean,
  invoice_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    j.id,
    j.job_number,
    j.status,
    j.category,
    j.scheduled_start,
    j.scheduled_end,
    j.created_at,
    j.canceled_at,
    j.customer_id,
    coalesce(nullif(trim(c.company_name), ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Customer'),
    coalesce(p.city, ''),
    coalesce(t.display_name, ''),
    coalesce(agreement.sent, false),
    coalesce(agreement.signed, false),
    (select count(*) from public.invoices as i where i.job_id = j.id and i.status <> 'void')
  from public.jobs as j
  left join public.customers as c on c.id = j.customer_id
  left join public.properties as p on p.id = j.property_id
  left join public.technicians as t on t.id = j.technician_id
  left join lateral (
    select
      (contract.status = 'sent' or contract.signature_sent_at is not null) as sent,
      (contract.status = 'signed' or contract.signed_at is not null) as signed
    from public.contracts as contract
    where contract.job_id = j.id
      and contract.status <> 'void'
      and coalesce(contract.kind, 'agreement') <> 'change_order'
    order by contract.created_at desc
    limit 1
  ) as agreement on true
  where j.organization_id = p_organization_id
    and (p_customer_id is null or j.customer_id = p_customer_id)
    and (select private.is_platform_admin())
  order by coalesce(j.scheduled_start, j.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 100), 300));
$$;

revoke all on function public.admin_org_jobs(uuid, uuid, integer) from public, anon;
grant execute on function public.admin_org_jobs(uuid, uuid, integer) to authenticated;

/** A business's texts, newest first, with delivery status. */
create or replace function public.admin_org_messages(p_organization_id uuid, p_limit integer default 100)
returns table (
  id uuid,
  created_at timestamptz,
  direction text,
  status text,
  error_code text,
  error_detail text,
  sent_at timestamptz,
  delivered_at timestamptz,
  body text,
  provider_message_id text,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  job_number bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    m.created_at,
    m.direction,
    m.status,
    m.error_code,
    m.error_detail,
    m.sent_at,
    m.delivered_at,
    m.body,
    m.provider_message_id,
    c.id,
    coalesce(nullif(trim(c.company_name), ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), ''),
    coalesce(c.phone, ''),
    j.job_number
  from public.messages as m
  join public.conversations as conversation on conversation.id = m.conversation_id
  left join public.customers as c on c.id = conversation.customer_id
  left join public.jobs as j on j.id = conversation.job_id
  where m.organization_id = p_organization_id
    and (select private.is_platform_admin())
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 300));
$$;

revoke all on function public.admin_org_messages(uuid, integer) from public, anon;
grant execute on function public.admin_org_messages(uuid, integer) to authenticated;

/** A business's invoices, newest first. */
create or replace function public.admin_org_invoices(p_organization_id uuid, p_limit integer default 100)
returns table (
  id uuid,
  invoice_number bigint,
  job_number bigint,
  status text,
  subtotal_cents integer,
  diagnostic_credit_cents integer,
  tax_cents integer,
  total_cents integer,
  balance_due_cents integer,
  due_at timestamptz,
  paid_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz,
  stripe_invoice_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id, i.invoice_number, j.job_number, i.status, i.subtotal_cents, i.diagnostic_credit_cents, i.tax_cents,
    i.total_cents, i.balance_due_cents, i.due_at, i.paid_at, i.last_sent_at, i.created_at, i.stripe_invoice_status
  from public.invoices as i
  left join public.jobs as j on j.id = i.job_id
  where i.organization_id = p_organization_id
    and (select private.is_platform_admin())
  order by i.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 300));
$$;

revoke all on function public.admin_org_invoices(uuid, integer) from public, anon;
grant execute on function public.admin_org_invoices(uuid, integer) to authenticated;

/**
 * A business's payments, newest first.
 *
 * Provider references are shortened to their last characters: enough to find
 * the payment in Stripe, not a full identifier to paste around.
 */
create or replace function public.admin_org_payments(p_organization_id uuid, p_limit integer default 100)
returns table (
  id uuid,
  provider text,
  status text,
  amount_cents integer,
  currency text,
  paid_at timestamptz,
  created_at timestamptz,
  job_number bigint,
  booking_request_id uuid,
  provider_ref text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pay.id, pay.provider, pay.status, pay.amount_cents, pay.currency, pay.paid_at, pay.created_at, j.job_number,
    pay.booking_request_id,
    case
      when pay.provider_payment_intent_id is not null then '…' || right(pay.provider_payment_intent_id, 6)
      when pay.provider_checkout_session_id is not null then '…' || right(pay.provider_checkout_session_id, 6)
      else ''
    end
  from public.payments as pay
  left join public.jobs as j on j.id = pay.job_id
  where pay.organization_id = p_organization_id
    and (select private.is_platform_admin())
  order by pay.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 300));
$$;

revoke all on function public.admin_org_payments(uuid, integer) from public, anon;
grant execute on function public.admin_org_payments(uuid, integer) to authenticated;

/** What happened in a business, from its own job history. */
create or replace function public.admin_org_activity(p_organization_id uuid, p_limit integer default 100)
returns table (
  id uuid,
  created_at timestamptz,
  event_type text,
  label text,
  job_number bigint,
  actor_email text,
  metadata jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.created_at, a.event_type, a.label, j.job_number, u.email::text, a.metadata
  from public.activity_events as a
  left join public.jobs as j on j.id = a.job_id
  left join auth.users as u on u.id = a.actor_user_id
  where a.organization_id = p_organization_id
    and (select private.is_platform_admin())
  order by a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 300));
$$;

revoke all on function public.admin_org_activity(uuid, integer) from public, anon;
grant execute on function public.admin_org_activity(uuid, integer) to authenticated;

/**
 * One job, from the request that created it to the last payment.
 *
 * In the order things happen: booking, approval contracts, schedule, lines
 * (with what stock each took), invoices, payments, texts, and the job's own
 * history. One call, so the page is a single read of one moment.
 */
create or replace function public.admin_job_trace(p_organization_id uuid, p_job_number bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  job public.jobs;
begin
  if not (select private.is_platform_admin()) then
    return null;
  end if;

  select * into job from public.jobs
  where organization_id = p_organization_id and job_number = p_job_number;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'job', jsonb_build_object(
      'id', job.id,
      'job_number', job.job_number,
      'status', job.status,
      'category', job.category,
      'description', coalesce(nullif(job.ai_summary, ''), job.customer_description, ''),
      'scheduled_start', job.scheduled_start,
      'scheduled_end', job.scheduled_end,
      'created_at', job.created_at,
      'updated_at', job.updated_at,
      'canceled_at', job.canceled_at,
      'cancellation_reason', job.cancellation_reason,
      'diagnostic_fee_cents', job.diagnostic_fee_cents,
      'diagnostic_paid', job.diagnostic_paid,
      'customer_notifications', coalesce(job.customer_notifications, '[]'::jsonb),
      'technician', (select t.display_name from public.technicians as t where t.id = job.technician_id),
      'follow_up_of', (select f.job_number from public.jobs as f where f.id = job.follow_up_of)
    ),
    'customer', (
      select jsonb_build_object(
        'id', c.id,
        'name', coalesce(nullif(trim(c.company_name), ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Customer'),
        'phone', coalesce(c.phone, ''),
        'email', coalesce(c.email, '')
      )
      from public.customers as c where c.id = job.customer_id
    ),
    'address', (
      select concat_ws(', ', p.address_line_1, p.address_line_2, p.city, p.state, p.postal_code)
      from public.properties as p where p.id = job.property_id
    ),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'created_at', b.created_at, 'status', b.status, 'source', b.source,
        'deposit_cents', b.deposit_cents, 'deposit_paid_at', b.deposit_paid_at,
        'notification_results', coalesce(b.notification_results, '[]'::jsonb)
      ) order by b.created_at)
      from public.booking_requests as b where b.created_job_id = job.id
    ), '[]'::jsonb),
    'contracts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ct.id, 'kind', coalesce(ct.kind, 'agreement'), 'status', ct.status, 'created_at', ct.created_at,
        'sent_at', ct.signature_sent_at, 'signed_at', ct.signed_at, 'signer', ct.signature_name,
        'method', ct.signature_method, 'provider', ct.signature_provider,
        'contractor_signed_at', ct.contractor_signed_at, 'body_fixed', ct.signed_body_hash is not null,
        'total_cents', ct.total_cents, 'deposit_cents', ct.deposit_cents, 'deposit_paid', ct.deposit_paid
      ) order by ct.created_at)
      from public.contracts as ct where ct.job_id = job.id
    ), '[]'::jsonb),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'kind', l.kind, 'description', l.description, 'quantity', l.quantity, 'unit', l.unit,
        'unit_price_cents', l.unit_price_cents, 'unit_cost_cents', l.unit_cost_cents,
        'invoice_id', l.invoice_id, 'from_stock', l.inventory_item_id is not null, 'created_at', l.created_at,
        'stock_moved', (select coalesce(sum(mv.quantity), 0) from public.inventory_movements as mv where mv.job_line_item_id = l.id)
      ) order by l.created_at)
      from public.job_line_items as l where l.job_id = job.id
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'invoice_number', i.invoice_number, 'status', i.status,
        'subtotal_cents', i.subtotal_cents, 'diagnostic_credit_cents', i.diagnostic_credit_cents,
        'tax_cents', i.tax_cents, 'total_cents', i.total_cents, 'balance_due_cents', i.balance_due_cents,
        'due_at', i.due_at, 'paid_at', i.paid_at, 'last_sent_at', i.last_sent_at, 'created_at', i.created_at,
        'deliveries', coalesce(i.deliveries, '[]'::jsonb)
      ) order by i.created_at)
      from public.invoices as i where i.job_id = job.id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pay.id, 'provider', pay.provider, 'status', pay.status, 'amount_cents', pay.amount_cents,
        'paid_at', pay.paid_at, 'created_at', pay.created_at, 'for_booking', pay.booking_request_id is not null,
        'provider_ref', case
          when pay.provider_payment_intent_id is not null then '…' || right(pay.provider_payment_intent_id, 6)
          when pay.provider_checkout_session_id is not null then '…' || right(pay.provider_checkout_session_id, 6)
          else '' end
      ) order by pay.created_at)
      from public.payments as pay
      where pay.job_id = job.id
         or pay.booking_request_id in (select b.id from public.booking_requests as b where b.created_job_id = job.id)
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(row_to_json(recent)::jsonb order by recent.created_at)
      from (
        select m.id, m.created_at, m.direction, m.status, m.error_code, m.sent_at, m.delivered_at, m.body,
          (m.provider_message_id is not null) as has_provider_ref
        from public.messages as m
        join public.conversations as conversation on conversation.id = m.conversation_id
        where m.organization_id = p_organization_id
          and (conversation.job_id = job.id or (job.customer_id is not null and conversation.customer_id = job.customer_id))
        order by m.created_at desc
        limit 60
      ) as recent
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'created_at', a.created_at, 'event_type', a.event_type, 'label', a.label, 'metadata', a.metadata
      ) order by a.created_at)
      from public.activity_events as a where a.job_id = job.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_job_trace(uuid, bigint) from public, anon;
grant execute on function public.admin_job_trace(uuid, bigint) to authenticated;
