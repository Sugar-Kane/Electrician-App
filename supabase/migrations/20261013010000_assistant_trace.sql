-- The phone assistant's calls, as calls.
--
-- Every protocol message the voice agent sent was logged as its own row, so a
-- single phone call was a dozen lines of initialize, tools/list and tool calls,
-- interleaved with any other call happening at the same time, and nothing tied
-- "Booked: Tuesday 9-11" to the booking it claimed to have saved.
--
-- Each row now carries:
--   session_key        a hash of the signed URL the call used, never the URL
--                      itself; one per phone call, so rows group by call;
--   booking_request_id the booking a tool call saved, when it saved one;
--   job_id             the job that booking became, when it became one.
--
-- Rows from before this have none of them; the console says so rather than
-- guessing which call they belonged to.

alter table public.mcp_call_log
  add column if not exists session_key text,
  add column if not exists booking_request_id uuid references public.booking_requests(id) on delete set null,
  add column if not exists job_id uuid references public.jobs(id) on delete set null;

create index if not exists mcp_call_log_org_session_idx
  on public.mcp_call_log(organization_id, session_key, created_at)
  where session_key is not null;
create index if not exists mcp_call_log_booking_idx
  on public.mcp_call_log(booking_request_id)
  where booking_request_id is not null;

/**
 * The assistant's recent calls for one business, with what each tool call
 * saved and whether the people involved were told.
 */
create or replace function public.admin_assistant_calls(p_organization_id uuid, p_limit integer default 200)
returns table (
  id uuid,
  created_at timestamptz,
  method text,
  tool_name text,
  arguments jsonb,
  result_text text,
  is_error boolean,
  http_status integer,
  duration_ms integer,
  session_key text,
  booking_request_id uuid,
  job_id uuid,
  booking_status text,
  booking_archived boolean,
  booking_notifications jsonb,
  booking_confirmed_notified_at timestamptz,
  job_number integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    log.id,
    log.created_at,
    log.method,
    log.tool_name,
    log.arguments,
    left(coalesce(log.result_text, ''), 2000),
    log.is_error,
    log.http_status,
    log.duration_ms,
    log.session_key,
    log.booking_request_id,
    coalesce(log.job_id, request.created_job_id),
    request.status,
    request.archived_at is not null,
    coalesce(request.notification_results, '[]'::jsonb),
    request.confirmed_notified_at,
    job.job_number
  from public.mcp_call_log as log
  left join public.booking_requests as request on request.id = log.booking_request_id
  left join public.jobs as job on job.id = coalesce(log.job_id, request.created_job_id)
  where log.organization_id = p_organization_id
    and (select private.is_platform_admin())
  order by log.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

revoke all on function public.admin_assistant_calls(uuid, integer) from public, anon;
grant execute on function public.admin_assistant_calls(uuid, integer) to authenticated;
