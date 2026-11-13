-- When a job's parts were bought.
--
-- The job's Materials step is listed (and priced, which happen together),
-- then bought, then picked up. Picked up is materials_ready_at; this is the
-- middle one, set and cleared by hand from the job page.
--
-- Additive: one nullable column.

alter table public.jobs add column if not exists materials_bought_at timestamptz;
