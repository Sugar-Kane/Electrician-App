-- The public post lookup gains the business's phone and postal code.
--
-- Both feed the structured data on a published post. An `Electrician` is a
-- `LocalBusiness`, and a LocalBusiness with no telephone and no postal code is
-- a name rather than an entity a search engine can attach to a place, which is
-- the whole point of publishing these pages.
--
-- Read through the RPC like everything else the anonymous pages need, so the
-- tables themselves stay unreadable to `anon`.
--
-- Dropped and recreated rather than replaced: `create or replace function`
-- cannot change a `returns table` signature. Both statements run in one
-- transaction, so there is no window where the function is missing.

drop function if exists public.get_public_journal_post(text, text);

create function public.get_public_journal_post(
  p_slug text,
  p_post_slug text
)
returns table (
  slug text,
  title text,
  dek text,
  body text,
  lesson text,
  diagram text,
  diagram_labels jsonb,
  diagram_caption text,
  town text,
  state text,
  kind text,
  published_at timestamptz,
  updated_at timestamptz,
  business_name text,
  business_slug text,
  base_city text,
  base_state text,
  business_phone text,
  base_postal_code text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.slug, p.title, p.dek, p.body, p.lesson,
         p.diagram, p.diagram_labels, p.diagram_caption,
         p.town, p.state, p.kind, p.published_at, p.updated_at,
         o.name, o.slug, o.base_city, o.base_state,
         o.phone, o.base_postal_code
  from public.journal_posts p
  join public.organizations o on o.id = p.organization_id
  where o.slug = p_slug
    and o.archived_at is null
    and p.slug = p_post_slug
    and p.status = 'published';
$$;

grant execute on function public.get_public_journal_post(text, text) to anon, authenticated;
