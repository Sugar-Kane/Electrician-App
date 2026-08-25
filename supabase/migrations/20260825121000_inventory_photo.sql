-- A photo of the part, rather than a link to one.
--
-- `photo_url` was a free-text box asking an electrician standing at a van for a
-- URL. Nobody has a URL for a breaker. They have the thing in their hand and a
-- camera in the other, which is the same shape as job photos and assistant
-- attachments: the browser uploads straight to storage and the server writes
-- the row that points at it.
--
-- A new column rather than reusing the old one, because a path is not a URL and
-- a column called `photo_url` holding `<org>/inventory/<uuid>.jpg` would be a
-- lie that outlives whoever wrote it. `photo_url` stays for a picture that
-- genuinely lives somewhere on the web — a manufacturer's page, say.

alter table public.inventory_items
  add column if not exists photo_path text;

comment on column public.inventory_items.photo_path is
  'Object path in the documents bucket, first segment the organization id. Read through a signed URL; never public.';

comment on column public.inventory_items.photo_url is
  'A picture that lives elsewhere on the web. Uploads use photo_path.';
