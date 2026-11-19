-- A follow-up job remembers the job it continues.
--
-- More work found at the end of a job is booked as a new job, with its own
-- estimate, contract and invoice. Booked from a diagnostic it is linked by
-- follow_up_of, which also carries the diagnostic fee credit. Booked from any
-- other job it was not linked at all, so its contract could not say it
-- continues earlier work. continues_job_id records that, and nothing else: no
-- credit, no billing.

alter table public.jobs
  add column if not exists continues_job_id uuid references public.jobs (id) on delete set null;

create index if not exists jobs_continues_job_id_idx
  on public.jobs (continues_job_id)
  where continues_job_id is not null;

-- Only a job of the same business, and never itself. Invoker rights, like
-- jobs_follow_up_same_business: whoever writes the job can see its business's jobs.
create or replace function public.jobs_continues_same_business()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.continues_job_id is not null and (
    new.continues_job_id = new.id
    or not exists (
      select 1
      from public.jobs as continued
      where continued.id = new.continues_job_id
        and continued.organization_id = new.organization_id
    )
  ) then
    raise exception 'A job can only continue another job of the same business.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace trigger jobs_continues_same_business
  before insert or update of continues_job_id, organization_id on public.jobs
  for each row
  execute function public.jobs_continues_same_business();
