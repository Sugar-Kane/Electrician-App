-- The receipt behind a purchase.
--
-- `inventory_movements` records that four breakers arrived at $42 each. What it
-- could not record is the piece of paper that says so, which is the half an
-- accountant asks for: a material spend of eleven thousand dollars is a number
-- until each purchase in it can be shown.
--
-- One nullable column rather than a join table. A movement has at most one
-- receipt behind it, and the receipt is already a `documents` row — filed,
-- scoped to the organization, and covered by the storage policies that guard
-- every other document. Nothing here needs its own copy of any of that.
--
-- `on delete set null` deliberately: deleting the scan must not delete the
-- record of stock arriving. The count on the shelf does not become wrong
-- because somebody tidied up a photo.

alter table public.inventory_movements
  add column if not exists receipt_document_id uuid
    references public.documents (id) on delete set null;

comment on column public.inventory_movements.receipt_document_id is
  'The scanned supplier receipt this movement was read from, when it came from one.';

-- Only for the rows that have one. Most movements — a job using a part, a
-- recount — never will, and a full index on a mostly-null column is pages of
-- nothing.
create index if not exists inventory_movements_receipt_idx
  on public.inventory_movements (receipt_document_id)
  where receipt_document_id is not null;
