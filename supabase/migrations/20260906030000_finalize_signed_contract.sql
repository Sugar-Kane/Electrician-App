-- Promote a sealed Documenso PDF and retire the unsigned draft in one database
-- transaction.  The file is uploaded before this call; if this function fails,
-- application code removes that new row and leaves the old current PDF intact.

create or replace function public.finalize_signed_contract_document(
  p_contract_id uuid,
  p_document_id uuid,
  p_organization_id uuid,
  p_signed_at timestamptz,
  p_last_event_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_envelope_id text;
begin
  select contract.signature_envelope_id
    into v_envelope_id
  from public.contracts as contract
  where contract.id = p_contract_id
    and contract.organization_id = p_organization_id
    and contract.signature_provider = 'documenso'
  for update;

  if v_envelope_id is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.documents as document
    where document.id = p_document_id
      and document.organization_id = p_organization_id
      and document.contract_id = p_contract_id
      and document.signature_provider = 'documenso'
      and document.signature_envelope_id = v_envelope_id
  ) then
    return false;
  end if;

  update public.documents as document
  set archived_at = case
    when document.id = p_document_id then null
    else coalesce(document.archived_at, now())
  end
  where document.organization_id = p_organization_id
    and document.contract_id = p_contract_id
    and (document.id = p_document_id or document.archived_at is null);

  update public.contracts as contract
  set status = 'signed',
      signed_at = p_signed_at,
      signature_downloaded_at = now(),
      signature_last_event = 'DOCUMENT_COMPLETED',
      signature_last_event_at = greatest(
        coalesce(contract.signature_last_event_at, p_last_event_at),
        p_last_event_at
      )
  where contract.id = p_contract_id
    and contract.organization_id = p_organization_id;

  return found;
end;
$$;

revoke all on function public.finalize_signed_contract_document(uuid, uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.finalize_signed_contract_document(uuid, uuid, uuid, timestamptz, timestamptz)
  to service_role;

comment on function public.finalize_signed_contract_document(uuid, uuid, uuid, timestamptz, timestamptz) is
  'Atomically makes one sealed Documenso PDF current, archives every prior current version, and marks its contract signed.';
