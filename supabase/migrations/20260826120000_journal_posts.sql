-- Work journals: a finished job, written up as something a stranger can learn
-- from.
--
-- The point is search traffic, and the search traffic is not "Pacific Plains
-- Electric". It is "why does my breaker keep tripping" — a question a homeowner
-- types at nine at night, answered properly, by the business that would come
-- and fix it. So a post is an explanation first and a record of a job second.
--
-- Posts publish themselves. There is no reviewer between the model and the
-- public web, which is why the shape of this table is what it is:
--
--   * `job_id` is unique. One job is one post. A second write for the same job
--     is a bug, and the constraint says so at the moment it happens rather than
--     leaving two versions of one visit on the site.
--   * `kind` records whether anybody actually wrote down what was done.
--     'lesson' means nobody did, and the post therefore claims no outcome. It
--     is stored rather than inferred so a later edit cannot quietly turn an
--     explanation into an account of work performed.
--   * `status` starts 'published', because that is what was asked for. 'hidden'
--     is the owner taking one down; 'declined' is the generator refusing, with
--     the reason kept so somebody can see why a job produced nothing.
--
-- Nothing identifying is stored here. The customer, the address and the job
-- number stay on the job; this table holds the town, which is public
-- information about where the business works.

-- ---------------------------------------------------------------------------
-- The posts.
-- ---------------------------------------------------------------------------

create table if not exists public.journal_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- One post per job, enforced rather than hoped for. `cascade`: a deleted job
  -- takes its write-up with it, because the post is about that visit and
  -- nothing else.
  job_id uuid not null unique references public.jobs (id) on delete cascade,

  -- The URL. Unique per business, not globally: two electricians may both have
  -- a post called why-does-my-breaker-trip and neither should have to care.
  slug text not null,

  -- The question a homeowner would type, which is the title and the whole SEO.
  title text not null,
  -- One line under the title, and the meta description.
  dek text not null default '',
  body text not null default '',
  -- The part for somebody who is not an electrician, held separately so the
  -- page can give it its own treatment rather than burying it in paragraph six.
  lesson text not null default '',

  -- Which drawing from the catalogue, and its labels. Empty means no diagram,
  -- which is a real answer: a picture bolted onto prose it does not illustrate
  -- is worse than no picture.
  diagram text not null default '',
  diagram_labels jsonb not null default '[]'::jsonb,
  diagram_caption text not null default '',

  town text not null default '',
  state text not null default '',
  category text not null default '',

  kind text not null default 'lesson' check (kind in ('story', 'lesson')),
  status text not null default 'published' check (status in ('published', 'hidden', 'declined')),
  -- Why the generator refused. Only ever set with status 'declined'.
  decline_reason text not null default '',

  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint journal_posts_slug_per_org unique (organization_id, slug),
  -- A published post with no title or body is a blank page on a business's own
  -- domain. Better to fail the write.
  constraint journal_posts_published_has_content check (
    status <> 'published' or (length(title) > 0 and length(body) > 0)
  )
);

comment on table public.journal_posts is
  'A completed job written up as a public, informational post. One per job. Nothing identifying: the town is stored, the customer and address are not.';

-- The public list: newest published first, per business.
create index if not exists journal_posts_public_idx
  on public.journal_posts (organization_id, published_at desc)
  where status = 'published';

