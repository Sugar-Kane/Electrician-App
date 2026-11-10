-- Owners choose whether technicians may change billing.
--
-- `organizations.technicians_can_edit_billing` (default on, so nothing
-- changes until an owner turns it off). Off, a technician can still see
-- invoices and payments but cannot raise, edit, send, delete or record a
-- payment on an invoice, or edit a payment. Every other role is unchanged.
--
-- Only an owner can flip the setting. And `organizations.created_by` can no
-- longer be changed by a signed-in user: admins may update the organization,
-- and the owner-only guards from 20261111010000 trust the creator, so an
-- admin rewriting created_by to themselves would have got around them.

alter table public.organizations
  add column if not exists technicians_can_edit_billing boolean not null default true;

create or replace function private.can_edit_billing(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_members as membership
      join public.organizations as organization on organization.id = membership.organization_id
      where membership.organization_id = target_organization_id
        and membership.user_id = (select auth.uid())
        and (membership.role <> 'technician' or organization.technicians_can_edit_billing)
    );
$$;

revoke all on function private.can_edit_billing(uuid) from public, anon;
grant execute on function private.can_edit_billing(uuid) to authenticated, service_role;

-- Invoices: members read; writes need billing permission.
drop policy if exists "Organization members can add invoices" on public.invoices;
drop policy if exists "Organization members can update invoices" on public.invoices;
drop policy if exists "Organization members can delete invoices" on public.invoices;

create policy "Billing members can add invoices" on public.invoices
  for insert with check ((select private.can_edit_billing(organization_id)));
create policy "Billing members can update invoices" on public.invoices
  for update using ((select private.can_edit_billing(organization_id)))
  with check ((select private.can_edit_billing(organization_id)));
create policy "Billing members can delete invoices" on public.invoices
  for delete using ((select private.can_edit_billing(organization_id)));

drop policy if exists "Organization members can update payments" on public.payments;
create policy "Billing members can update payments" on public.payments
  for update using ((select private.can_edit_billing(organization_id)))
  with check ((select private.can_edit_billing(organization_id)));

-- The two payment functions a signed-in member calls check the same rule.
-- Bodies are unchanged apart from that check.
create or replace function public.record_invoice_payment(p_invoice_id uuid, p_method text, p_amount_cents integer, p_note text default null::text)
 returns table(status text, balance_due_cents integer)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  invoice record;
  owed integer;
  remaining integer;
  next_status text;
begin
  select i.id, i.organization_id, i.job_id, i.status, i.total_cents, i.balance_due_cents, i.stripe_invoice_id
    into invoice
  from public.invoices as i
  where i.id = p_invoice_id
  for update;

  if invoice.id is null or not private.is_org_member(invoice.organization_id) then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  if not private.can_edit_billing(invoice.organization_id) then
    raise exception 'technicians cannot record payments in this business' using errcode = '42501';
  end if;
  if invoice.status = 'void' then
    raise exception 'this invoice is void' using errcode = '22023';
  end if;
  if invoice.status = 'paid' then
    raise exception 'this invoice is already paid' using errcode = '22023';
  end if;
  if invoice.status = 'draft' then
    raise exception 'send the invoice before recording a payment' using errcode = '22023';
  end if;
  if invoice.stripe_invoice_id is not null then
    raise exception 'this invoice is collected online' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('cash', 'check', 'card', 'other') then
    raise exception 'unknown payment method' using errcode = '22023';
  end if;

  owed := coalesce(invoice.balance_due_cents, invoice.total_cents, 0);
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'the amount must be more than zero' using errcode = '22023';
  end if;
  if p_amount_cents > owed then
    raise exception 'the amount is more than is owed' using errcode = '22023';
  end if;

  insert into public.invoice_payments (organization_id, invoice_id, job_id, method, amount_cents, note, recorded_by)
  values (invoice.organization_id, invoice.id, invoice.job_id, p_method, p_amount_cents, nullif(trim(coalesce(p_note, '')), ''), auth.uid());

  remaining := owed - p_amount_cents;
  next_status := case when remaining <= 0 then 'paid' else 'partially_paid' end;

  update public.invoices as i
  set balance_due_cents = remaining,
      status = next_status,
      paid_at = case when remaining <= 0 then now() else i.paid_at end
  where i.id = invoice.id;

  return query select next_status, remaining;
end;
$function$;

create or replace function public.record_invoice_paid_in_hand(p_invoice_id uuid, p_method text, p_note text default null::text, p_organization_id uuid default null::uuid, p_recorded_by uuid default null::uuid)
 returns table(status text, amount_cents integer, paid_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to ''
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
    if not private.can_edit_billing(invoice.organization_id) then
      raise exception 'technicians cannot record payments in this business' using errcode = '42501';
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

-- Only an owner flips the setting; nobody signed in rewrites created_by.
create or replace function private.guard_organization_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.created_by is distinct from old.created_by and not (select private.is_platform_owner()) then
    raise exception using errcode = '42501', message = 'The business''s creator cannot be changed.';
  end if;
  if new.technicians_can_edit_billing is distinct from old.technicians_can_edit_billing
    and not (select private.can_grant_owner(old.id)) then
    raise exception using errcode = '42501', message = 'Only an owner can change who edits billing.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_organization_settings() from public, anon, authenticated;

drop trigger if exists guard_organization_settings on public.organizations;
create trigger guard_organization_settings
  before update on public.organizations
  for each row execute function private.guard_organization_settings();
