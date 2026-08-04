create table public.document_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('google_drive', 'onedrive')),
  status text not null default 'connecting'
    check (status in ('connecting', 'connected', 'error', 'revoked')),
  sync_mode text not null default 'mirror_to_cloud'
    check (sync_mode in ('mirror_to_cloud', 'import_and_mirror')),
  external_account_email text,
  root_external_id text,
  root_external_url text,
  last_cursor text,
  last_error text,
  last_synced_at timestamptz,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create table public.document_folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_folder_id uuid references public.document_folders(id) on delete cascade,
  folder_key text not null check (char_length(folder_key) between 1 and 240),
  display_name text not null check (char_length(display_name) between 1 and 160),
  folder_type text not null default 'custom'
    check (folder_type in ('root', 'system', 'customer', 'property', 'job', 'category', 'custom')),
  entity_id uuid,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, folder_key)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  folder_id uuid not null references public.document_folders(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  estimate_id uuid references public.estimates(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  storage_object_id uuid,
  storage_path text not null unique check (char_length(storage_path) between 3 and 1024),
  file_name text not null check (char_length(file_name) between 1 and 255),
  display_name text not null check (char_length(display_name) between 1 and 255),
  document_type text not null default 'other'
    check (document_type in (
      'intake', 'estimate', 'permit', 'photo_before', 'photo_after',
      'invoice', 'payment', 'warranty', 'completion', 'license',
      'insurance', 'certification', 'purchase_order', 'report', 'other'
    )),
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$'),
  source text not null default 'app' check (source in ('app', 'google_drive', 'onedrive')),
  version_number integer not null default 1 check (version_number > 0),
  uploaded_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.document_cloud_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid not null references public.document_integrations(id) on delete cascade,
  folder_id uuid references public.document_folders(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  external_object_id text not null,
  external_parent_id text,
  external_web_url text,
  external_etag text,
  external_modified_at timestamptz,
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'synced', 'conflict', 'error', 'deleted')),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((folder_id is not null)::integer + (document_id is not null)::integer = 1),
  unique (integration_id, external_object_id),
  unique (integration_id, folder_id),
  unique (integration_id, document_id)
);

create table public.document_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid not null references public.document_integrations(id) on delete cascade,
  direction text not null default 'to_cloud'
    check (direction in ('to_cloud', 'from_cloud', 'reconcile')),
  scope text not null default 'workspace'
    check (scope in ('workspace', 'folder', 'document')),
  folder_id uuid references public.document_folders(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed', 'canceled')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'workspace' and folder_id is null and document_id is null)
    or (scope = 'folder' and folder_id is not null and document_id is null)
    or (scope = 'document' and folder_id is null and document_id is not null)
  )
);