-- The owner's list shows everything, including declines.
create index if not exists journal_posts_org_idx
  on public.journal_posts (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Earlier versions, so an AI edit is reversible.
--
-- The owner can ask the assistant to change a post. That is a model rewriting
-- text that is already public, so the version it replaced is kept — the same
-- posture as document versions, and for the same reason: an edit somebody
-- cannot undo is an edit they hesitate to make.
-- ---------------------------------------------------------------------------

create table if not exists public.journal_post_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  post_id uuid not null references public.journal_posts (id) on delete cascade,

  title text not null default '',
  dek text not null default '',
  body text not null default '',
  lesson text not null default '',

  -- What the owner asked for, so the history reads as a conversation rather
  -- than a stack of anonymous diffs.
  instruction text not null default '',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists journal_post_revisions_post_idx
  on public.journal_post_revisions (post_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Who may touch them.
-- ---------------------------------------------------------------------------

alter table public.journal_posts enable row level security;
alter table public.journal_post_revisions enable row level security;

drop policy if exists "Organization members can view journal posts" on public.journal_posts;
create policy "Organization members can view journal posts"
  on public.journal_posts for select to authenticated
  using ((select private.is_org_member(organization_id)));

drop policy if exists "Organization members can write journal posts" on public.journal_posts;
create policy "Organization members can write journal posts"
  on public.journal_posts for insert to authenticated
  with check ((select private.is_org_member(organization_id)));

drop policy if exists "Organization members can edit journal posts" on public.journal_posts;
create policy "Organization members can edit journal posts"
  on public.journal_posts for update to authenticated
  using ((select private.is_org_member(organization_id)))
  with check ((select private.is_org_member(organization_id)));

drop policy if exists "Organization members can view journal revisions" on public.journal_post_revisions;
create policy "Organization members can view journal revisions"
  on public.journal_post_revisions for select to authenticated
  using ((select private.is_org_member(organization_id)));

drop policy if exists "Organization members can write journal revisions" on public.journal_post_revisions;
create policy "Organization members can write journal revisions"
  on public.journal_post_revisions for insert to authenticated
  with check ((select private.is_org_member(organization_id)));

-- ---------------------------------------------------------------------------
-- What the public may read.
--
-- Through functions rather than a policy on the table, following the booking
-- page. An anonymous reader gets exactly the columns a post is made of and
-- nothing beside them — no job id, no organization id, no status, nothing that
-- would let somebody enumerate what a business has taken down.
-- ---------------------------------------------------------------------------

create or replace function public.list_public_journal_posts(
  p_slug text,
  p_limit integer default 50
)
returns table (
  slug text,
  title text,
  dek text,
  town text,
  state text,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.slug, p.title, p.dek, p.town, p.state, p.published_at
  from public.journal_posts p
  join public.organizations o on o.id = p.organization_id
  where o.slug = p_slug
    and o.archived_at is null
    and p.status = 'published'
  order by p.published_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

create or replace function public.get_public_journal_post(
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
  base_state text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.slug, p.title, p.dek, p.body, p.lesson,
         p.diagram, p.diagram_labels, p.diagram_caption,
         p.town, p.state, p.kind, p.published_at, p.updated_at,
         o.name, o.slug, o.base_city, o.base_state
  from public.journal_posts p
  join public.organizations o on o.id = p.organization_id
  where o.slug = p_slug
    and o.archived_at is null
    and p.slug = p_post_slug
    and p.status = 'published';
$$;

grant execute on function public.list_public_journal_posts(text, integer) to anon, authenticated;
grant execute on function public.get_public_journal_post(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Two lookups the public pages need and nothing else does.
-- ---------------------------------------------------------------------------

-- The hostname a business has verified, for an anonymous page to build a
-- canonical from.
--
-- Only a verified row counts. An unverified one is a name somebody typed into a
-- settings box, and pointing a canonical at a hostname that does not resolve
-- takes the post out of the index altogether, which is worse than serving it on
-- ours.
create or replace function public.get_verified_host_for_slug(p_slug text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.hostname
  from public.organization_domains d
  join public.organizations o on o.id = d.organization_id
  where o.slug = p_slug
    and o.archived_at is null
    and d.verified_at is not null
  order by d.verified_at asc
  limit 1;
$$;

-- Every business with something published, for the app's own sitemap.
--
-- Returns the slug and the newest publish time so the index entry can carry a
-- lastmod without a second query per business.
create or replace function public.list_journal_organizations()
returns table (slug text, hostname text, post_count bigint, newest timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select o.slug,
         coalesce(
           (select d.hostname
              from public.organization_domains d
             where d.organization_id = o.id
               and d.verified_at is not null
             order by d.verified_at asc
             limit 1),
           ''
         ) as hostname,
         count(p.id) as post_count,
         max(p.published_at) as newest
  from public.organizations o
  join public.journal_posts p
    on p.organization_id = o.id and p.status = 'published'
  where o.archived_at is null
  group by o.id, o.slug
  order by o.slug;
$$;

grant execute on function public.get_verified_host_for_slug(text) to anon, authenticated;
grant execute on function public.list_journal_organizations() to anon, authenticated;

-- Undo consumes the revision it restores, so the delete has to be allowed.
--
-- Without this policy RLS silently matches no row: the first undo appears to
-- work because the post is restored, and every undo after it selects the same
-- revision again and can never reach an older one.
drop policy if exists "Organization members can consume journal revisions" on public.journal_post_revisions;
create policy "Organization members can consume journal revisions"
  on public.journal_post_revisions for delete to authenticated
  using ((select private.is_org_member(organization_id)));
