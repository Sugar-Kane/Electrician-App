-- A work order booked to do what a diagnostic found.
--
-- A diagnostic is two hours to find the fault, paid for when it is booked, and
-- the fee is credited against the repair. The repair is often another visit,
-- booked as a work order, and nothing tied the two together: the work order's
-- invoice could not know there was a paid diagnostic to take off it, and
-- neither job page could point to the other.
--
-- `follow_up_of` is that tie. The credit is worked out across a diagnostic and
-- everything booked from it, so the fee comes off once however the work is
-- split between them.

alter table public.jobs
  add column if not exists follow_up_of uuid references public.jobs (id) on delete set null;

-- Added only when missing, rather than dropped and added again: running this a
-- second time changes nothing, and nothing in it removes anything.
do $guard$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'jobs_follow_up_of_not_self'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_follow_up_of_not_self check (follow_up_of is null or follow_up_of <> id);
  end if;
end;
$guard$;

create index if not exists jobs_follow_up_of_idx
  on public.jobs (follow_up_of)
  where follow_up_of is not null;

/*
 * Only within one business.
 *
 * Invoker rights on purpose: the job being followed up has to be one the
 * person writing can see, which row security already limits to their own
 * business. Another business's job reads as missing and is refused, the same
 * as a job that does not exist.
 */
create or replace function public.jobs_follow_up_same_business()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.follow_up_of is not null and not exists (
    select 1
    from public.jobs as followed
    where followed.id = new.follow_up_of
      and followed.organization_id = new.organization_id
  ) then
    raise exception 'A follow-up belongs to the same business as the job it follows up.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace trigger jobs_follow_up_same_business
  before insert or update of follow_up_of, organization_id on public.jobs
  for each row
  execute function public.jobs_follow_up_same_business();
