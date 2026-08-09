-- Make the folder triggers agree with the folder model everything else moved to.
--
-- `document_folders_year_month_blueprint` narrowed folder_type to
-- ('root','system','year','month','job','custom') and the app's blueprint moved
-- to Jobs -> Year -> Month -> Job. The functions that *write* folders were left
-- on the old vocabulary: they still pass 'customer', 'property', and 'category',
-- none of which the check constraint accepts any more.
--
-- Those functions run from AFTER INSERT triggers, so the failure is not confined
-- to documents. It takes the insert down with it:
--
--   * a new customer  -> sync_customer_document_folder  -> 'customer'  -> 23514
--   * a new property  -> sync_property_document_folder  -> 'property'  -> 23514
--   * a new job       -> sync_job_document_folder       -> 'category'  -> 23514
--   * a new org       -> seed_organization_document_tree-> 'category'  -> 23514
--
-- Which is to say: nobody could become a customer, and no job could be booked,
-- through any path — the phone, a text, the public booking form, or the app
-- itself. It surfaced as a voice agent being told to ask for a phone number it
-- had already been given three times, because the insert underneath returned
-- null and the tool could only report the symptom.
--
-- Customer and property folders are not restored. They are deliberately gone:
-- the workspace is organised by job and date because repeat customers otherwise
-- fragment across years, and customer, property, and document type are filters
-- over the database rather than physical directories.

-- 1. Retired concepts. The triggers go with the functions so nothing is left
--    firing against a folder type that no longer exists.
drop trigger if exists sync_customer_document_folder on public.customers;
drop function if exists private.sync_customer_document_folder();

drop trigger if exists sync_property_document_folder on public.properties;
drop function if exists private.sync_property_document_folder();

-- 2. The organization tree, as the app's DOCUMENT_FOLDER_BLUEPRINT describes it.
--    Year and month folders are not seeded: they are created on demand by the
--    job trigger below, so an empty workspace shows a shape rather than a
--    calendar of empty months.
create or replace function private.seed_organization_document_tree(target_organization_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.ensure_document_folder(target_organization_id, 'root', null, 'Electrician App', 'root', null, 0);

  perform private.ensure_document_folder(target_organization_id, 'jobs', 'root', 'Jobs', 'system', null, 10);

  perform private.ensure_document_folder(target_organization_id, 'business', 'root', 'Business', 'system', null, 20);
  perform private.ensure_document_folder(target_organization_id, 'business:company-documents', 'business', 'Company Documents', 'system', null, 10);
  perform private.ensure_document_folder(target_organization_id, 'business:templates', 'business', 'Templates', 'system', null, 20);
  perform private.ensure_document_folder(target_organization_id, 'business:expenses', 'business', 'Expenses', 'system', null, 30);

  perform private.ensure_document_folder(target_organization_id, 'accountant-exports', 'root', 'Accountant Exports', 'system', null, 30);
end;
$$;

-- 3. One folder per job, filed under the year and month it was scheduled in.
--
--    The name carries the customer and the address so an owner browsing Drive
--    outside the app can still find things, matching buildJobFolderName. Every
--    part of it is read from the database — never from anything a model said.
create or replace function private.sync_job_document_folder()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  scheduled_on date;
  year_key text;
  month_key text;
  month_names text[] := array[
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  month_number integer;
  customer_name text := '';
  address_line text := '';
  job_name text;
begin
  perform private.seed_organization_document_tree(new.organization_id);

  -- A job with no scheduled date is still a job; file it under today rather
  -- than dropping it outside the tree.
  scheduled_on := coalesce(new.scheduled_start::date, new.created_at::date, current_date);
  month_number := extract(month from scheduled_on)::integer;

  year_key := 'jobs:' || to_char(scheduled_on, 'YYYY');
  month_key := year_key || ':' || to_char(scheduled_on, 'MM');

  perform private.ensure_document_folder(
    new.organization_id, year_key, 'jobs', to_char(scheduled_on, 'YYYY'), 'year', null,
    extract(year from scheduled_on)::integer
  );
  perform private.ensure_document_folder(
    new.organization_id, month_key, year_key,
    to_char(scheduled_on, 'MM') || ' – ' || month_names[month_number], 'month', null, month_number
  );

  select
    coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), '')
  into customer_name
  from public.customers c
  where c.id = new.customer_id;

  select coalesce(nullif(btrim(p.address_line_1), ''), '')
  into address_line
  from public.properties p
  where p.id = new.property_id;

  job_name := array_to_string(
    array_remove(array[
      'JOB-' || new.job_number::text,
      nullif(coalesce(customer_name, ''), ''),
      nullif(coalesce(address_line, ''), ''),
      nullif(initcap(replace(coalesce(new.category, ''), '_', ' ')), '')
    ], null),
    ' – '
  );

  perform private.ensure_document_folder(
    new.organization_id, 'job:' || new.id::text, month_key, job_name, 'job', new.id, 0
  );

  return new;
end;
$$;

drop trigger if exists sync_job_document_folder on public.jobs;
create trigger sync_job_document_folder
after insert or update of category, customer_id, property_id, scheduled_start on public.jobs
for each row execute function private.sync_job_document_folder();

-- 4. Clear out folders written under the retired vocabulary. Nothing points at
--    them any more, and leaving them would show an owner a tree the app cannot
--    render.
delete from public.document_folders
where folder_type not in ('root', 'system', 'year', 'month', 'job', 'custom')
   or folder_key like 'customer:%'
   or folder_key like 'property:%'
   or folder_key like 'company:%'
   or folder_key like 'operations:%'
   or folder_key like 'team:%'
   or folder_key in ('customers', 'company', 'operations', 'team', 'reports');

-- 5. The constraint this whole mess is measured against.
--
--    `document_folders_year_month_blueprint` (20260804195935) is applied to the
--    deployed database but has no file in this repo, so a rebuild from these
--    migrations alone would still carry the *old* vocabulary — which does not
--    contain 'year' or 'month', and would reject everything above. Restated here
--    so the repo can stand the schema up on its own. Written to match what is
--    already deployed, so this is a no-op there.
alter table public.document_folders
  drop constraint if exists document_folders_folder_type_check;
alter table public.document_folders
  add constraint document_folders_folder_type_check
  check (folder_type in ('root', 'system', 'year', 'month', 'job', 'custom'));
