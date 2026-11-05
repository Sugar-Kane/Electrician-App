-- Removing a business's data from the admin console: one record, all of a
-- business's records, or the whole business.
--
-- The work is done by functions in `private`, which nobody can call from the
-- API. The `admin_*` functions in `public` are the only way in: each requires
-- a platform owner, a reason, and (for the two that remove everything) the
-- business's name typed back, and writes what it did to the admin audit log.
--
-- Records go children first. Many links clear themselves when their parent is
-- deleted (ON DELETE SET NULL), and that clearing is an UPDATE, which signed
-- contracts refuse; deleting the children before their parents means no
-- protected row is ever updated on the way out.
--
-- Files cannot be deleted from SQL (Supabase Storage refuses it), so each
-- function returns the storage paths of the documents it removed, and the
-- server deletes those files through the Storage API.
--
-- A wipe keeps the business itself: its members and logins, settings, hours,
-- message templates, contract template and saved signature, texting number,
-- stock catalog, supply stops, Stripe and Google connections, and its own
-- business documents (anything not filed against a customer, address, job,
-- invoice, estimate or contract). It removes customers, addresses, jobs,
-- estimates, invoices, payments, contracts, bookings, texts, calls, files
-- filed against those, the activity log and the assistant's notes.

/** Delete one job and everything filed under it. Returns the storage paths of its files. */
create or replace function private.delete_job_records(p_organization_id uuid, p_job_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  paths text[];
begin
  select coalesce(array_agg(d.storage_path), '{}') into paths
  from public.documents as d
  where d.organization_id = p_organization_id
    and (
      d.job_id = p_job_id
      or d.invoice_id in (select id from public.invoices where job_id = p_job_id and organization_id = p_organization_id)
      or d.contract_id in (select id from public.contracts where job_id = p_job_id and organization_id = p_organization_id)
      or d.estimate_id in (select id from public.estimates where job_id = p_job_id and organization_id = p_organization_id)
    );

  delete from public.documents as d
  where d.organization_id = p_organization_id and d.storage_path = any(paths);

  delete from public.contracts where organization_id = p_organization_id and job_id = p_job_id;
  delete from public.invoice_online_payments where organization_id = p_organization_id and job_id = p_job_id;
  delete from public.invoice_payments where organization_id = p_organization_id and job_id = p_job_id;
  delete from public.payments where organization_id = p_organization_id and job_id = p_job_id;
  delete from public.inventory_movements where organization_id = p_organization_id and job_id = p_job_id;
  delete from public.job_line_items where organization_id = p_organization_id and job_id = p_job_id;
  delete from public.invoices where organization_id = p_organization_id and job_id = p_job_id;
  delete from public.estimates where organization_id = p_organization_id and job_id = p_job_id;
  delete from public.supplier_order_items
    where organization_id = p_organization_id
      and order_id in (select id from public.supplier_orders where job_id = p_job_id);
  delete from public.supplier_orders where organization_id = p_organization_id and job_id = p_job_id;
  delete from public.buy_list_items where organization_id = p_organization_id and job_id = p_job_id;
  delete from public.activity_events where organization_id = p_organization_id and job_id = p_job_id;
  delete from public.mcp_call_log where organization_id = p_organization_id and job_id = p_job_id;
  delete from public.document_folders
    where organization_id = p_organization_id and folder_type = 'job' and entity_id = p_job_id;
  update public.jobs set follow_up_of = null
    where organization_id = p_organization_id and follow_up_of = p_job_id;
  delete from public.jobs where organization_id = p_organization_id and id = p_job_id;

  return paths;
end;
$$;

/** Delete one customer, their addresses, jobs, bookings, texts and calls. */
create or replace function private.delete_customer_records(p_organization_id uuid, p_customer_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  paths text[] := '{}';
  job record;
  more text[];
begin
  for job in
    select id from public.jobs where organization_id = p_organization_id and customer_id = p_customer_id
  loop
    paths := paths || private.delete_job_records(p_organization_id, job.id);
  end loop;

  select coalesce(array_agg(d.storage_path), '{}') into more
  from public.documents as d
  where d.organization_id = p_organization_id
    and (d.customer_id = p_customer_id
      or d.property_id in (select id from public.properties where customer_id = p_customer_id));
  delete from public.documents as d where d.organization_id = p_organization_id and d.storage_path = any(more);
  paths := paths || more;

  delete from public.voice_calls where organization_id = p_organization_id and customer_id = p_customer_id;
  delete from public.booking_requests where organization_id = p_organization_id and customer_id = p_customer_id;
  delete from public.inbound_leads
    where organization_id = p_organization_id
      and conversation_id in (select id from public.inbound_conversations where customer_id = p_customer_id);
  delete from public.inbound_calls
    where organization_id = p_organization_id
      and conversation_id in (select id from public.inbound_conversations where customer_id = p_customer_id);
  delete from public.inbound_conversations where organization_id = p_organization_id and customer_id = p_customer_id;
  delete from public.conversations where organization_id = p_organization_id and customer_id = p_customer_id;
  delete from public.activity_events where organization_id = p_organization_id and customer_id = p_customer_id;
  -- Addresses, texting consent and the Stripe customer go with the customer (ON DELETE CASCADE).
  delete from public.customers where organization_id = p_organization_id and id = p_customer_id;

  return paths;
end;
$$;

/** Delete every customer-side record of a business, keeping the business and its setup. */
create or replace function private.wipe_organization_data(p_organization_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  paths text[];
begin
  select coalesce(array_agg(d.storage_path), '{}') into paths
  from public.documents as d
  where d.organization_id = p_organization_id
    and (d.customer_id is not null or d.property_id is not null or d.job_id is not null
      or d.invoice_id is not null or d.estimate_id is not null or d.contract_id is not null);
  delete from public.documents as d where d.organization_id = p_organization_id and d.storage_path = any(paths);

  delete from public.contracts where organization_id = p_organization_id;
  delete from public.invoice_online_payments where organization_id = p_organization_id;
  delete from public.invoice_payments where organization_id = p_organization_id;
  delete from public.payments where organization_id = p_organization_id;
  delete from public.inventory_movements where organization_id = p_organization_id and (job_id is not null or job_line_item_id is not null);
  delete from public.job_line_items where organization_id = p_organization_id;
  delete from public.invoices where organization_id = p_organization_id;
  delete from public.estimates where organization_id = p_organization_id;
  delete from public.journal_post_revisions where organization_id = p_organization_id;
  delete from public.journal_posts where organization_id = p_organization_id;
  delete from public.job_material_lists where organization_id = p_organization_id;
  delete from public.job_technician_progress where organization_id = p_organization_id;
  delete from public.supplier_order_items where organization_id = p_organization_id;
  delete from public.supplier_orders where organization_id = p_organization_id;
  delete from public.supplier_product_selections where organization_id = p_organization_id;
  delete from public.buy_list_items where organization_id = p_organization_id;
  delete from public.booking_calendar_events where organization_id = p_organization_id;
  delete from public.voice_calls where organization_id = p_organization_id;
  delete from public.mcp_call_log where organization_id = p_organization_id;
  delete from public.activity_events where organization_id = p_organization_id;
  update public.booking_requests set duplicate_of = null
    where organization_id = p_organization_id and duplicate_of is not null;
  delete from public.booking_requests where organization_id = p_organization_id;
  delete from public.messages where organization_id = p_organization_id;
  delete from public.conversations where organization_id = p_organization_id;
  delete from public.inbound_messages where organization_id = p_organization_id;
  delete from public.inbound_leads where organization_id = p_organization_id;
  delete from public.inbound_calls where organization_id = p_organization_id;
  delete from public.inbound_conversations where organization_id = p_organization_id;
  update public.jobs set follow_up_of = null where organization_id = p_organization_id and follow_up_of is not null;
  delete from public.jobs where organization_id = p_organization_id;
  delete from public.document_folders where organization_id = p_organization_id and folder_type = 'job';
  delete from public.messaging_consent where organization_id = p_organization_id;
  delete from public.stripe_customers where organization_id = p_organization_id;
  delete from public.properties where organization_id = p_organization_id;
  delete from public.customers where organization_id = p_organization_id;
  delete from public.assistant_memories where organization_id = p_organization_id;

  return paths;
end;
$$;

revoke all on function private.delete_job_records(uuid, uuid) from public, anon, authenticated;
revoke all on function private.delete_customer_records(uuid, uuid) from public, anon, authenticated;
revoke all on function private.wipe_organization_data(uuid) from public, anon, authenticated;

/** The checks every removal starts with. Returns the business's name. */
create or replace function private.admin_removal_check(p_organization_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  business text;
begin
  if not (select private.is_platform_owner()) then
    raise exception using errcode = '42501', message = 'Only a platform owner can delete records.';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Say why this is being deleted.';
  end if;
  select name into business from public.organizations where id = p_organization_id;
  if business is null then
    raise exception using errcode = 'P0002', message = 'No such business.';
  end if;
  return business;
end;
$$;

revoke all on function private.admin_removal_check(uuid, text) from public, anon, authenticated;

/**
 * Delete one record of a business: a customer (with their jobs, bookings and
 * texts), a job (with its invoices, contracts and files), an invoice, a
 * booking request or a contract. Returns the storage paths of removed files.
 */
create or replace function public.admin_delete_record(
  p_organization_id uuid,
  p_kind text,
  p_record_id uuid,
  p_reason text
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  paths text[] := '{}';
  present boolean;
begin
  perform private.admin_removal_check(p_organization_id, p_reason);

  if p_kind = 'customer' then
    select exists (select 1 from public.customers where id = p_record_id and organization_id = p_organization_id) into present;
    if present then paths := private.delete_customer_records(p_organization_id, p_record_id); end if;
  elsif p_kind = 'job' then
    select exists (select 1 from public.jobs where id = p_record_id and organization_id = p_organization_id) into present;
    if present then paths := private.delete_job_records(p_organization_id, p_record_id); end if;
  elsif p_kind = 'invoice' then
    select exists (select 1 from public.invoices where id = p_record_id and organization_id = p_organization_id) into present;
    if present then
      select coalesce(array_agg(storage_path), '{}') into paths
        from public.documents where organization_id = p_organization_id and invoice_id = p_record_id;
      delete from public.documents where organization_id = p_organization_id and invoice_id = p_record_id;
      -- Its lines go back to unbilled on the job (ON DELETE SET NULL).
      delete from public.invoices where id = p_record_id and organization_id = p_organization_id;
    end if;
  elsif p_kind = 'booking' then
    select exists (select 1 from public.booking_requests where id = p_record_id and organization_id = p_organization_id) into present;
    if present then
      update public.booking_requests set duplicate_of = null
        where organization_id = p_organization_id and duplicate_of = p_record_id;
      delete from public.booking_requests where id = p_record_id and organization_id = p_organization_id;
    end if;
  elsif p_kind = 'contract' then
    select exists (select 1 from public.contracts where id = p_record_id and organization_id = p_organization_id) into present;
    if present then
      select coalesce(array_agg(storage_path), '{}') into paths
        from public.documents where organization_id = p_organization_id and contract_id = p_record_id;
      delete from public.documents where organization_id = p_organization_id and contract_id = p_record_id;
      delete from public.contracts where id = p_record_id and organization_id = p_organization_id;
    end if;
  else
    raise exception using errcode = '22023', message = 'Unknown kind of record.';
  end if;

  if not present then
    raise exception using errcode = 'P0002', message = 'That record was not found in this business.';
  end if;

  insert into public.platform_admin_audit (admin_user_id, action, organization_id, detail)
  values (
    (select auth.uid()),
    'record.deleted',
    p_organization_id,
    jsonb_build_object('kind', p_kind, 'record_id', p_record_id, 'files', coalesce(array_length(paths, 1), 0), 'reason', left(trim(p_reason), 200))
  );
  return paths;
end;
$$;

/** Delete all of a business's customer-side records. The business name must be typed back. */
create or replace function public.admin_wipe_organization_data(
  p_organization_id uuid,
  p_confirm_name text,
  p_reason text
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  business text;
  paths text[];
begin
  business := private.admin_removal_check(p_organization_id, p_reason);
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(business)) then
    raise exception using errcode = '22023', message = 'Type the business name exactly to confirm.';
  end if;

  paths := private.wipe_organization_data(p_organization_id);

  insert into public.platform_admin_audit (admin_user_id, action, organization_id, detail)
  values (
    (select auth.uid()),
    'organization.data_wiped',
    p_organization_id,
    jsonb_build_object('business', business, 'files', coalesce(array_length(paths, 1), 0), 'reason', left(trim(p_reason), 200))
  );
  return paths;
end;
$$;

/**
 * Delete a business entirely: its records, then the business with its
 * settings and memberships. People's logins stay; they simply belong to no
 * business. The business name must be typed back.
 */
create or replace function public.admin_delete_organization(
  p_organization_id uuid,
  p_confirm_name text,
  p_reason text
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  business text;
  paths text[];
begin
  business := private.admin_removal_check(p_organization_id, p_reason);
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(business)) then
    raise exception using errcode = '22023', message = 'Type the business name exactly to confirm.';
  end if;

  paths := private.wipe_organization_data(p_organization_id);
  select paths || coalesce(array_agg(storage_path), '{}') into paths
    from public.documents where organization_id = p_organization_id;
  delete from public.documents where organization_id = p_organization_id;

  -- Written before the business goes; the audit row keeps its name in detail.
  insert into public.platform_admin_audit (admin_user_id, action, organization_id, detail)
  values (
    (select auth.uid()),
    'organization.deleted',
    p_organization_id,
    jsonb_build_object('business', business, 'files', coalesce(array_length(paths, 1), 0), 'reason', left(trim(p_reason), 200))
  );

  delete from public.organizations where id = p_organization_id;
  return paths;
end;
$$;

revoke all on function public.admin_delete_record(uuid, text, uuid, text) from public, anon;
grant execute on function public.admin_delete_record(uuid, text, uuid, text) to authenticated;
revoke all on function public.admin_wipe_organization_data(uuid, text, text) from public, anon;
grant execute on function public.admin_wipe_organization_data(uuid, text, text) to authenticated;
revoke all on function public.admin_delete_organization(uuid, text, text) from public, anon;
grant execute on function public.admin_delete_organization(uuid, text, text) to authenticated;
