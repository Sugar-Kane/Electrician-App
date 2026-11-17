-- One business's records can only point at that business's records, never
-- change hands, and only name files under that business's own storage folder.
--
-- Audit finding MT-01 (HIGH). Every business table carries organization_id,
-- and its row policies check that column. But a reference to another record —
-- jobs.customer_id, invoices.job_id, documents.folder_id — is a bare id, and
-- nothing checked that the record it names belongs to the same business. A
-- member of business A could write a job whose customer_id is business B's
-- customer; anything that then follows that reference with the service role
-- (a notification, a PDF, the assistant) would read B's customer for A.
--
-- Audit finding MT-02 (HIGH), database half. The server signs, downloads and
-- deletes files with the service role, where storage policies do not apply, by
-- paths read from rows members can edit. The app now refuses any path outside
-- the caller's own folder (src/lib/tenant-storage-path.ts); these constraints
-- keep such a path from being stored in the first place.
--
-- Checked against production before writing (read-only): all 113 such
-- references, and every stored document, stock photo, avatar and logo path,
-- already agree with their business. Nothing here rewrites or deletes a row.
--
-- 1. private.guard_tenant_references: a trigger on every table holding such a
--    reference. On insert, and on any update that sets or changes a reference
--    or the row's business, the record referred to must belong to the same
--    business. Unrelated updates of an old row are not checked again.
-- 2. private.keep_tenant_owner: a row's business never changes once set.
-- 3. private.attach_tenant_guards(): attaches both, from the catalog, to every
--    public table with organization_id. Re-run it after adding a table or a
--    reference; it is idempotent.
-- 4. Path constraints on documents, inventory_items, user_profiles and
--    organizations: canonical, and under the owner's own id.
--
-- Triggers rather than composite foreign keys: the 113 references need no new
-- unique indexes or table rewrites on a live database, the existing delete
-- behaviour of every reference is untouched, and one rule covers them all.
-- Triggers run for every writer, the service role included.

-- ---------------------------------------------------------------------------
-- 1. References stay inside the business
-- ---------------------------------------------------------------------------

/*
 * Arguments come in pairs: the referencing column, then the table it refers
 * to (whose id is referenced). Written once, attached per table below.
 *
 * A row with no business (organization_id null: platform-level rows such as
 * the MCP call log for public booking) is not checked here; it is not
 * readable through any member's policy.
 */
create or replace function private.guard_tenant_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  argument integer := 0;
  column_name text;
  parent_table text;
  referenced text;
  parent_org uuid;
  child_org uuid;
  new_row jsonb := pg_catalog.to_jsonb(new);
  old_row jsonb := case when tg_op = 'UPDATE' then pg_catalog.to_jsonb(old) else null end;
begin
  child_org := nullif(new_row ->> 'organization_id', '')::uuid;
  if child_org is null then
    return new;
  end if;

  while argument + 1 < tg_nargs loop
    column_name := tg_argv[argument];
    parent_table := tg_argv[argument + 1];
    argument := argument + 2;

    referenced := nullif(new_row ->> column_name, '');
    continue when referenced is null;
    -- On update, only what is being set or changed: an unrelated edit to an
    -- old row is not re-judged.
    continue when tg_op = 'UPDATE'
      and (old_row ->> column_name) is not distinct from referenced
      and (old_row ->> 'organization_id') is not distinct from (new_row ->> 'organization_id');

    execute pg_catalog.format('select organization_id from public.%I where id = $1', parent_table)
      into parent_org
      using referenced::uuid;

    -- A missing parent is the foreign key's to refuse. A parent with no
    -- business (shared platform rows) may be referred to by anybody.
    if parent_org is not null and parent_org <> child_org then
      raise exception '%.% refers to a record that belongs to another business', tg_table_name, column_name
        using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$function$;

revoke all on function private.guard_tenant_references() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. A row's business never changes
-- ---------------------------------------------------------------------------

create or replace function private.keep_tenant_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.organization_id is not null and new.organization_id is distinct from old.organization_id then
    raise exception 'A % row cannot move to another business.', tg_table_name using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function private.keep_tenant_owner() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Attach both, from the catalog
-- ---------------------------------------------------------------------------

/*
 * Every single-column foreign key from a public table with organization_id to
 * the id of another public table with organization_id gets the reference
 * guard; every public table with organization_id gets the owner guard.
 *
 * Named zz_ so they run after any BEFORE trigger that fills in
 * organization_id (triggers on one table run in name order), and the owner
 * guard (zz_tenant_owner_...) before the reference guard (zz_tenant_references_...),
 * so moving a row to another business is refused for exactly that reason.
 */
create or replace function private.attach_tenant_guards()
returns table (table_name text, guarded_references text[])
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target record;
  arguments text;
