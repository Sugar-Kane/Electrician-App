-- Payment plans: a deposit, installments, and the balance.
--
-- A business can ask for a deposit and split what a job costs into payments,
-- before the work or over time after it. The plan is set on the job, printed
-- on the contract the customer signs (a snapshot, so a later change to the
-- plan does not rewrite a signed agreement), and each payment is asked for
-- when it comes due. Money paid before the job's invoice exists is kept as a
-- prepayment and put onto the invoice as a payment when it is raised, so the
-- invoice total never changes and nothing is billed twice.

create table if not exists public.job_payment_plan_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  position integer not null check (position >= 0),
  kind text not null check (kind in ('deposit', 'installment', 'final')),
  amount_type text not null check (amount_type in ('fixed', 'percent')),
  amount_cents integer check (amount_cents is null or amount_cents > 0),
  percent_bps integer check (percent_bps is null or (percent_bps > 0 and percent_bps < 10000)),
  due text not null check (due in ('on_signing', 'on_date', 'on_completion')),
  due_date date,
  -- When the customer was last asked for this payment.
  requested_at timestamptz,
  -- The customer's pay link for this payment: unguessable, the only key it needs.
  pay_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due <> 'on_date' or due_date is not null),
  check (kind = 'final' or (amount_type = 'fixed' and amount_cents is not null) or (amount_type = 'percent' and percent_bps is not null)),
  unique (job_id, position)
);

create index if not exists job_payment_plan_items_job_idx on public.job_payment_plan_items (job_id, position);
create index if not exists job_payment_plan_items_due_idx
  on public.job_payment_plan_items (due_date)
  where due = 'on_date' and requested_at is null;