create table private.document_provider_credentials (
  integration_id uuid primary key references public.document_integrations(id) on delete cascade,
  encrypted_refresh_token text not null,
  encryption_version smallint not null default 1 check (encryption_version > 0),
  scopes text[] not null default '{}',
  token_received_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on table private.document_provider_credentials from public, anon, authenticated;

create or replace function public.store_document_provider_credential(
  p_integration_id uuid,
  p_encrypted_refresh_token text,
  p_scopes text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required.';
  end if;

  insert into private.document_provider_credentials (
    integration_id, encrypted_refresh_token, scopes
  ) values (
    p_integration_id, p_encrypted_refresh_token, coalesce(p_scopes, '{}'::text[])
  )
  on conflict (integration_id) do update
  set encrypted_refresh_token = excluded.encrypted_refresh_token,
      scopes = excluded.scopes,
      token_received_at = now();
end;
$$;

revoke all on function public.store_document_provider_credential(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.store_document_provider_credential(uuid, text, text[]) to service_role;

create index document_integrations_organization_id_idx
  on public.document_integrations(organization_id);
create index document_folders_organization_parent_idx
  on public.document_folders(organization_id, parent_folder_id, sort_order, display_name);
create index document_folders_parent_folder_id_idx
  on public.document_folders(parent_folder_id);
create index documents_organization_created_idx
  on public.documents(organization_id, created_at desc);
create index documents_folder_id_idx on public.documents(folder_id);
create index documents_customer_id_idx on public.documents(customer_id);
create index documents_property_id_idx on public.documents(property_id);
create index documents_job_id_idx on public.documents(job_id);
create index documents_estimate_id_idx on public.documents(estimate_id);
create index documents_invoice_id_idx on public.documents(invoice_id);
create index documents_uploaded_by_idx on public.documents(uploaded_by);
create index document_cloud_links_organization_id_idx
  on public.document_cloud_links(organization_id);
create index document_cloud_links_integration_id_idx
  on public.document_cloud_links(integration_id);
create index document_cloud_links_folder_id_idx on public.document_cloud_links(folder_id);
create index document_cloud_links_document_id_idx on public.document_cloud_links(document_id);
create index document_sync_jobs_queue_idx
  on public.document_sync_jobs(status, created_at)
  where status in ('queued', 'failed');
create index document_sync_jobs_organization_id_idx
  on public.document_sync_jobs(organization_id);
create index document_sync_jobs_integration_id_idx
  on public.document_sync_jobs(integration_id);
create index document_sync_jobs_folder_id_idx on public.document_sync_jobs(folder_id);
create index document_sync_jobs_document_id_idx on public.document_sync_jobs(document_id);
create index document_sync_jobs_requested_by_idx on public.document_sync_jobs(requested_by);

create trigger set_document_integrations_updated_at
before update on public.document_integrations
for each row execute function public.set_updated_at();

create trigger set_document_folders_updated_at
before update on public.document_folders
for each row execute function public.set_updated_at();

create trigger set_documents_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

create trigger set_document_cloud_links_updated_at
before update on public.document_cloud_links
for each row execute function public.set_updated_at();

create trigger set_document_sync_jobs_updated_at
before update on public.document_sync_jobs
for each row execute function public.set_updated_at();

create trigger set_document_provider_credentials_updated_at
before update on private.document_provider_credentials
for each row execute function public.set_updated_at();

create or replace function private.ensure_document_folder(
  target_organization_id uuid,
  target_folder_key text,
  target_parent_key text,
  target_display_name text,
  target_folder_type text,
  target_entity_id uuid default null,
  target_sort_order integer default 0
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  parent_id uuid;
  folder_id uuid;
begin
  if target_parent_key is not null then
    select folder.id into parent_id
    from public.document_folders as folder
    where folder.organization_id = target_organization_id
      and folder.folder_key = target_parent_key;

    if parent_id is null then
      raise exception using errcode = 'P0002', message = 'Parent document folder is missing.';
    end if;
  end if;

  insert into public.document_folders (
    organization_id, parent_folder_id, folder_key, display_name,
    folder_type, entity_id, sort_order
  ) values (
    target_organization_id, parent_id, target_folder_key, target_display_name,
    target_folder_type, target_entity_id, target_sort_order
  )
  on conflict (organization_id, folder_key) do update
  set display_name = excluded.display_name,
      parent_folder_id = excluded.parent_folder_id,
      folder_type = excluded.folder_type,
      entity_id = excluded.entity_id,
      sort_order = excluded.sort_order
  returning id into folder_id;

  return folder_id;
end;
$$;

create or replace function private.seed_organization_document_tree(target_organization_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.ensure_document_folder(target_organization_id, 'root', null, 'Electrician App', 'root', null, 0);
  perform private.ensure_document_folder(target_organization_id, 'company', 'root', 'Company', 'system', null, 10);
  perform private.ensure_document_folder(target_organization_id, 'company:business-info', 'company', 'Business Information', 'category', null, 10);
  perform private.ensure_document_folder(target_organization_id, 'company:licenses-insurance', 'company', 'Licenses & Insurance', 'category', null, 20);
  perform private.ensure_document_folder(target_organization_id, 'company:templates', 'company', 'Templates', 'category', null, 30);
  perform private.ensure_document_folder(target_organization_id, 'company:price-book', 'company', 'Price Book', 'category', null, 40);
  perform private.ensure_document_folder(target_organization_id, 'customers', 'root', 'Customers', 'system', null, 20);
  perform private.ensure_document_folder(target_organization_id, 'operations', 'root', 'Operations', 'system', null, 30);
  perform private.ensure_document_folder(target_organization_id, 'operations:inventory', 'operations', 'Inventory', 'category', null, 10);
  perform private.ensure_document_folder(target_organization_id, 'operations:purchase-orders', 'operations', 'Purchase Orders', 'category', null, 20);
  perform private.ensure_document_folder(target_organization_id, 'operations:vendors', 'operations', 'Vendors', 'category', null, 30);
  perform private.ensure_document_folder(target_organization_id, 'team', 'root', 'Team', 'system', null, 40);
  perform private.ensure_document_folder(target_organization_id, 'team:certifications', 'team', 'Certifications', 'category', null, 10);
  perform private.ensure_document_folder(target_organization_id, 'reports', 'root', 'Reports', 'system', null, 50);
end;
$$;

create or replace function private.seed_organization_documents_on_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.seed_organization_document_tree(new.id);
  return new;
end;
$$;

create trigger seed_organization_document_tree
after insert on public.organizations
for each row execute function private.seed_organization_documents_on_insert();

create or replace function private.sync_customer_document_folder()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  customer_name text;
begin
  perform private.seed_organization_document_tree(new.organization_id);
  customer_name := coalesce(
    nullif(btrim(new.company_name), ''),
    nullif(btrim(concat_ws(' ', new.first_name, new.last_name)), ''),
    'Customer'
  );

  perform private.ensure_document_folder(
    new.organization_id,
    'customer:' || new.id::text,
    'customers',
    customer_name,
    'customer',
    new.id,
    0
  );
  perform private.ensure_document_folder(
    new.organization_id,
    'customer:' || new.id::text || ':properties',
    'customer:' || new.id::text,
    'Properties',
    'category',
    new.id,
    10
  );
  return new;
end;
$$;

create trigger sync_customer_document_folder
after insert or update of first_name, last_name, company_name on public.customers
for each row execute function private.sync_customer_document_folder();

create or replace function private.sync_property_document_folder()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  property_name text;
begin
  property_name := concat_ws(' – ', nullif(btrim(new.label), ''), btrim(new.address_line_1));
  perform private.ensure_document_folder(
    new.organization_id,
    'property:' || new.id::text,
    'customer:' || new.customer_id::text || ':properties',
    property_name,
    'property',
    new.id,
    0
  );
  return new;
end;
$$;

create trigger sync_property_document_folder
after insert or update of label, address_line_1, customer_id on public.properties
for each row execute function private.sync_property_document_folder();

create or replace function private.sync_job_document_folder()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_key text;
  job_key text := 'job:' || new.id::text;
  job_name text;
begin
  parent_key := case
    when new.property_id is not null then 'property:' || new.property_id::text
    when new.customer_id is not null then 'customer:' || new.customer_id::text
    else 'customers'
  end;
  job_name := 'Job #' || new.job_number::text || ' – ' || initcap(replace(new.category, '_', ' '));

  perform private.ensure_document_folder(new.organization_id, job_key, parent_key, job_name, 'job', new.id, 0);
  perform private.ensure_document_folder(new.organization_id, job_key || ':intake', job_key, '01 Intake', 'category', new.id, 10);
  perform private.ensure_document_folder(new.organization_id, job_key || ':estimates', job_key, '02 Estimates', 'category', new.id, 20);
  perform private.ensure_document_folder(new.organization_id, job_key || ':permits', job_key, '03 Permits', 'category', new.id, 30);
  perform private.ensure_document_folder(new.organization_id, job_key || ':photos', job_key, '04 Photos', 'category', new.id, 40);
  perform private.ensure_document_folder(new.organization_id, job_key || ':photos:before', job_key || ':photos', 'Before', 'category', new.id, 10);
  perform private.ensure_document_folder(new.organization_id, job_key || ':photos:after', job_key || ':photos', 'After', 'category', new.id, 20);
  perform private.ensure_document_folder(new.organization_id, job_key || ':invoices-payments', job_key, '05 Invoices & Payments', 'category', new.id, 50);
  perform private.ensure_document_folder(new.organization_id, job_key || ':warranties', job_key, '06 Warranties', 'category', new.id, 60);
  perform private.ensure_document_folder(new.organization_id, job_key || ':completion', job_key, '07 Completion', 'category', new.id, 70);
  return new;
end;
$$;

create trigger sync_job_document_folder
after insert or update of category, customer_id, property_id on public.jobs
for each row execute function private.sync_job_document_folder();

do $$
declare
  organization_record record;
  customer_record public.customers%rowtype;
  property_record public.properties%rowtype;
  job_record public.jobs%rowtype;
  customer_name text;
  property_name text;
  parent_key text;
  job_key text;
  job_name text;
begin
  for organization_record in select id from public.organizations loop
    perform private.seed_organization_document_tree(organization_record.id);
  end loop;

  for customer_record in select * from public.customers loop
    customer_name := coalesce(
      nullif(btrim(customer_record.company_name), ''),
      nullif(btrim(concat_ws(' ', customer_record.first_name, customer_record.last_name)), ''),
      'Customer'
    );
    perform private.ensure_document_folder(
      customer_record.organization_id,
      'customer:' || customer_record.id::text,
      'customers',
      customer_name,
      'customer',
      customer_record.id,
      0
    );
    perform private.ensure_document_folder(
      customer_record.organization_id,
      'customer:' || customer_record.id::text || ':properties',
      'customer:' || customer_record.id::text,
      'Properties',
      'category',
      customer_record.id,
      10
    );
  end loop;

  for property_record in select * from public.properties loop
    property_name := concat_ws(
      ' – ',
      nullif(btrim(property_record.label), ''),
      btrim(property_record.address_line_1)
    );
    perform private.ensure_document_folder(
      property_record.organization_id,
      'property:' || property_record.id::text,
      'customer:' || property_record.customer_id::text || ':properties',
      property_name,
      'property',
      property_record.id,
      0
    );
  end loop;

  for job_record in select * from public.jobs loop
    parent_key := case
      when job_record.property_id is not null then 'property:' || job_record.property_id::text
      when job_record.customer_id is not null then 'customer:' || job_record.customer_id::text
      else 'customers'
    end;
    job_key := 'job:' || job_record.id::text;
    job_name := 'Job #' || job_record.job_number::text || ' – '
      || initcap(replace(job_record.category, '_', ' '));

    perform private.ensure_document_folder(job_record.organization_id, job_key, parent_key, job_name, 'job', job_record.id, 0);
    perform private.ensure_document_folder(job_record.organization_id, job_key || ':intake', job_key, '01 Intake', 'category', job_record.id, 10);
    perform private.ensure_document_folder(job_record.organization_id, job_key || ':estimates', job_key, '02 Estimates', 'category', job_record.id, 20);
    perform private.ensure_document_folder(job_record.organization_id, job_key || ':permits', job_key, '03 Permits', 'category', job_record.id, 30);
    perform private.ensure_document_folder(job_record.organization_id, job_key || ':photos', job_key, '04 Photos', 'category', job_record.id, 40);
    perform private.ensure_document_folder(job_record.organization_id, job_key || ':photos:before', job_key || ':photos', 'Before', 'category', job_record.id, 10);
    perform private.ensure_document_folder(job_record.organization_id, job_key || ':photos:after', job_key || ':photos', 'After', 'category', job_record.id, 20);
    perform private.ensure_document_folder(job_record.organization_id, job_key || ':invoices-payments', job_key, '05 Invoices & Payments', 'category', job_record.id, 50);
    perform private.ensure_document_folder(job_record.organization_id, job_key || ':warranties', job_key, '06 Warranties', 'category', job_record.id, 60);
    perform private.ensure_document_folder(job_record.organization_id, job_key || ':completion', job_key, '07 Completion', 'category', job_record.id, 70);
  end loop;
end;
$$;

alter table public.document_integrations enable row level security;
alter table public.document_folders enable row level security;
alter table public.documents enable row level security;
alter table public.document_cloud_links enable row level security;
alter table public.document_sync_jobs enable row level security;

create policy "Organization members can view document integrations"
on public.document_integrations for select to authenticated
using ((select private.is_org_member(organization_id)));

create policy "Organization admins can add document integrations"
on public.document_integrations for insert to authenticated
with check ((select private.is_org_admin(organization_id)));

create policy "Organization admins can update document integrations"
on public.document_integrations for update to authenticated
using ((select private.is_org_admin(organization_id)))
with check ((select private.is_org_admin(organization_id)));

create policy "Organization admins can remove document integrations"
on public.document_integrations for delete to authenticated
using ((select private.is_org_admin(organization_id)));

create policy "Organization members can view document folders"
on public.document_folders for select to authenticated
using ((select private.is_org_member(organization_id)));

create policy "Organization members can add document folders"
on public.document_folders for insert to authenticated
with check ((select private.is_org_member(organization_id)));

create policy "Organization members can update document folders"
on public.document_folders for update to authenticated
using ((select private.is_org_member(organization_id)))
with check ((select private.is_org_member(organization_id)));

create policy "Organization admins can remove document folders"
on public.document_folders for delete to authenticated
using ((select private.is_org_admin(organization_id)));

create policy "Organization members can view documents"
on public.documents for select to authenticated
using ((select private.is_org_member(organization_id)));

create policy "Organization members can add documents"
on public.documents for insert to authenticated
with check (
  (select private.is_org_member(organization_id))
  and uploaded_by = (select auth.uid())
);

create policy "Organization members can update documents"
on public.documents for update to authenticated
using ((select private.is_org_member(organization_id)))
with check ((select private.is_org_member(organization_id)));

create policy "Organization admins can remove documents"
on public.documents for delete to authenticated
using ((select private.is_org_admin(organization_id)));

create policy "Organization members can view document cloud links"
on public.document_cloud_links for select to authenticated
using ((select private.is_org_member(organization_id)));

create policy "Organization members can view document sync jobs"
on public.document_sync_jobs for select to authenticated
using ((select private.is_org_member(organization_id)));

create policy "Organization members can request document sync"
on public.document_sync_jobs for insert to authenticated
with check (
  (select private.is_org_member(organization_id))
  and requested_by = (select auth.uid())
);

revoke all on table public.document_integrations from public, anon;
revoke all on table public.document_folders from public, anon;
revoke all on table public.documents from public, anon;
revoke all on table public.document_cloud_links from public, anon;
revoke all on table public.document_sync_jobs from public, anon;

grant select, insert, update, delete on table public.document_integrations to authenticated;
grant select, insert, update, delete on table public.document_folders to authenticated;
grant select, insert, update, delete on table public.documents to authenticated;
grant select on table public.document_cloud_links to authenticated;
grant select, insert on table public.document_sync_jobs to authenticated;

grant select, insert, update, delete on table public.document_integrations to service_role;
grant select, insert, update, delete on table public.document_folders to service_role;
grant select, insert, update, delete on table public.documents to service_role;
grant select, insert, update, delete on table public.document_cloud_links to service_role;
grant select, insert, update, delete on table public.document_sync_jobs to service_role;

create or replace function private.storage_object_organization_id(object_name text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  return nullif(pg_catalog.split_part(object_name, '/', 1), '')::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

revoke all on function private.storage_object_organization_id(text) from public, anon;
grant execute on function private.storage_object_organization_id(text) to authenticated;

create policy "Organization members can read business documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'business-documents'
  and (select private.is_org_member(private.storage_object_organization_id(name)))
);

create policy "Organization members can upload business documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'business-documents'
  and (select private.is_org_member(private.storage_object_organization_id(name)))
);

create policy "Organization members can update business documents"
on storage.objects for update to authenticated
using (
  bucket_id = 'business-documents'
  and (select private.is_org_member(private.storage_object_organization_id(name)))
)
with check (
  bucket_id = 'business-documents'
  and (select private.is_org_member(private.storage_object_organization_id(name)))
);

create policy "Organization admins can delete business documents"
on storage.objects for delete to authenticated
using (
  bucket_id = 'business-documents'
  and (select private.is_org_admin(private.storage_object_organization_id(name)))
);
