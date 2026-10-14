-- What finishing each step of a job needs that was not stored anywhere:
--
--   * Materials: "ready" was only ever inferred from the visit having started.
--     The electrician who loads the van the night before had nothing to tick.
--   * Invoice: a customer could not see the invoice they were sent. The text
--     said "call to pay" and carried nothing to read, and there was no way to
--     show them the bill ahead of the work (a preview, once the contract is
--     signed). One unguessable link now serves both.
--   * Paid: invoices are not collected online, so an invoice could never be
--     marked paid at all. Payments taken in hand are recorded here, and the
--     invoice's balance and status follow in the same transaction.
--
-- Adds only. Nothing is dropped or rewritten. (Not the `payments` table: that
-- is Stripe's ledger, and its provider check allows only 'stripe'.)

alter table public.jobs
  add column if not exists materials_ready_at timestamptz;

comment on column public.jobs.materials_ready_at is
  'When somebody marked the job''s materials gathered and ready. Null until then.';

alter table public.invoices
  add column if not exists preview_token uuid not null default gen_random_uuid(),
  add column if not exists preview_sent_at timestamptz;

create unique index if not exists invoices_preview_token_key
  on public.invoices (preview_token);

comment on column public.invoices.preview_token is
  'The customer''s link to read this invoice: a preview while it is a draft, the bill once sent.';
comment on column public.invoices.preview_sent_at is
  'When a preview of this draft was last sent to the customer. Sending a preview never makes the invoice sent.';

create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  method text not null check (method in ('cash', 'check', 'card', 'other')),
  amount_cents integer not null check (amount_cents > 0),
  note text,
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now()
);

create index if not exists invoice_payments_invoice_idx
  on public.invoice_payments (invoice_id);

alter table public.invoice_payments enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'invoice_payments'
      and policyname = 'Organization members can view invoice payments'
  ) then
    create policy "Organization members can view invoice payments"
      on public.invoice_payments for select to authenticated
      using ((select private.is_org_member(organization_id)));
  end if;
end
$$;

comment on table public.invoice_payments is
  'Payments taken in hand (cash, check, a card run outside the app). Written only by record_invoice_payment.';

-- Recording a payment, all at once: the payment row, the invoice's new balance,
-- and its status. Refused for an invoice the caller's business does not own,
-- one that is void, still a draft or already paid, one collected online by
-- Stripe, or an amount that is not positive or is more than is owed.
create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_method text,
  p_amount_cents integer,
  p_note text default null
)
returns table (status text, balance_due_cents integer)
language plpgsql
security definer
set search_path = ''
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

revoke all on function public.record_invoice_payment(uuid, text, integer, text) from public, anon;
grant execute on function public.record_invoice_payment(uuid, text, integer, text) to authenticated;

-- The customer's invoice, by its link: the business, the bill and its lines.
-- A void invoice is not shown.
create or replace function public.get_invoice_by_link(p_token uuid)
returns table (
  business_name text,
  business_phone text,
  customer_name text,
  invoice_number bigint,
  status text,
  subtotal_cents integer,
  diagnostic_credit_cents integer,
  tax_cents integer,
  total_cents integer,
  balance_due_cents integer,
  due_at timestamptz,
  last_sent_at timestamptz,
  paid_at timestamptz,
  work_summary text,
  time_zone text,
  lines jsonb
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    organization.name,
    organization.phone,
    nullif(trim(coalesce(nullif(customer.company_name, ''), concat_ws(' ', nullif(customer.first_name, 'Text'), customer.last_name))), ''),
    invoice.invoice_number,
    invoice.status,
    invoice.subtotal_cents,
    invoice.diagnostic_credit_cents,
    invoice.tax_cents,
    invoice.total_cents,
    invoice.balance_due_cents,
    invoice.due_at,
    invoice.last_sent_at,
    invoice.paid_at,
    job.customer_description,
    coalesce(organization.timezone, 'America/Los_Angeles'),
    coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'kind', line.kind,
          'description', line.description,
          'quantity', line.quantity,
          'unit', line.unit,
          'unit_price_cents', line.unit_price_cents
        ) order by line.created_at)
        from public.job_line_items as line
        where line.invoice_id = invoice.id
      ),
      '[]'::jsonb
    )
  from public.invoices as invoice
  join public.organizations as organization
    on organization.id = invoice.organization_id
  left join public.jobs as job
    on job.id = invoice.job_id
  left join public.customers as customer
    on customer.id = job.customer_id
  where invoice.preview_token = p_token
    and invoice.status <> 'void'
    and organization.archived_at is null
  limit 1;
$function$;

revoke all on function public.get_invoice_by_link(uuid) from public;
grant execute on function public.get_invoice_by_link(uuid) to anon, authenticated;
