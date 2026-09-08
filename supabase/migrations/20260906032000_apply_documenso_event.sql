-- Serialize Documenso webhook transitions on the contract row. Provider
-- retries can arrive concurrently or out of order; a read in one HTTP request
-- followed by an update in another cannot safely resolve that race.

create or replace function public.apply_documenso_event(
  p_envelope_id text,
  p_external_contract_id uuid,
  p_event text,
  p_event_at timestamptz,
  p_status text,
  p_signed_at timestamptz
)
returns table (
  was_applied boolean,
  was_duplicate boolean,
  outcome text,
  matched_contract_id uuid,
  matched_organization_id uuid,
  matched_job_id uuid,
  matched_job_number text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.contracts%rowtype;
  v_job_number text;
begin
  if nullif(trim(p_envelope_id), '') is null
    or nullif(trim(p_event), '') is null
    or p_event_at is null
    or p_status is null
    or p_status not in ('sent', 'signed', 'void') then
    return query select false, false, 'invalid', null::uuid, null::uuid, null::uuid, null::text;
    return;
  end if;

  select contract.*
    into v_contract
  from public.contracts as contract
  where contract.signature_provider = 'documenso'
    and contract.signature_envelope_id = p_envelope_id
  for update;

  -- An immutable external id closes the brief gap between creating an
  -- envelope and linking its id locally. It may only claim an unlinked row.
  if not found and p_external_contract_id is not null then
    select contract.*
      into v_contract
    from public.contracts as contract
    where contract.id = p_external_contract_id
      and contract.signature_envelope_id is null
      and (contract.signature_provider is null or contract.signature_provider = 'documenso')
    for update;
  end if;

  if not found then
    return query select false, false, 'not-found', null::uuid, null::uuid, null::uuid, null::text;
    return;
  end if;

  select job.job_number::text
    into v_job_number
  from public.jobs as job
  where job.id = v_contract.job_id;

  if v_contract.signature_last_event_at is not null
    and p_event_at < v_contract.signature_last_event_at then
    return query select false, false, 'stale', v_contract.id, v_contract.organization_id,
      v_contract.job_id, v_job_number;
    return;
  end if;

  if v_contract.signature_last_event = p_event
    and v_contract.signature_last_event_at = p_event_at then
    return query select false, true, 'duplicate', v_contract.id, v_contract.organization_id,
      v_contract.job_id, v_job_number;
    return;
  end if;

  if (v_contract.status = 'signed' and p_status <> 'signed')
    or (v_contract.status = 'void' and p_status <> 'signed') then
    return query select false, false, 'terminal-status', v_contract.id, v_contract.organization_id,
      v_contract.job_id, v_job_number;
    return;
  end if;

  update public.contracts as contract
  set signature_provider = 'documenso',
      signature_envelope_id = p_envelope_id,
      signature_last_event = p_event,
      signature_last_event_at = p_event_at,
      status = p_status,
      signature_sent_at = case
        when p_status = 'sent' then coalesce(contract.signature_sent_at, p_event_at)
        else contract.signature_sent_at
      end,
      signed_at = case
        when p_status = 'signed' then coalesce(p_signed_at, contract.signed_at, p_event_at)
        else contract.signed_at
      end,
      signature_rejected_at = case
        when p_status = 'signed' then null
        when p_status = 'void' then p_event_at
        else contract.signature_rejected_at
      end,
      signature_send_token = case
        when p_status in ('signed', 'void') then null
        else contract.signature_send_token
      end,
      signature_send_started_at = case
        when p_status in ('signed', 'void') then null
        else contract.signature_send_started_at
      end
  where contract.id = v_contract.id
    and contract.organization_id = v_contract.organization_id;

  return query select true, false, 'applied', v_contract.id, v_contract.organization_id,
    v_contract.job_id, v_job_number;
end;
$$;

revoke all on function public.apply_documenso_event(text, uuid, text, timestamptz, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_documenso_event(text, uuid, text, timestamptz, text, timestamptz)
  to service_role;

comment on function public.apply_documenso_event(text, uuid, text, timestamptz, text, timestamptz) is
  'Applies one Documenso lifecycle event under a contract row lock, ignoring duplicates, stale deliveries, and terminal-state regressions.';
