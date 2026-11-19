-- The scope of work, written once on the job and used by its paperwork.
--
-- A contract's scope paragraph was drafted from the customer's own words when
-- the contract was made: a job booked as "Needs" became "The contractor will
-- perform work order as requested: Needs." The electrician now writes the
-- scope on the job's Estimate card, typed or drafted from the work and
-- materials lines, and the contract and the estimate the customer reads both
-- use it.

alter table public.jobs
  add column if not exists scope_of_work text
  check (scope_of_work is null or char_length(scope_of_work) <= 2000);

-- The customer's estimate page: the scope when there is one, otherwise what
-- they asked for, as before.
create or replace function public.get_estimate_by_link(p_token uuid)
returns table(
  business_name text, business_phone text, customer_name text, estimate_number bigint,
  job_number bigint, status text, subtotal_cents integer, diagnostic_credit_cents integer,
  tax_cents integer, total_cents integer, expires_at timestamp with time zone,
  last_sent_at timestamp with time zone, created_at timestamp with time zone,
  work_summary text, time_zone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    organization.name,
    organization.phone,
    nullif(trim(coalesce(
      nullif(customer.company_name, ''),
      concat_ws(' ', nullif(customer.first_name, 'Text'), customer.last_name)
    )), ''),
    estimate.estimate_number,
    job.job_number,
    estimate.status,
    estimate.subtotal_cents,
    estimate.diagnostic_credit_cents,
    estimate.tax_cents,
    estimate.total_cents,
    estimate.expires_at,
    estimate.last_sent_at,
    estimate.created_at,
    coalesce(nullif(trim(job.scope_of_work), ''), job.customer_description),
    coalesce(organization.timezone, 'America/Los_Angeles')
  from public.estimates as estimate
  join public.organizations as organization on organization.id = estimate.organization_id
  left join public.jobs as job on job.id = estimate.job_id
  left join public.customers as customer on customer.id = job.customer_id
  where estimate.preview_token = p_token
    and organization.archived_at is null
  limit 1;
$$;
