-- A customer's address becomes their service address only when it is complete.
--
-- 20261114010000 copied any customer address with a street and a city. The
-- website form saves a street and town on the customer before the booking
-- writes the full service address, so the copy was made first, without a state,
-- and the booking — which matches on street, city, state and ZIP — did not
-- recognise it and added a second. Requiring all four means the copy is only
-- made from an address the booking steps would match.
--
-- The one incomplete copy made before this (a test customer's, used by nothing)
-- is archived, not deleted.

create or replace function private.customer_address_as_service_address()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.properties as property
    where property.customer_id = new.id and property.archived_at is null
  ) then
    return null;
  end if;

  if nullif(trim(coalesce(new.address_line_1, '')), '') is not null
     and nullif(trim(coalesce(new.city, '')), '') is not null
     and nullif(trim(coalesce(new.state, '')), '') is not null
     and nullif(trim(coalesce(new.postal_code, '')), '') is not null then
    insert into public.properties (organization_id, customer_id, address_line_1, address_line_2, city, state, postal_code)
    values (
      new.organization_id, new.id, trim(new.address_line_1), nullif(trim(coalesce(new.address_line_2, '')), ''),
      trim(new.city), trim(new.state), trim(new.postal_code)
    );
  elsif nullif(trim(coalesce(new.business_address_line_1, '')), '') is not null
     and nullif(trim(coalesce(new.business_city, '')), '') is not null
     and nullif(trim(coalesce(new.business_state, '')), '') is not null
     and nullif(trim(coalesce(new.business_postal_code, '')), '') is not null then
    insert into public.properties (organization_id, customer_id, address_line_1, address_line_2, city, state, postal_code)
    values (
      new.organization_id, new.id, trim(new.business_address_line_1), nullif(trim(coalesce(new.business_address_line_2, '')), ''),
      trim(new.business_city), trim(new.business_state), trim(new.business_postal_code)
    );
  end if;

  return null;
end;
$$;

drop trigger if exists customers_address_as_service_address on public.customers;
create trigger customers_address_as_service_address
  after insert or update of address_line_1, city, state, postal_code,
    business_address_line_1, business_city, business_state, business_postal_code
  on public.customers
  for each row execute function private.customer_address_as_service_address();

update public.properties as property
  set archived_at = now()
  where property.archived_at is null
    and (nullif(trim(property.state), '') is null or nullif(trim(property.postal_code), '') is null)
    and property.created_at >= '2026-11-14 04:35:00+00'
    and property.created_at < '2026-11-14 04:36:00+00'
    and not exists (select 1 from public.jobs as job where job.property_id = property.id)
    and not exists (select 1 from public.booking_requests as request where request.property_id = property.id);
