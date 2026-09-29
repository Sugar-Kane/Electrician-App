-- Let a customer sign the contract, in the app, for nothing.
--
-- The PDF has had a signature block since contracts shipped, with a comment on
-- it saying the space is real "so a printed copy can be signed by hand today
-- and an electronic signature can be [dropped in]". Nothing ever dropped one in.
--
-- PR #105 (Documenso) got as far as production: its columns and functions are
-- live even though its code never merged. This does not replace it. It adds a
-- second provider, `in_app`, alongside `documenso` on the same columns, so that
-- work stays usable and the two can never be mixed up on one contract.
--
-- Deliberately a first-party signature, not a witnessed one. It records who
-- signed, when, from where, and a hash proving the document has not changed
-- since — what ESIGN and UETA ask for, and the right weight for a contractor's
-- own service agreement. It is not a third party attesting, and nothing here
-- pretends it is.

/*
 * What this builds on from #105, created here as well.
 *
 * #105's migrations are in production but not in this repository, so without
 * these a database built from the repository — a Supabase branch, a local
 * reset — stops at the first constraint below that names `signature_provider`.
 * Every statement is `if not exists` with #105's own definition, index name
 * included: a no-op wherever #105 already ran, and still one if it merges.
 */
alter table public.contracts
  add column if not exists signature_provider text,
  add column if not exists signature_sent_at timestamptz,
  add column if not exists signed_at timestamptz,
  -- Only #105's send flow sets this. It is here because the index below names
  -- it, and the index has to match production's exactly or it is a different
  -- rule wearing the same name.
  add column if not exists signature_send_token uuid;

alter table public.documents
  add column if not exists signature_provider text;

-- One contract per job out for signature at a time. `sendSigningLink` relies
-- on it to refuse a second before any customer has been texted.
create unique index if not exists contracts_one_pending_signature_per_job_idx
  on public.contracts (job_id)
  where job_id is not null
    and (
      status = 'sent'
      or (status = 'draft' and signature_send_token is not null)
    );

-- The provider checks #105 wrote allow only 'documenso'.
alter table public.contracts
  drop constraint if exists contracts_signature_provider_check;
alter table public.contracts
  add constraint contracts_signature_provider_check
  check (signature_provider is null or signature_provider in ('documenso', 'in_app'));

alter table public.documents
  drop constraint if exists documents_signature_provider_check;
alter table public.documents
  add constraint documents_signature_provider_check
  check (signature_provider is null or signature_provider in ('documenso', 'in_app'));

-- `signed_at` and `signature_sent_at` are shared with #105 rather than
-- shadowed: a contract has one moment it was signed, whichever system took the
-- signature.
alter table public.contracts
  -- The unguessable handle for a texted link, as `booking_requests.public_token`
  -- works: the customer asked to sign has no account and must not need one.
  add column if not exists public_token uuid not null default gen_random_uuid(),
  add column if not exists signature_method text,
  add column if not exists signature_name text,
  -- The drawn signature as a PNG data URI, kept in the row rather than in
  -- storage. It is a few kilobytes, and a signature that can be separated from
  -- the document it signed is not evidence of anything.
  add column if not exists signature_image text,
  add column if not exists signed_ip text,
  add column if not exists signed_user_agent text,
  /*
   * The one that makes the rest mean something.
   *
   * SHA-256 of `body` at the moment of signing. Without it "signed" is a flag
   * anybody with write access could set; with it, the document can be shown not
   * to have changed afterwards. `body` is already frozen at generation for the
   * same reason — this is the proof that it stayed frozen.
   */
  add column if not exists signed_body_hash text;

create unique index if not exists contracts_public_token_idx
  on public.contracts (public_token);

alter table public.contracts
  drop constraint if exists contracts_signature_method_check;
alter table public.contracts
  add constraint contracts_signature_method_check
  check (signature_method is null or signature_method in ('drawn', 'typed'));

/*
 * An in-app signature is all of its parts or none of them.
 *
 * Scoped to `in_app` on purpose. Documenso marks a contract signed through
 * `finalize_signed_contract_document` without any of these fields, and a
 * constraint that demanded them everywhere would reject every row it writes.
 */
alter table public.contracts
  drop constraint if exists contracts_in_app_signature_complete;
alter table public.contracts
  add constraint contracts_in_app_signature_complete
  check (
    signature_provider is distinct from 'in_app'
    or signed_at is null
    or (
      signature_method is not null
      and coalesce(btrim(signature_name), '') <> ''
      and coalesce(btrim(signed_body_hash), '') <> ''
      and (signature_method <> 'drawn' or coalesce(btrim(signature_image), '') <> '')
    )
  );

/*
 * A signed contract's words do not change.
 *
 * The hash proves afterwards that they did not; this makes sure they cannot.
 * `canEditContract` already refuses a signed contract, but the scope edit reads
 * the status and then writes, and a signature landing between the two would
 * leave the customer's signature — and the PDF rebuilt straight afterwards,
 * printing it — under words they never saw. A trigger is met by every path:
 * the service role, and code nobody has written yet.
 *
 * The status is left free on purpose. A signed contract can still be voided.
 */
create or replace function private.keep_signed_contract_text()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if old.signed_at is null then
    return new;
  end if;

  if new.body is distinct from old.body then
    raise exception 'A signed contract cannot be reworded. Draft a new one alongside it.'
      using errcode = 'check_violation';
  end if;

  -- This app's own record of who signed, when and from where. Documenso's rows
  -- are left to Documenso's flow, which owns those fields.
  if old.signature_provider = 'in_app' and (
    new.signature_provider is distinct from old.signature_provider
    or new.signed_at is distinct from old.signed_at
    or new.signature_method is distinct from old.signature_method
    or new.signature_name is distinct from old.signature_name
    or new.signature_image is distinct from old.signature_image
    or new.signed_ip is distinct from old.signed_ip
    or new.signed_user_agent is distinct from old.signed_user_agent
    or new.signed_body_hash is distinct from old.signed_body_hash
  ) then
    raise exception 'A signature cannot be changed once it has been given.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

