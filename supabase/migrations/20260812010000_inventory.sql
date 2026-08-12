-- Give the existing inventory table the fields an electrician actually needs.
--
-- `inventory_items` has existed since the foundation migration with sku, name,
-- category, unit, quantity_on_hand, reorder_point and unit_cost_cents. Nothing
-- in the app has ever read or written it, so every business looked like it
-- owned nothing and a job's material list showed the whole list as something to
-- buy — sending somebody to Lowe's for a breaker they have four of on the van.
--
-- The columns below are the ones missing for that to be usable in the field.
-- All optional: an electrician adding stock on a phone between jobs types a
-- name and a number, and a form that demands a part number is a form that does
-- not get used. An inventory nobody maintains is worse than none, because the
-- materials list then lies about what is on the van.

alter table public.inventory_items
  add column if not exists supplier text,
  -- Where it actually is: "van shelf 2", "shop bin C". The question asked most
  -- often about stock is not how much, it is where.
  add column if not exists location text,
  add column if not exists notes text,
  add column if not exists photo_url text,
  add column if not exists created_by uuid references auth.users (id);

comment on column public.inventory_items.location is
  'Where the part physically is. Free text — a van shelf is not an entity worth modelling.';

-- Matching a required material against stock is a name search, so it wants an
-- index that supports one rather than a scan per line of a materials list.
create index if not exists inventory_items_name_idx
  on public.inventory_items (organization_id, lower(name));

create index if not exists inventory_items_org_active_idx
  on public.inventory_items (organization_id, archived_at, name);

-- RLS, the trigger and the org-member policies already exist on this table from
-- the foundation migration and are correct: private.is_org_member scoping, one
-- policy per command. Deliberately not redefined here.
