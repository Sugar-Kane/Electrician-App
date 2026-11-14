-- A job with no service address takes its customer's, once there is one.
--
-- 20261114010000 and 20261114060000 copy a customer's own address into a
-- service address (properties), but only onto the customer: jobs made before
-- that (Junell Peterson's #19, Carlos Cardenas's #30) kept property_id null,
-- so the job list and the job page still showed no address even though the
-- customer now had one.
--
-- Now, when a customer's only service address is added, every job of theirs
-- without one is given it. With two or more addresses there is no telling
-- which a job was for, so nothing is guessed. The two jobs above are given
-- theirs here.

create or replace function private.attach_service_address_to_jobs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is not null or new.customer_id is null then
    return null;
  end if;

  if (
    select count(*) from public.properties as property
    where property.customer_id = new.customer_id
      and property.archived_at is null
  ) <> 1 then
    return null;
  end if;

  update public.jobs as job
  set property_id = new.id
  where job.customer_id = new.customer_id
    and job.organization_id = new.organization_id
    and job.property_id is null;

  return null;
end;
$$;

revoke all on function private.attach_service_address_to_jobs() from public, anon, authenticated;

drop trigger if exists properties_attach_to_jobs on public.properties;
create trigger properties_attach_to_jobs
  after insert on public.properties
  for each row execute function private.attach_service_address_to_jobs();

-- The jobs already waiting: their customer's one service address.
update public.jobs as job
set property_id = property.id
from public.properties as property
where job.property_id is null
  and property.customer_id = job.customer_id
  and property.organization_id = job.organization_id
  and property.archived_at is null
  and (
    select count(*) from public.properties as other
    where other.customer_id = job.customer_id
      and other.archived_at is null
  ) = 1;
