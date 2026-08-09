-- What a voice model actually did with the booking tools.
--
-- The tools themselves are deliberately quiet: `list_open_slots` writes nothing,
-- and a refusal writes nothing either. That is correct behaviour and it is also
-- why a call that goes wrong leaves no trace — the first live call ended with
-- empty tables and no way to tell whether the model never called a tool, called
-- one that refused, or never reached the server at all.
--
-- This is the missing half. One row per MCP request, written before anything
-- else can fail, so the question "what happened on that call?" is answerable
-- from the database rather than from a log console somebody has to be logged
-- into.
--
-- It records what the model sent and what it was told back. That includes an
-- address and a phone number a customer said out loud, which is the same data
-- the customers and booking-request tables already hold — so it carries the
-- same protection, and no more of it than those do.

create table if not exists public.mcp_call_log (
  id uuid primary key default gen_random_uuid(),
  -- Null when the request never proved which business it was for: an expired or
  -- forged token is exactly the thing worth being able to see.
  organization_id uuid references public.organizations(id) on delete cascade,
  -- initialize, tools/list, tools/call, or whatever else arrived.
  method text not null,
  tool_name text,
  arguments jsonb not null default '{}'::jsonb,
  -- What the model was told. The first line of a refusal says why.
  result_text text,
  is_error boolean not null default false,
  http_status integer,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists mcp_call_log_org_created_idx
  on public.mcp_call_log(organization_id, created_at desc);
create index if not exists mcp_call_log_created_idx on public.mcp_call_log(created_at desc);

alter table public.mcp_call_log enable row level security;

drop policy if exists "Organization members can view their MCP calls" on public.mcp_call_log;
create policy "Organization members can view their MCP calls"
on public.mcp_call_log for select
to authenticated
using ((select private.is_org_member(organization_id)));

-- Written only by the MCP endpoint through the service role. A customer's
-- address said out loud is not anon-readable.
revoke all on table public.mcp_call_log from public, anon;
grant select on table public.mcp_call_log to authenticated;
