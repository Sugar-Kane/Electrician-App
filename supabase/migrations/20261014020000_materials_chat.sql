-- A materials list written by chatting, on the business's own ChatGPT key.
--
--   * organization_ai_keys: the business's OpenAI API key, encrypted by the app
--     before it is stored. Nobody reads this table but the server: no policy
--     lets a signed-in user see it, so the key (even encrypted) never reaches a
--     browser. The owner sees only the last four characters and the model.
--   * job_material_lists: one list per job, as the chat last wrote it and as
--     it has been edited since, with the chat that produced it.
--
-- Adds only.

create table if not exists public.organization_ai_keys (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  provider text not null default 'openai' check (provider = 'openai'),
  encrypted_key text not null,
  key_hint text not null check (char_length(key_hint) <= 12),
  model text not null check (char_length(model) between 1 and 80),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300)
);

alter table public.organization_ai_keys enable row level security;
revoke all on table public.organization_ai_keys from anon, authenticated;

comment on table public.organization_ai_keys is
  'A business''s own AI provider key, encrypted by the app. Read and written only by the server (service role).';

create table if not exists public.job_material_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  content jsonb not null default '{}'::jsonb,
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  source text check (source is null or source in ('openai', 'claude')),
  model text check (model is null or char_length(model) <= 80),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists job_material_lists_job_key on public.job_material_lists (job_id);
create index if not exists job_material_lists_organization_idx on public.job_material_lists (organization_id);

alter table public.job_material_lists enable row level security;

-- Members of the business, on its own jobs only: the job named must belong to
-- the same business as the row, so a list can never be pinned to another
-- business's job.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'job_material_lists'
      and policyname = 'members manage their job material lists'
  ) then
    create policy "members manage their job material lists" on public.job_material_lists for all
      to authenticated
      using ((select private.is_org_member(organization_id)))
      with check (
        (select private.is_org_member(organization_id))
        and exists (
          select 1 from public.jobs j
          where j.id = job_material_lists.job_id
            and j.organization_id = job_material_lists.organization_id
        )
      );
  end if;
end;
$$;

grant select, insert, update, delete on table public.job_material_lists to authenticated;

comment on table public.job_material_lists is
  'A job''s materials list: what the chat wrote, as edited since, and the chat itself.';
