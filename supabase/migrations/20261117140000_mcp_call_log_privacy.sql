-- The MCP call log keeps less, for less time, for fewer people.
--
-- Audit finding MT-06 (MEDIUM). Every ChatGPT/Claude and voice-booking tool
-- call was logged with its arguments whole and up to 4,000 characters of what
-- the tool said back: customers' names, numbers, addresses, the words of their
-- texts, and signing, invoice and booking links that work on their own. Every
-- member of the business could read it, technicians included, and nothing was
-- ever deleted.
--
-- The app now redacts before writing (src/lib/mcp-log-redaction.ts). This:
-- 1. shows the log only to owners and admins (the Operations page reads tool
--    names through the server and is unaffected);
-- 2. deletes rows older than 90 days, daily, and once now;
-- 3. strips what earlier rows kept: arguments are reduced to their ids,
--    numbers and states, and results to nothing, so no customer detail or
--    working link written before this change remains.

drop policy if exists "Organization members can view their MCP calls" on public.mcp_call_log;
drop policy if exists "Owners and admins can view their MCP calls" on public.mcp_call_log;
create policy "Owners and admins can view their MCP calls"
  on public.mcp_call_log for select
  to authenticated
  using ((select private.is_org_admin(organization_id)));

/*
 * The arguments a row may keep: ids, numbers, booleans and short enumerated
 * states, by key. Everything else (names, phones, addresses, messages,
 * descriptions, links) is dropped. The same idea as redactLogArguments in the
 * app, conservative enough to run over old rows without reading them.
 */
create or replace function private.mcp_log_kept_arguments(arguments jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.jsonb_object_agg(entry.key, entry.value)
      filter (
        where entry.key ~* '(^|_)(id|ids|number|status|kind|type|scope|method|count|cents|amount|quantity|hours|confirmed|channel|send|action)$'
          and pg_catalog.jsonb_typeof(entry.value) in ('number', 'boolean', 'string', 'null')
          and (pg_catalog.jsonb_typeof(entry.value) <> 'string' or pg_catalog.length(entry.value #>> '{}') <= 64)
          and (entry.value #>> '{}') !~* '(https?://|@|\d{3}[\s.-]?\d{3}[\s.-]?\d{4})'
      ),
    '{}'::jsonb
  )
  from pg_catalog.jsonb_each(case when pg_catalog.jsonb_typeof(arguments) = 'object' then arguments else '{}'::jsonb end) as entry;
$function$;

revoke all on function private.mcp_log_kept_arguments(jsonb) from public, anon, authenticated;

delete from public.mcp_call_log where created_at < pg_catalog.now() - interval '90 days';

update public.mcp_call_log
set arguments = private.mcp_log_kept_arguments(arguments),
    result_text = null;

-- Daily, at 03:17 UTC.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'volteira-mcp-call-log-retention') then
    perform cron.unschedule('volteira-mcp-call-log-retention');
  end if;
  perform cron.schedule(
    'volteira-mcp-call-log-retention',
    '17 3 * * *',
    $cron$ delete from public.mcp_call_log where created_at < now() - interval '90 days' $cron$
  );
end;
$$;
