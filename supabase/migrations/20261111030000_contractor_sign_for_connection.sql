-- Signing a contract for the business from a ChatGPT connection.
--
-- `sign_contract_as_contractor` signs as `auth.uid()`, the person in the app.
-- A ChatGPT connection has no signed-in person: the server acts for the
-- business with the service role, on behalf of the owner who created the
-- connection. This is the same signing, for a named user, callable only by the
-- service role. It applies that user's own adopted signature and nothing else,
-- and only when that user is a member of the contract's business.

create or replace function public.sign_contract_as_contractor_for(p_contract_id uuid, p_user_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path to ''
as $function$
declare
  signer public.contract_signers%rowtype;
  signed timestamptz;
begin
  if p_user_id is null or p_contract_id is null then
    return null;
  end if;

  select saved.* into signer
  from public.contract_signers as saved
  join public.contracts as contract on contract.organization_id = saved.organization_id
  join public.organization_members as membership
    on membership.organization_id = contract.organization_id
   and membership.user_id = p_user_id
  where contract.id = p_contract_id
    and saved.user_id = p_user_id;

  if not found then
    return null;
  end if;

  perform pg_catalog.set_config('app.contractor_signing', 'on', true);

  update public.contracts as contract
  set contractor_signed_at = pg_catalog.now(),
      contractor_signed_by = p_user_id,
      contractor_signature_name = signer.signer_name,
      contractor_signature_title = nullif(pg_catalog.btrim(coalesce(signer.signer_title, '')), ''),
      contractor_signature_method = signer.method,
      contractor_signature_image = case when signer.method = 'drawn' then signer.image else null end,
      updated_at = pg_catalog.now()
  where contract.id = p_contract_id
    and contract.organization_id = signer.organization_id
    and contract.contractor_signed_at is null
    and contract.signed_at is null
    and contract.status <> 'void'
    and pg_catalog.cardinality(contract.unfilled) = 0
    and not exists (
      select 1
      from public.contracts as newer
      where newer.job_id = contract.job_id
        and newer.id <> contract.id
        and newer.status <> 'void'
        and newer.created_at > contract.created_at
    )
  returning contract.contractor_signed_at into signed;

  perform pg_catalog.set_config('app.contractor_signing', '', true);

  if signed is null then
    select contract.contractor_signed_at into signed
    from public.contracts as contract
    where contract.id = p_contract_id
      and contract.organization_id = signer.organization_id;
  end if;

  return signed;
end;
$function$;

revoke all on function public.sign_contract_as_contractor_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sign_contract_as_contractor_for(uuid, uuid) to service_role;
