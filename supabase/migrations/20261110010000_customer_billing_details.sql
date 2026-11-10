-- Customer details the business can change at any time: a personal (mailing)
-- address, a business address, and who invoices and contracts are made out
-- to, the person or the business.
--
-- The service address stays on properties (where the work is). These are
-- where the bill goes. Either address may be empty; the app asks for at least
-- one when the details are saved, and documents fall back to the service
-- address when neither is set.

alter table public.customers
  add column if not exists address_line_1 text check (address_line_1 is null or char_length(address_line_1) <= 200),
  add column if not exists address_line_2 text check (address_line_2 is null or char_length(address_line_2) <= 100),
  add column if not exists city text check (city is null or char_length(city) <= 100),
  add column if not exists state text check (state is null or char_length(state) <= 50),
  add column if not exists postal_code text check (postal_code is null or char_length(postal_code) <= 20),
  add column if not exists business_address_line_1 text check (business_address_line_1 is null or char_length(business_address_line_1) <= 200),
  add column if not exists business_address_line_2 text check (business_address_line_2 is null or char_length(business_address_line_2) <= 100),
  add column if not exists business_city text check (business_city is null or char_length(business_city) <= 100),
  add column if not exists business_state text check (business_state is null or char_length(business_state) <= 50),
  add column if not exists business_postal_code text check (business_postal_code is null or char_length(business_postal_code) <= 20),
  add column if not exists bill_to text not null default 'person';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_bill_to_check') then
    alter table public.customers
      add constraint customers_bill_to_check check (bill_to in ('person', 'business'));
  end if;
  -- Made out to the business only when there is a business name to put on it.
  if not exists (select 1 from pg_constraint where conname = 'customers_bill_to_business_named') then
    alter table public.customers
      add constraint customers_bill_to_business_named
      check (bill_to <> 'business' or nullif(btrim(company_name), '') is not null);
  end if;
end;
$$;

-- Documents already put a company name first. Keep that for existing customers
-- who have one, so nothing they were sent changes name.
update public.customers
   set bill_to = 'business'
 where bill_to = 'person'
   and nullif(btrim(company_name), '') is not null;

comment on column public.customers.bill_to is
  'Who invoices and contracts are made out to: person (their name and personal address) or business (the business name and business address).';
