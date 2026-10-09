-- A business with one person working has one answer to "who is going?".
--
-- Every new job arrived with nobody on it, however it came in: the New job
-- form, a text or call scheduled from Needs attention or booked by the phone
-- assistant, a paid online booking. The job page, the dashboard and the
-- schedule then said "Unassigned" until somebody picked the only name in the
-- list, which for an electrician working alone was themselves, every time.
--
-- So when exactly one technician is switched on as working, a job created
-- without anybody on it gets that person. With nobody working, or two or more,
-- nothing is chosen: who goes is the business's decision. A job saved with a
-- technician keeps the one it was given, and this runs only when a job is
-- created, so taking somebody off a job later is still honoured.
--
-- Invoker rights, like jobs_follow_up_same_business: whoever is writing the
-- job can already see its business's technicians, and the booking functions
-- that create jobs run as their owner.

create or replace function public.jobs_assign_sole_technician()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  working uuid[];
begin
  if new.technician_id is null then
    select array_agg(technician.id)
      into working
      from public.technicians as technician
     where technician.organization_id = new.organization_id
       and technician.is_active;

    if cardinality(working) = 1 then
      new.technician_id := working[1];
    end if;
  end if;

  return new;
end;
$$;

create or replace trigger jobs_assign_sole_technician
  before insert on public.jobs
  for each row
  execute function public.jobs_assign_sole_technician();
