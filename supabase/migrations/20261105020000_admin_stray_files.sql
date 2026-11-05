-- Stored files of a business that no document record points at any more.
--
-- Files can only be deleted through Supabase Storage, after the records that
-- named them are gone. If that second step is interrupted, or records were
-- removed from SQL, the files are left behind with nothing pointing at them.
-- This lists them so the admin console can delete them. Platform owners only.

create or replace function public.admin_stray_document_files(p_organization_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  names text[];
begin
  if not (select private.is_platform_owner()) then
    raise exception using errcode = '42501', message = 'Only a platform owner can see stray files.';
  end if;

  select coalesce(array_agg(o.name order by o.name), '{}') into names
  from storage.objects as o
  where o.bucket_id = 'business-documents'
    and o.name like p_organization_id::text || '/%'
    and not exists (
      select 1 from public.documents as d
      where d.organization_id = p_organization_id and d.storage_path = o.name
    );
  return names;
end;
$$;

revoke all on function public.admin_stray_document_files(uuid) from public, anon;
grant execute on function public.admin_stray_document_files(uuid) to authenticated;
