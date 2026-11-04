-- The customer's invoice link shows the total, not the parts list.
--
-- An invoice is billed from the job's line items: every material and its
-- price, and the labor. The electrician builds and keeps that list; the
-- customer is billed the total for the work. This function feeds the
-- customer's invoice page and is callable with only the link's token, so the
-- line items stop leaving the database here rather than merely being hidden on
-- the page: `lines` is always an empty list now.
--
-- Same name, arguments and columns as before, so nothing that calls it breaks.

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
    '[]'::jsonb
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
