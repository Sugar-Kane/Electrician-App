-- ChatGPT tool calls that reach a customer or move money (send a text, an
-- invoice, an estimate or a contract; bill a job; mark paid; discount; close out;
-- supplier orders; cancel a job) no longer run on the model's own "confirmed"
-- flag. They are recorded as a 'chatgpt_tool' proposal, approved only by an
-- owner, only in Volteira, and then replayed by the executor (compliance
-- SEC-007-008/009, FED-010-003). See src/lib/mcp-approval.ts.

alter table public.task_proposals drop constraint if exists task_proposals_action_type_check;
alter table public.task_proposals add constraint task_proposals_action_type_check check (action_type in (
  'send_text', 'add_job_note',
  'send_customer_message', 'send_customer_email', 'create_internal_task',
  'send_contract', 'send_estimate', 'purchase_materials', 'issue_refund', 'change_price', 'cancel_job',
  'chatgpt_tool'
));

create or replace function private.supervised_action_approver(p_action text, p_template_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- 'owner': only an owner. 'admin': an owner or an admin. null: unknown
  -- action, nobody (fail closed).
  select case
    when p_action in ('send_contract', 'send_estimate', 'purchase_materials', 'issue_refund', 'change_price', 'cancel_job', 'chatgpt_tool') then 'owner'
    -- A customer message written for the occasion (no approved template)
    -- needs the owner; one from an approved template, an owner or admin.
    when p_action in ('send_text', 'send_customer_message', 'send_customer_email') then
      case when p_template_key is null then 'owner' else 'admin' end
    when p_action in ('add_job_note', 'create_internal_task') then 'admin'
    else null
  end;
$$;

-- Approving from ChatGPT: never a ChatGPT request or a customer message. Those
-- are approved by a person in Volteira, not from the conversation that asked
-- for them. Everything else is decided as before.
create or replace function public.decide_supervised_proposal_for(
  p_actor uuid,
  p_via text,
  p_proposal_id uuid,
  p_decision text,
  p_content_hash text,
  p_note text default null
)
returns table (ok boolean, code text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  via text := case when p_via in ('app', 'chatgpt') then p_via else 'app' end;
  kind text;
begin
  if via = 'chatgpt' and p_decision = 'approve' then
    select p.action_type into kind from public.task_proposals p where p.id = p_proposal_id;
    if kind in ('chatgpt_tool', 'send_text', 'send_customer_message', 'send_customer_email') then
      return query select false, 'restricted_channel'::text, null::text;
      return;
    end if;
  end if;
  return query select * from private.decide_supervised_proposal(p_actor, via, p_proposal_id, p_decision, p_content_hash, p_note);
end;
$$;

revoke all on function public.decide_supervised_proposal_for(uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.decide_supervised_proposal_for(uuid, text, uuid, text, text, text) to service_role;