revoke all on function private.keep_signed_contract_text() from public, anon, authenticated;

drop trigger if exists keep_signed_contract_text on public.contracts;
create trigger keep_signed_contract_text
  before update on public.contracts
  for each row execute function private.keep_signed_contract_text();

/*
 * What a signer is allowed to see.
 *
 * Only the contract behind the token and the business that sent it, following
 * `get_public_booking_page`: the token is the only thing between this and the
 * world, so nothing here helps anyone guess at another contract.
 *
 * Dropped first because its columns changed, and `create or replace` cannot
 * change a function's columns — Postgres refuses rather than guessing.
 */
drop function if exists public.get_public_contract(uuid);

create function public.get_public_contract(p_token uuid)
returns table (
  contract_id uuid,
  organization_id uuid,
  business_name text,
  business_phone text,
  body text,
  unfilled text[],
  status text,
  signature_provider text,
  created_at timestamptz,
  signed_at timestamptz,
  signature_name text,
  customer_name text,
  job_number bigint,
  time_zone text,
  superseded boolean
)
language plpgsql
stable security definer
set search_path to ''
as $function$
begin
  return query
  select
    contract.id,
    contract.organization_id,
    organization.name,
    coalesce(organization.phone, ''),
    contract.body,
    contract.unfilled,
    contract.status,
    contract.signature_provider,
    contract.created_at,
    contract.signed_at,
    contract.signature_name,
    pg_catalog.btrim(pg_catalog.concat_ws(' ', customer.first_name, customer.last_name)),
    job.job_number,
    coalesce(organization.timezone, 'America/Los_Angeles'),
    -- Whether a newer contract has been drafted for the same job. Only the
    -- newest can be signed: the job page already calls the others superseded,
    -- and a customer holding an old link must not sign the old terms.
    exists (
      select 1
      from public.contracts as newer
      where newer.job_id = contract.job_id
        and newer.id <> contract.id
        and newer.status <> 'void'
        and newer.created_at > contract.created_at
    )
  from public.contracts as contract
  join public.organizations as organization
    on organization.id = contract.organization_id
  left join public.jobs as job on job.id = contract.job_id
  left join public.customers as customer on customer.id = job.customer_id
  where contract.public_token = p_token
    and organization.archived_at is null
    -- A voided contract is not a contract. The link stops working rather than
    -- showing something that looks signable and is not.
    and contract.status <> 'void'
  limit 1;
end;
$function$;

/*
 * Taking the signature, as one statement nobody can half-do.
 *
 * `security definer` so an anonymous signer never gets write access to
 * `contracts`. Every refusal is a condition in the `where`, not a check in
 * application code that a second request could race past:
 *
 *   already signed    the first signature is the one that counts
 *   void              there is nothing to sign
 *   superseded        a newer contract exists for the job, and an old link
 *                     must not sign the old terms
 *   has blanks        the PDF prints "Not ready to sign, N blanks to fill in",
 *                     and letting somebody sign it anyway makes that a lie
 *   out via Documenso a contract two systems are collecting signatures on is
 *                     a contract with two answers to "who signed, and when"
 *
 * Returns the contract id on success and nothing otherwise.
 */
create or replace function public.sign_contract_in_app(
  p_token uuid,
  p_method text,
  p_name text,
  p_image text,
  p_ip text,
  p_user_agent text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  signed_id uuid;
begin
  if p_method is null or p_method not in ('drawn', 'typed') then
    return null;
  end if;

  if coalesce(pg_catalog.btrim(p_name), '') = '' then
    return null;
  end if;

  if p_method = 'drawn' and coalesce(pg_catalog.btrim(p_image), '') = '' then
    return null;
  end if;

  update public.contracts as contract
  set status = 'signed',
      signature_provider = 'in_app',
      signed_at = pg_catalog.now(),
      signature_method = p_method,
      signature_name = pg_catalog.btrim(p_name),
      signature_image = case when p_method = 'drawn' then p_image else null end,
      signed_ip = nullif(pg_catalog.btrim(coalesce(p_ip, '')), ''),
      signed_user_agent = nullif(pg_catalog.btrim(coalesce(p_user_agent, '')), ''),
      -- Hashed here, from the row, and never taken from the caller. A hash the
      -- client supplies proves only that the client can count.
      signed_body_hash = pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(contract.body, 'UTF8')), 'hex'
      ),
      updated_at = pg_catalog.now()
  where contract.public_token = p_token
    and contract.signed_at is null
    and contract.status <> 'void'
    and pg_catalog.cardinality(contract.unfilled) = 0
    and contract.signature_provider is distinct from 'documenso'
    and not exists (
      select 1
      from public.contracts as newer
      where newer.job_id = contract.job_id
        and newer.id <> contract.id
        and newer.status <> 'void'
        and newer.created_at > contract.created_at
    )
  returning contract.id into signed_id;

  return signed_id;
end;
$function$;

revoke all on function public.get_public_contract(uuid) from public;
grant execute on function public.get_public_contract(uuid) to anon, authenticated, service_role;

revoke all on function public.sign_contract_in_app(uuid, text, text, text, text, text) from public;
grant execute on function public.sign_contract_in_app(uuid, text, text, text, text, text)
  to anon, authenticated, service_role;