create table if not exists public.job_prepayments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  plan_item_id uuid references public.job_payment_plan_items (id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  method text not null check (method in ('card', 'ach', 'cash', 'check', 'other')),
  stripe_checkout_session_id text unique,
  note text check (note is null or char_length(note) <= 300),
  recorded_by uuid references auth.users (id) on delete set null,
  received_at timestamptz not null default now(),
  -- Set once it has been put onto the job's invoice as a payment.
  applied_invoice_payment_id uuid references public.invoice_payments (id) on delete set null,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists job_prepayments_job_idx on public.job_prepayments (job_id);
create index if not exists job_prepayments_unapplied_idx on public.job_prepayments (job_id) where applied_at is null;

alter table public.contracts
  add column if not exists payment_schedule jsonb;

-- Same business only, through the guard every tenant table uses.
create or replace trigger zz_tenant_references_guard
  before insert or update on public.job_payment_plan_items
  for each row execute function private.guard_tenant_references('job_id', 'jobs');

create or replace trigger zz_tenant_references_guard
  before insert or update on public.job_prepayments
  for each row execute function private.guard_tenant_references('job_id', 'jobs', 'plan_item_id', 'job_payment_plan_items');

create or replace trigger zz_tenant_owner_immutable
  before update of organization_id on public.job_payment_plan_items
  for each row execute function private.keep_tenant_owner();

create or replace trigger zz_tenant_owner_immutable
  before update of organization_id on public.job_prepayments
  for each row execute function private.keep_tenant_owner();

create or replace trigger set_job_payment_plan_items_updated_at
  before update on public.job_payment_plan_items
  for each row execute function public.set_updated_at();

alter table public.job_payment_plan_items enable row level security;
alter table public.job_prepayments enable row level security;

-- Members see their business's plans and payments. Changing a plan, or
-- recording money received, is a billing change.
create policy "Members can view payment plans" on public.job_payment_plan_items
  for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "Billing editors can add payment plan items" on public.job_payment_plan_items
  for insert to authenticated with check ((select private.can_edit_billing(organization_id)));
create policy "Billing editors can change payment plan items" on public.job_payment_plan_items
  for update to authenticated using ((select private.can_edit_billing(organization_id)))
  with check ((select private.can_edit_billing(organization_id)));
create policy "Billing editors can remove payment plan items" on public.job_payment_plan_items
  for delete to authenticated using ((select private.can_edit_billing(organization_id)));

create policy "Members can view prepayments" on public.job_prepayments
  for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "Billing editors can record prepayments" on public.job_prepayments
  for insert to authenticated with check (
    (select private.can_edit_billing(organization_id))
    and stripe_checkout_session_id is null
    and applied_at is null
    and method in ('cash', 'check', 'other')
  );

-- Putting a job's prepayments onto one of its invoices: each whole, oldest
-- first, while it fits what is owed. Returns what is still owed. Used when an
-- invoice is sent and when it is marked paid in hand, so a deposit already
-- received is never collected a second time. A prepayment larger than what
-- is left stays unapplied, for the business to refund.
create or replace function private.apply_prepayments_to_invoice(
  p_invoice_id uuid,
  p_organization_id uuid,
  p_job_id uuid,
  p_owed integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  prepaid record;
  owed integer := greatest(0, coalesce(p_owed, 0));
  payment_id uuid;
begin
  if p_job_id is null then
    return owed;
  end if;
  for prepaid in
    select p.* from public.job_prepayments as p
    where p.job_id = p_job_id
      and p.organization_id = p_organization_id
      and p.applied_at is null
    order by p.received_at, p.created_at
    for update
  loop
    continue when prepaid.amount_cents > owed;
    insert into public.invoice_payments (organization_id, invoice_id, job_id, method, amount_cents, note, recorded_by)
    values (
      p_organization_id, p_invoice_id, p_job_id,
      case prepaid.method when 'ach' then 'bank' else prepaid.method end,
      prepaid.amount_cents,
      'Paid before the invoice (deposit or installment)',
      prepaid.recorded_by
    )
    returning id into payment_id;
    update public.job_prepayments
       set applied_invoice_payment_id = payment_id, applied_at = now()
     where id = prepaid.id;
    owed := owed - prepaid.amount_cents;
  end loop;
  return owed;
end;
$$;

revoke all on function private.apply_prepayments_to_invoice(uuid, uuid, uuid, integer) from public, anon, authenticated;

-- When a job's invoice is sent (it leaves draft), the deposits and
-- installments already paid go onto it as payments, so the balance the
-- customer is asked for is what is left. The total does not change, so
-- nothing is billed twice.
create or replace function private.apply_job_prepayments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_owed integer;
  owed integer;
begin
  if old.status <> 'draft' or new.status in ('draft', 'void') or new.job_id is null or new.stripe_invoice_id is not null then
    return new;
  end if;
  before_owed := coalesce(new.balance_due_cents, new.total_cents, 0);
  owed := private.apply_prepayments_to_invoice(new.id, new.organization_id, new.job_id, before_owed);
  if owed < before_owed then
    new.balance_due_cents := owed;
    if owed <= 0 then
      new.status := 'paid';
      new.paid_at := coalesce(new.paid_at, now());
    elsif new.status = 'sent' then
      new.status := 'partially_paid';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.apply_job_prepayments() from public, anon, authenticated;

create or replace trigger zz_apply_job_prepayments
  before update of status on public.invoices
  for each row execute function private.apply_job_prepayments();

-- Marked paid in hand: the job's prepayments go on first, and only what is
-- left is recorded as collected now. Otherwise the same as before.
create or replace function public.record_invoice_paid_in_hand(
  p_invoice_id uuid,
  p_method text,
  p_note text default null,
  p_organization_id uuid default null,
  p_recorded_by uuid default null
)
returns table(status text, amount_cents integer, paid_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
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

  -- What the customer already paid toward the job comes off first.
  owed := private.apply_prepayments_to_invoice(invoice.id, invoice.organization_id, invoice.job_id, owed);

  if owed > 0 then
    insert into public.invoice_payments (organization_id, invoice_id, job_id, method, amount_cents, note, recorded_by)
    values (invoice.organization_id, invoice.id, invoice.job_id, p_method, owed, nullif(trim(coalesce(p_note, '')), ''), recorder);
  end if;

  update public.invoices as i
     set balance_due_cents = 0,
         status = 'paid',
         paid_at = settled_at
   where i.id = invoice.id;

  return query select 'paid'::text, owed, settled_at;
end;
$$;