begin
  for target in
    select child.relname as child_table, child.oid as child_oid,
           pg_catalog.array_agg(referencing.attname::text order by referencing.attname) as columns,
           pg_catalog.array_agg(parent.relname::text order by referencing.attname) as parents
    from pg_catalog.pg_constraint as foreign_key
    join pg_catalog.pg_class as child on child.oid = foreign_key.conrelid
    join pg_catalog.pg_namespace as child_schema on child_schema.oid = child.relnamespace
    join pg_catalog.pg_class as parent on parent.oid = foreign_key.confrelid
    join pg_catalog.pg_namespace as parent_schema on parent_schema.oid = parent.relnamespace
    join pg_catalog.pg_attribute as referencing
      on referencing.attrelid = foreign_key.conrelid and referencing.attnum = foreign_key.conkey[1]
    join pg_catalog.pg_attribute as referenced
      on referenced.attrelid = foreign_key.confrelid and referenced.attnum = foreign_key.confkey[1]
    where foreign_key.contype = 'f'
      and child_schema.nspname = 'public'
      and parent_schema.nspname = 'public'
      and pg_catalog.array_length(foreign_key.conkey, 1) = 1
      and referencing.attname <> 'organization_id'
      and referenced.attname = 'id'
      and exists (
        select 1 from pg_catalog.pg_attribute as column_row
        where column_row.attrelid = child.oid and column_row.attname = 'organization_id' and not column_row.attisdropped
      )
      and exists (
        select 1 from pg_catalog.pg_attribute as column_row
        where column_row.attrelid = parent.oid and column_row.attname = 'organization_id' and not column_row.attisdropped
      )
    group by child.relname, child.oid
  loop
    select pg_catalog.string_agg(pg_catalog.quote_literal(pair.column_name) || ', ' || pg_catalog.quote_literal(pair.parent_name), ', ')
      into arguments
    from unnest(target.columns, target.parents) as pair(column_name, parent_name);

    execute pg_catalog.format('drop trigger if exists zz_tenant_references_guard on public.%I', target.child_table);
    execute pg_catalog.format(
      'create trigger zz_tenant_references_guard before insert or update on public.%I '
      'for each row execute function private.guard_tenant_references(%s)',
      target.child_table, arguments
    );
    table_name := target.child_table;
    guarded_references := target.columns;
    return next;
  end loop;

  for target in
    select owner_table.relname as child_table
    from pg_catalog.pg_class as owner_table
    join pg_catalog.pg_namespace as owner_schema on owner_schema.oid = owner_table.relnamespace
    join pg_catalog.pg_attribute as column_row on column_row.attrelid = owner_table.oid
    where owner_schema.nspname = 'public'
      and owner_table.relkind = 'r'
      and column_row.attname = 'organization_id'
      and not column_row.attisdropped
  loop
    execute pg_catalog.format('drop trigger if exists zz_tenant_owner_immutable on public.%I', target.child_table);
    execute pg_catalog.format(
      'create trigger zz_tenant_owner_immutable before update of organization_id on public.%I '
      'for each row execute function private.keep_tenant_owner()',
      target.child_table
    );
  end loop;
end;
$function$;

revoke all on function private.attach_tenant_guards() from public, anon, authenticated;

select pg_catalog.count(*) as tables_with_reference_guards from private.attach_tenant_guards();

-- ---------------------------------------------------------------------------
-- 4. Stored paths stay under their owner
-- ---------------------------------------------------------------------------

/*
 * The same canonical shape the app requires: owner id first, then plain
 * segments — no "." or "..", no empty segment, no backslash, percent sign or
 * control character, no trailing slash. Production already conforms (checked
 * read-only), so these are enforced on existing rows too.
 */
create or replace function private.is_owned_object_path(path text, owner_id uuid, min_segments integer)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select path is not null
    and owner_id is not null
    and pg_catalog.length(path) <= 1024
    and pg_catalog.split_part(path, '/', 1) = owner_id::text
    and pg_catalog.array_length(pg_catalog.string_to_array(path, '/'), 1) >= min_segments
    and path !~ '(^|/)\.{1,2}(/|$)'
    and pg_catalog.strpos(path, '//') = 0
    and path !~ '[\\%[:cntrl:]]'
    and pg_catalog.right(path, 1) <> '/';
$function$;

revoke all on function private.is_owned_object_path(text, uuid, integer) from public, anon;
grant execute on function private.is_owned_object_path(text, uuid, integer) to authenticated, service_role;

alter table public.documents drop constraint if exists documents_storage_path_owned;
alter table public.documents add constraint documents_storage_path_owned
  check (private.is_owned_object_path(storage_path, organization_id, 3));

alter table public.inventory_items drop constraint if exists inventory_items_photo_path_owned;
alter table public.inventory_items add constraint inventory_items_photo_path_owned
  check (photo_path is null or photo_path = '' or private.is_owned_object_path(photo_path, organization_id, 3));

alter table public.user_profiles drop constraint if exists user_profiles_avatar_path_owned;
alter table public.user_profiles add constraint user_profiles_avatar_path_owned
  check (avatar_path is null or avatar_path = '' or private.is_owned_object_path(avatar_path, user_id, 2));

alter table public.organizations drop constraint if exists organizations_logo_path_owned;
alter table public.organizations add constraint organizations_logo_path_owned
  check (logo_path is null or logo_path = '' or private.is_owned_object_path(logo_path, id, 2));
