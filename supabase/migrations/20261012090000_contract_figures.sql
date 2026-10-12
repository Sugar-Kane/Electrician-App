-- What the customer is asked to approve, as figures.
--
-- A contract's price has only ever been words in its body — "Total: $1,280.00",
-- "Deposit due before work begins: $180.00 (paid)" — filled in when it was
-- drawn up. The signing page now opens with a summary of the money, and the
-- job page shows the same figures before a link is sent, so they are saved
-- beside the words at the moment the words are written. Read back from here,
-- the summary cannot disagree with the contract it sits above, even after the
-- job's lines change.
--
-- Null on contracts drawn up before this, which show no summary figures and
-- point at the price in the contract instead.

alter table public.contracts
  add column if not exists total_cents integer check (total_cents is null or total_cents >= 0),
  add column if not exists deposit_cents integer check (deposit_cents is null or deposit_cents >= 0),
  add column if not exists deposit_paid boolean;

comment on column public.contracts.total_cents is
  'The price the contract states, in cents, saved when it was drawn up.';
comment on column public.contracts.deposit_cents is
  'The diagnostic fee the contract states, in cents.';
comment on column public.contracts.deposit_paid is
  'Whether that fee was already paid when the contract was drawn up.';

-- Signed figures stay as signed, the same rule keep_signed_contract_text
-- applies to the words.
create or replace function private.keep_signed_contract_figures()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if old.signed_at is not null and (
    new.total_cents is distinct from old.total_cents
    or new.deposit_cents is distinct from old.deposit_cents
    or new.deposit_paid is distinct from old.deposit_paid
  ) then
    raise exception 'A signed contract''s figures cannot be changed.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

revoke all on function private.keep_signed_contract_figures() from public, anon, authenticated;

create or replace trigger keep_signed_contract_figures
  before update on public.contracts
  for each row execute function private.keep_signed_contract_figures();
