-- An invoice the customer has already paid in hand (cash, a check, a card run
-- outside the app), so the business can mark it paid and send the customer the
-- paid invoice as their record.
--
-- Unlike record_invoice_payment, this settles the whole balance at once and
-- accepts a draft: a customer who paid cash on the spot was never sent a bill
-- to pay. Refused for a void or already-paid invoice, one collected online by
-- Stripe, one with nothing on it, or an unknown method.
--
-- Called two ways:
-- - by a signed-in member (the app): must be a member of the invoice's
--   business; the payment is recorded as theirs.
-- - by the server (service role, for the ChatGPT/Claude connection): must name
--   the invoice's business, and the person recorded, if named, must be a
--   member of it.

create or replace function public.record_invoice_paid_in_hand(
  p_invoice_id uuid,
  p_method text,
  p_note text default null,
  p_organization_id uuid default null,
  p_recorded_by uuid default null
)
returns table (status text, amount_cents integer, paid_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  invoice record;
  owed integer;
  caller uuid := auth.uid();
  recorder uuid;
  settled_at timestamptz := now();
begin
  select i.id, i.organization_id, i.job_id, i.status, i.total_cents, i.balance_due_cents, i.stripe_invoice_id
    into invoice
  from public.invoices as i
  where i.id = p_invoice_id
  for update;

  if invoice.id is null then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;

  if caller is not null then
    if not private.is_org_member(invoice.organization_id) then
      raise exception 'invoice not found' using errcode = 'P0002';
    end if;
    recorder := caller;
  else
    if p_organization_id is null or p_organization_id <> invoice.organization_id then
      raise exception 'invoice not found' using errcode = 'P0002';
    end if;
    if p_recorded_by is not null and not exists (
      select 1 from public.organization_members m
       where m.organization_id = invoice.organization_id and m.user_id = p_recorded_by
    ) then
      raise exception 'invoice not found' using errcode = 'P0002';
    end if;
    recorder := p_recorded_by;
  end if;

  if invoice.status = 'void' then
    raise exception 'this invoice is void' using errcode = '22023';
  end if;
  if invoice.status = 'paid' then
    raise exception 'this invoice is already paid' using errcode = '22023';
  end if;
  if invoice.stripe_invoice_id is not null then
    raise exception 'this invoice is collected online' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('cash', 'check', 'card', 'other') then
    raise exception 'unknown payment method' using errcode = '22023';
  end if;

  owed := coalesce(invoice.balance_due_cents, invoice.total_cents, 0);
  if owed <= 0 then
    raise exception 'nothing is owed on this invoice' using errcode = '22023';
  end if;

  insert into public.invoice_payments (organization_id, invoice_id, job_id, method, amount_cents, note, recorded_by)
  values (invoice.organization_id, invoice.id, invoice.job_id, p_method, owed, nullif(trim(coalesce(p_note, '')), ''), recorder);

  update public.invoices as i
     set balance_due_cents = 0,
         status = 'paid',
         paid_at = settled_at
   where i.id = invoice.id;

  return query select 'paid'::text, owed, settled_at;
end;
$function$;

revoke all on function public.record_invoice_paid_in_hand(uuid, text, text, uuid, uuid) from public, anon;
grant execute on function public.record_invoice_paid_in_hand(uuid, text, text, uuid, uuid) to authenticated, service_role;
