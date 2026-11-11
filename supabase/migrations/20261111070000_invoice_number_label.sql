-- Invoice numbers that match the job.
--
-- `invoice_number` is a running count across the business, so job #24's
-- invoice could be INV-11. From now on an invoice is labelled after its job:
-- job #24's first invoice is INV-24, a second one INV-24-2, and so on. The
-- count stays as it is (unique per business, used by links and lookups); the
-- label is what every screen, PDF and message shows.
--
-- Additive. Invoices that already exist keep the number they were sent with:
-- their label is their old number, so nothing a customer already holds
-- changes. A new label that an old invoice already uses (job #11 when an old
-- INV-11 exists) takes the next free suffix rather than a duplicate.

alter table public.invoices add column if not exists number_label text;

update public.invoices
set number_label = invoice_number::text
where number_label is null;

create or replace function private.set_invoice_number_label()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  base text;
  candidate text;
  suffix integer := 1;
begin
  if new.number_label is not null and pg_catalog.btrim(new.number_label) <> '' then
    return new;
  end if;

  select job.job_number::text into base
  from public.jobs as job
  where job.id = new.job_id
    and job.organization_id = new.organization_id;

  if base is null then
    new.number_label := new.invoice_number::text;
    return new;
  end if;

  candidate := base;
  while exists (
    select 1 from public.invoices as other
    where other.organization_id = new.organization_id
      and other.number_label = candidate
  ) loop
    suffix := suffix + 1;
    candidate := base || '-' || suffix::text;
  end loop;

  new.number_label := candidate;
  return new;
end;
$function$;

revoke all on function private.set_invoice_number_label() from public, anon, authenticated;

drop trigger if exists invoices_number_label on public.invoices;
create trigger invoices_number_label
  before insert on public.invoices
  for each row execute function private.set_invoice_number_label();

create unique index if not exists invoices_org_number_label_idx
  on public.invoices (organization_id, number_label);

-- The label for the customer's invoice link. Beside get_invoice_by_link
-- rather than in it, so that function's columns stay exactly as they were.
create or replace function public.get_invoice_label_by_link(p_token uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select invoice.number_label
  from public.invoices as invoice
  join public.organizations as organization on organization.id = invoice.organization_id
  where invoice.preview_token = p_token
    and invoice.status <> 'void'
    and organization.archived_at is null
  limit 1;
$function$;

revoke all on function public.get_invoice_label_by_link(uuid) from public;
grant execute on function public.get_invoice_label_by_link(uuid) to anon, authenticated, service_role;
