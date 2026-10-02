-- Which invoice billed each line, and change orders.
--
-- An invoice has been a set of totals with no lines of its own. Its PDF listed
-- every line on the job, and raising another invoice summed every line again —
-- so a part remembered after the first invoice went out could only be billed
-- by billing the whole job a second time, and rebuilding an old invoice's PDF
-- printed lines it never charged for.
--
-- A line now records the invoice that billed it. A line with none is unbilled,
-- and is what the next invoice is for: added to a draft nobody has been sent,
-- or billed on its own once the first invoice has gone out or been paid.

alter table public.job_line_items
  add column if not exists invoice_id uuid references public.invoices (id) on delete set null;

comment on column public.job_line_items.invoice_id is
  'The invoice that billed this line. Null until one does. Set null when that invoice is deleted, which hands the line back to be billed again.';

create index if not exists job_line_items_invoice_idx
  on public.job_line_items (invoice_id)
  where invoice_id is not null;

-- The lines already written: billed by the first invoice their job raised at
-- or after them, which is the invoice whose PDF first listed them. A line
-- written after its job's last invoice was never on one, and stays unbilled. A
-- void invoice billed nothing.
update public.job_line_items as line
set invoice_id = (
  select invoice.id
  from public.invoices as invoice
  where invoice.job_id = line.job_id
    and invoice.organization_id = line.organization_id
    and invoice.status <> 'void'
    and invoice.created_at >= line.created_at
  order by invoice.created_at asc
  limit 1
)
where line.invoice_id is null;

-- A signed agreement is amended in writing, not edited. Work added after the
-- customer signed goes on a change order: a contract of its own, listing what
-- was added, signed the same way. Every contract until now was an agreement.
alter table public.contracts
  add column if not exists kind text not null default 'agreement';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contracts_kind_check'
      and conrelid = 'public.contracts'::regclass
  ) then
    alter table public.contracts
      add constraint contracts_kind_check check (kind in ('agreement', 'change_order'));
  end if;
end;
$$;
