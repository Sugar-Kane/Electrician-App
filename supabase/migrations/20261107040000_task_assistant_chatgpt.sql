-- Assistant work done by the business's own ChatGPT (or Claude) through the
-- Volteira connection, on their own plan, instead of Volteira's built-in AI.
--
-- An "external" connection has no key: the work waits until somebody asks
-- their connected ChatGPT to do it, and ChatGPT reads the task, does it and
-- reports back through the connection's tools. Nothing runs in the background
-- for it. The built-in assistant is switched off; the row stays so it can be
-- switched back on.

alter table public.assistant_connections drop constraint if exists assistant_connections_provider_check;
alter table public.assistant_connections
  add constraint assistant_connections_provider_check check (provider in ('anthropic', 'chatgpt'));
alter table public.assistant_connections drop constraint if exists assistant_connections_kind_check;
alter table public.assistant_connections
  add constraint assistant_connections_kind_check check (kind in ('built_in', 'external'));

create unique index if not exists assistant_connections_one_external_idx
  on public.assistant_connections (organization_id) where kind = 'external';

insert into public.assistant_connections (organization_id, display_name, provider, kind, credential_ref)
select o.id, 'Your ChatGPT', 'chatgpt', 'external', null
  from public.organizations o
on conflict do nothing;

update public.assistant_connections set status = 'disabled', updated_at = now()
 where kind = 'built_in' and status = 'active';

create or replace function private.add_built_in_assistant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.assistant_connections (organization_id, display_name, provider, kind, credential_ref)
  values (new.id, 'Your ChatGPT', 'chatgpt', 'external', null)
  on conflict do nothing;
  insert into public.assistant_connections (organization_id, display_name, provider, kind, status, credential_ref)
  values (new.id, 'Volteira assistant (Claude)', 'anthropic', 'built_in', 'disabled', 'env:ANTHROPIC_API_KEY')
  on conflict do nothing;
  return new;
end;
$$;

-- Who in the business picked the work up in their ChatGPT, so only they report back on it.
alter table public.task_executions add column if not exists claimed_by uuid references auth.users(id) on delete set null;
