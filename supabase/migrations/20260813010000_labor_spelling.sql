-- One spelling of the word, and it is the one on the invoice.
--
-- `job_line_items.kind` has been 'labour' since the table was created, and the
-- buttons above it said "Add labour". This app is used by electricians in
-- California, who bill labor, read "labor" on every permit and code section
-- they deal with, and do not write it with a u.
--
-- Renaming the stored value as well as the label, rather than translating at
-- the edge. A column that says one thing while the screen above it says another
-- is how the next person to read this ends up writing a mapping function, and
-- then a second one somewhere else that disagrees with the first.
--
-- Safe on a live table: the constraint comes off, the rows move, the constraint
-- goes back on tighter than it was. Nothing writes 'labour' after this deploys,
-- and nothing can.

alter table public.job_line_items
  drop constraint if exists job_line_items_kind_check;

update public.job_line_items
  set kind = 'labor'
  where kind = 'labour';

alter table public.job_line_items
  add constraint job_line_items_kind_check
  check (kind in ('labor', 'material'));

comment on column public.job_line_items.kind is
  'labor or material. One list, because they are one bill; the split is only shown in the totals.';
