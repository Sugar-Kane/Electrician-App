-- What the business adds on top of what a part costs at the store.
--
-- The materials chat now looks up each item's price at Home Depot and Lowe's.
-- That price is what the part costs the business (job_line_items.unit_cost_cents);
-- the customer's price is that plus this markup, filled in on the pricing
-- sheet and changeable there before anything is added to an estimate.
--
-- Twenty percent unless the business sets its own, from 0 to 500, to a tenth.
-- Adds only: nothing reads it until the code that uses it is deployed.

alter table public.organizations
  add column if not exists materials_markup_percent numeric(4, 1) not null default 20
    check (materials_markup_percent >= 0 and materials_markup_percent <= 500);

comment on column public.organizations.materials_markup_percent is
  'Percent added to a part''s store price to make the customer''s price. 0 to 500.';
