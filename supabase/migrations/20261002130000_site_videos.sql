-- The walkthrough videos on the front page, in the order they play.
--
-- Anybody can read them, signed in or not, because the front page is the page
-- every visitor sees first. Only platform admins can change them, from the
-- support console, so adding a video does not need a code change.
--
-- A row holds where the files are, not the files. They are uploaded to Vercel
-- Blob: this database's storage has a 50 MB limit per file on its plan, and
-- every play would come out of the bandwidth the whole app shares.

create table if not exists public.site_videos (
  id uuid primary key default gen_random_uuid(),
  video_url text not null,
  -- A frame taken from the video when it was uploaded, shown before it plays.
  -- None when the uploading browser could not take one.
  poster_url text,
  content_type text not null default 'video/mp4',
  size_bytes bigint,
  -- The recording's own shape, so a phone recording is shown upright.
  width integer,
  height integer,
  duration_seconds numeric(9, 2),
  title text not null,
  description text not null default '',
  position integer not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_videos_video_url_check check (video_url ~ '^https?://'),
  constraint site_videos_poster_url_check check (poster_url is null or poster_url ~ '^https?://'),
  -- The same video on the front page twice is always a mistake.
  constraint site_videos_video_url_key unique (video_url),
  constraint site_videos_content_type_check check (content_type in ('video/mp4', 'video/webm', 'video/quicktime')),
  constraint site_videos_shape_check check ((width is null and height is null) or (width > 0 and height > 0)),
  constraint site_videos_title_check check (char_length(btrim(title)) between 1 and 80),
  constraint site_videos_description_check check (char_length(description) <= 280)
);

create index if not exists site_videos_position_idx on public.site_videos (position, created_at);

alter table public.site_videos enable row level security;

-- Policies are created only when missing, rather than dropped and remade, so
-- this file can run again against a database that already has them.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'site_videos' and policyname = 'Anyone can see the front page videos'
  ) then
    create policy "Anyone can see the front page videos"
      on public.site_videos for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'site_videos' and policyname = 'Admins can add front page videos'
  ) then
    create policy "Admins can add front page videos"
      on public.site_videos for insert
      to authenticated
      with check ((select private.is_platform_admin()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'site_videos' and policyname = 'Admins can change front page videos'
  ) then
    create policy "Admins can change front page videos"
      on public.site_videos for update
      to authenticated
      using ((select private.is_platform_admin()))
      with check ((select private.is_platform_admin()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'site_videos' and policyname = 'Admins can remove front page videos'
  ) then
    create policy "Admins can remove front page videos"
      on public.site_videos for delete
      to authenticated
      using ((select private.is_platform_admin()));
  end if;
end;
$$;

-- Only what the policies above are written for. Anything else, like truncate,
-- would not be checked by a policy at all.
revoke all on public.site_videos from public, anon, authenticated;
grant select on public.site_videos to anon;
grant select, insert, update, delete on public.site_videos to authenticated;
grant all on public.site_videos to service_role;
