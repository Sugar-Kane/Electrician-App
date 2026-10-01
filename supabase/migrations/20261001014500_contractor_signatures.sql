-- The business signs its contract before the customer sees it.
--
-- A contract went out with the customer's line ready to sign and the
-- contractor's line blank, so even a signed contract carried one party's
-- signature. Now each member who sends contracts adopts a signature once, and
-- sending a contract — or handing it over to be signed in person — signs it
-- for the business with the sender's signature first.
--
-- The rules sit here rather than in the app, the same way the customer's
-- signature does: only one function can put the business's signature on a
-- contract, it only ever uses the caller's own saved signature, and once given
-- it cannot be changed. A member writing to the table directly cannot sign as
-- somebody else.

/*
 * A member's adopted signature, per business.
 *
 * Per business rather than per person, because adopting a signature is
 * agreeing to sign *that* business's contracts with it.
 */
create table if not exists public.contract_signers (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  signer_name text not null,
  signer_title text,
  method text not null,
  -- A PNG data URI for a drawn signature, kept in the row like the customer's.
  image text,
  adopted_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint contract_signers_method_check check (method in ('drawn', 'typed')),
  constraint contract_signers_name_check check (char_length(btrim(signer_name)) between 1 and 120),
  constraint contract_signers_title_check check (signer_title is null or char_length(signer_title) <= 80),
  constraint contract_signers_drawn_image check (method <> 'drawn' or coalesce(btrim(image), '') <> ''),
  constraint contract_signers_image_size check (image is null or char_length(image) <= 400000)
);

create index if not exists contract_signers_user_id_idx on public.contract_signers (user_id);

alter table public.contract_signers enable row level security;

-- Your own signature, in a business you belong to, and nobody else's.
drop policy if exists contract_signers_own on public.contract_signers;
create policy contract_signers_own on public.contract_signers
  for all to authenticated
  using (user_id = (select auth.uid()) and private.is_org_member(organization_id))
  with check (user_id = (select auth.uid()) and private.is_org_member(organization_id));

revoke all on public.contract_signers from public, anon;
grant select, insert, update, delete on public.contract_signers to authenticated;
grant all on public.contract_signers to service_role;

/*
 * The business's signature on a contract, frozen when it is given.
 *
 * Copied from the signer's adopted signature rather than pointing at it: a
 * signature that changed when somebody later redrew theirs would not be a
 * record of anything. `contractor_signed_by` is a plain id, not a foreign key,
 * for the same reason — removing a person's account must not reach into a
 * contract and alter who signed it.
 */
alter table public.contracts
  add column if not exists contractor_signed_at timestamptz,
  add column if not exists contractor_signed_by uuid,
  add column if not exists contractor_signature_name text,
  add column if not exists contractor_signature_title text,
  add column if not exists contractor_signature_method text,
  add column if not exists contractor_signature_image text;

alter table public.contracts
  drop constraint if exists contracts_contractor_signature_method_check;
alter table public.contracts
  add constraint contracts_contractor_signature_method_check
  check (contractor_signature_method is null or contractor_signature_method in ('drawn', 'typed'));

alter table public.contracts
  drop constraint if exists contracts_contractor_signature_complete;
alter table public.contracts
  add constraint contracts_contractor_signature_complete
  check (
    contractor_signed_at is null
    or (
      contractor_signed_by is not null
      and contractor_signature_method is not null
      and coalesce(btrim(contractor_signature_name), '') <> ''
      and (contractor_signature_method <> 'drawn' or coalesce(btrim(contractor_signature_image), '') <> '')
    )
  );

/*
 * Only the signing function sets these, and nothing changes them afterwards.
 *
 * The function raises a transaction-local flag while it writes; any other
 * write that touches these columns — a member's own update through the API,
 * the service role, code nobody has written yet — is refused. Inserts too, so a
 * contract cannot be created already "signed" by somebody who never signed it.
 */
create or replace function private.keep_contractor_signature()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  touched boolean;
begin
  if tg_op = 'INSERT' then
    touched := new.contractor_signed_at is not null
      or new.contractor_signed_by is not null
      or new.contractor_signature_name is not null
      or new.contractor_signature_title is not null
      or new.contractor_signature_method is not null
      or new.contractor_signature_image is not null;
  else
    touched := new.contractor_signed_at is distinct from old.contractor_signed_at
      or new.contractor_signed_by is distinct from old.contractor_signed_by
      or new.contractor_signature_name is distinct from old.contractor_signature_name
      or new.contractor_signature_title is distinct from old.contractor_signature_title
      or new.contractor_signature_method is distinct from old.contractor_signature_method
      or new.contractor_signature_image is distinct from old.contractor_signature_image;
  end if;

  if not touched then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.contractor_signed_at is not null then
    raise exception 'The business''s signature on a contract cannot be changed once it has been given.'
      using errcode = 'check_violation';
  end if;

  if coalesce(pg_catalog.current_setting('app.contractor_signing', true), '') <> 'on' then
    raise exception 'A contract is signed for the business only through sign_contract_as_contractor.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$function$;

revoke all on function private.keep_contractor_signature() from public, anon, authenticated;

drop trigger if exists keep_contractor_signature on public.contracts;
create trigger keep_contractor_signature
  before insert or update on public.contracts
  for each row execute function private.keep_contractor_signature();

/*
 * Signing a contract for the business, as the caller.
 *
 * With the caller's own adopted signature in that business, which is the only
 * signature it will use — there is no parameter to name somebody else's. The
 * refusals are conditions in the `where`, as `sign_contract_in_app`'s are:
 *
 *   already signed for the business   the first signature is the one that counts
 *   already signed by the customer    the business signs first, not after
 *   void, or with blanks              not a contract anybody should sign
 *   superseded                        a newer contract exists for the job
 *
 * Returns when the business signed — just now, or earlier if it already had —
 * and null when it could not: no saved signature, not a member, or one of the
 * refusals above.
 */
create or replace function public.sign_contract_as_contractor(p_contract_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path to ''
as $function$
declare
  caller uuid := auth.uid();
  signer public.contract_signers%rowtype;
  signed timestamptz;
begin
  if caller is null or p_contract_id is null then
    return null;
  end if;

  select saved.* into signer
  from public.contract_signers as saved
  join public.contracts as contract on contract.organization_id = saved.organization_id
  join public.organization_members as membership
    on membership.organization_id = contract.organization_id
   and membership.user_id = caller
  where contract.id = p_contract_id
    and saved.user_id = caller;

  if not found then
    return null;
  end if;

  perform pg_catalog.set_config('app.contractor_signing', 'on', true);

  update public.contracts as contract
  set contractor_signed_at = pg_catalog.now(),
      contractor_signed_by = caller,
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

revoke all on function public.sign_contract_as_contractor(uuid) from public, anon;
grant execute on function public.sign_contract_as_contractor(uuid) to authenticated, service_role;
