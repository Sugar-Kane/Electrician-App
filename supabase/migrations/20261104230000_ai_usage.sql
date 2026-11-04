-- Each time a business uses Volteira's own built-in AI.
--
-- Volteira pays for the built-in AI (the job's Materials chat, drafting an
-- estimate or a contract's scope, the in-app assistant, reading a receipt,
-- writing a journal post), so each business gets a monthly allowance of it.
-- One row per use is what that allowance is counted from. Reading customers'
-- texts, website requests and calls is not counted: customers start those,
-- and they are never refused.
--
-- Written only by the server; members can see their own business's rows.

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  feature text not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_org_created_idx
  on public.ai_usage (organization_id, created_at desc);

alter table public.ai_usage enable row level security;

revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_usage'
      and policyname = 'Organization members can view AI usage'
  ) then
    create policy "Organization members can view AI usage"
      on public.ai_usage for select to authenticated
      using ((select private.is_org_member(organization_id)));
  end if;
end
$$;

comment on table public.ai_usage is
  'One row each time a business uses Volteira''s built-in AI, counted against its monthly allowance. Customer-started AI (texts, website requests, calls) is not recorded here.';
