-- Progress payments only after the work: California B&P 7159.5 limits money
-- taken before the work to the down payment (10% of the contract price or
-- $1,000, whichever is less), and forbids progress payments ahead of the work
-- performed (compliance CSLB-004-001/002/004, CSLB-005-001).
--
-- 1. A progress payment (an installment not due on signing) is marked done by
--    the owner or office when its work is finished; only then can it be asked
--    for or paid. Kept with the plan item; cleared when the payment changes.
-- 2. A backstop in the database: money recorded by hand (cash, check, other)
--    and pay-link checkouts may not take a job under a contract or payment plan
--    past the down payment allowance plus the work marked done, until the job
--    is complete. Card and bank payments Stripe has already taken are always
--    recorded (refusing them would lose track of money received); they are
--    limited before the customer pays, at the checkout.

alter table public.job_payment_plan_items
  add column if not exists done_at timestamptz,
  add column if not exists done_by uuid references auth.users (id) on delete set null;

comment on column public.job_payment_plan_items.done_at is
  'When the work this progress payment is for was marked done. A progress payment can be asked for or paid only after this (B&P 7159.5).';

-- What may still be taken on a job before it is complete, in cents; null for
-- no limit (complete, or not under a contract or payment plan).
create or replace function private.job_pre_work_room(p_job_id uuid, p_ignore_checkout uuid default null)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  job_status text;
  signed_total bigint;
  line_total bigint;
  base bigint;
  done_cents bigint;
  taken bigint;
  has_plan boolean;
begin
  select j.status into job_status from public.jobs j where j.id = p_job_id;
  if job_status is null or job_status = 'completed' then
    return null;
  end if;

  select c.total_cents into signed_total
    from public.contracts c
   where c.job_id = p_job_id and c.signed_at is not null
   order by c.signed_at desc
   limit 1;
  select exists (select 1 from public.job_payment_plan_items i where i.job_id = p_job_id) into has_plan;
  if signed_total is null and not has_plan then
    return null;
  end if;

  select coalesce(sum(pg_catalog.round(l.quantity * l.unit_price_cents)), 0)::bigint into line_total
    from public.job_line_items l where l.job_id = p_job_id;
  base := coalesce(nullif(signed_total, 0), line_total);

  -- Progress payments whose work is marked done; a percentage is of the job's priced total, as the plan works it out.
  select coalesce(sum(case when i.amount_type = 'percent' then pg_catalog.round(line_total * i.percent_bps / 10000.0) else i.amount_cents end), 0)::bigint
    into done_cents
    from public.job_payment_plan_items i
   where i.job_id = p_job_id and i.kind = 'installment' and i.due <> 'on_signing' and i.done_at is not null;

  select coalesce((select sum(p.amount_cents) from public.job_prepayments p where p.job_id = p_job_id), 0)
       + coalesce((select sum(k.amount_cents) from public.job_prepayment_checkouts k
                    where k.job_id = p_job_id and k.status in ('creating', 'open', 'processing')
                      and (p_ignore_checkout is null or k.id <> p_ignore_checkout)), 0)
    into taken;

  return greatest(0, least(base / 10, 100000) + done_cents - taken);
end;
$$;

revoke all on function private.job_pre_work_room(uuid, uuid) from public, anon, authenticated;

create or replace function private.guard_pre_work_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  room bigint;
begin
  -- Money Stripe has already taken is recorded whatever happens.
  if tg_table_name = 'job_prepayments' and new.method in ('card', 'ach') then
    return new;
  end if;
  room := private.job_pre_work_room(new.job_id, case when tg_table_name = 'job_prepayment_checkouts' then new.id end);
  if room is not null and new.amount_cents > room then
    raise exception 'California limits money taken before the work to the down payment plus work marked done. At most % more can be taken on this job now.',
      pg_catalog.to_char(room / 100.0, 'FM$999,999,990.00')
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_pre_work_payment() from public, anon, authenticated;

drop trigger if exists guard_pre_work_payment on public.job_prepayments;
create trigger guard_pre_work_payment
  before insert on public.job_prepayments
  for each row execute function private.guard_pre_work_payment();

drop trigger if exists guard_pre_work_payment on public.job_prepayment_checkouts;
create trigger guard_pre_work_payment
  before insert on public.job_prepayment_checkouts
  for each row execute function private.guard_pre_work_payment();
