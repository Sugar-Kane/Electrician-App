-- What a part cost the business, and what a box, roll or stick holds.
--
-- A part line had one price, "Each", and nothing said whose price it was.
-- Picking a part from stock filled it with what the part cost, so a breaker
-- bought at $9 went on the customer's bill at $9. The customer's price stays
-- in unit_price_cents; what it cost the business goes here, beside it.
--
-- Null, not zero, when nobody recorded it: a part that cost nothing and a part
-- whose cost is unknown are different answers, and a job's margin is only as
-- true as the costs behind it. Existing lines are left unknown rather than
-- guessed.
--
-- pack_size and pack_unit say what one box, roll or stick holds — ten sticks
-- of conduit at ten feet each is a hundred feet — so the conversion is written
-- down on the line and can be checked, and a stick of conduit takes ten feet
-- from conduit counted in feet.

alter table public.job_line_items
  add column if not exists unit_cost_cents integer
    check (unit_cost_cents is null or unit_cost_cents >= 0),
  add column if not exists pack_size numeric(12, 2)
    check (pack_size is null or pack_size > 0),
  add column if not exists pack_unit text
    check (pack_unit is null or pack_unit in ('ft', 'each'));

comment on column public.job_line_items.unit_cost_cents is
  'What one cost the business, in cents. Null when not recorded. Never shown to the customer.';
comment on column public.job_line_items.pack_size is
  'How much one box, roll or stick on this line holds, in pack_unit.';
comment on column public.job_line_items.pack_unit is
  'What pack_size is counted in: ft or each.';
