-- Captured from the deployed database, which had this migration applied
-- (version 20260803173933) with no corresponding file in the repo. Without it
-- the repo cannot rebuild the deployed schema: booking payment confirmation
-- writes to public.messaging_consent, and nothing here created that table.
--
-- Every statement is written to be a no-op where the object already exists, so
-- applying this against the deployed database changes nothing. It is a faithful
-- capture, not a redesign — differences from what this repo would write today
-- are called out in comments rather than silently corrected.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  channel text not null default 'sms' check (channel in ('sms', 'email')),
  status text not null default 'open'
    check (status in ('open', 'snoozed', 'closed', 'needs_human')),
  assigned_to uuid references auth.users(id) on delete set null,
  escalation_reason text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null check (char_length(body) between 1 and 1600),
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'undelivered', 'received')),
  provider_message_id text,
  error_code text,
  error_detail text,
  ai_generated boolean not null default false,
  ai_model text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  scheduled_for timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider_message_id)
);

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  trigger_event text not null check (trigger_event in (
    'job_awaiting_payment', 'job_confirmed', 'job_reminder', 'job_en_route',
    'job_arrived', 'job_completed', 'job_rescheduled', 'job_canceled',
    'estimate_sent', 'invoice_sent', 'invoice_overdue', 'review_request'
  )),
  channel text not null default 'sms' check (channel in ('sms', 'email')),
  body text not null check (char_length(body) between 1 and 1600),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, trigger_event, channel)
);

create table if not exists public.messaging_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  provider text not null default 'twilio'
    check (provider in ('twilio', 'messagebird', 'telnyx')),
  messaging_phone text,
  quiet_hours_start time not null default '21:00:00',
  quiet_hours_end time not null default '08:00:00',
  ai_enabled boolean not null default false,
  ai_autosend_enabled boolean not null default false,
  ai_disclosure_text text not null default 'You are chatting with an automated assistant.',
  a2p_campaign_id text,
  a2p_registered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The consent ledger the sending path reads. Consent captured on the public
-- booking form lands here when the intake converts to a customer, with the
-- disclosure the customer saw kept in proof_text.
create table if not exists public.messaging_consent (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  channel text not null check (channel in ('sms', 'email')),
  scope text not null check (scope in ('transactional', 'marketing')),
  opted_in_at timestamptz,
  opted_out_at timestamptz,
  source text not null
    check (source in ('booking_form', 'verbal', 'written', 'inbound_text', 'import', 'admin')),
  proof_text text,
  captured_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, channel, scope)
);

create index if not exists conversations_organization_id_idx on public.conversations(organization_id);
create index if not exists conversations_customer_id_idx on public.conversations(customer_id);
create index if not exists conversations_job_id_idx on public.conversations(job_id);
create index if not exists conversations_assigned_to_idx on public.conversations(assigned_to);
create index if not exists messages_organization_id_idx on public.messages(organization_id);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at desc);
create index if not exists messages_approved_by_idx on public.messages(approved_by);
create index if not exists messages_pending_send_idx on public.messages(scheduled_for) where status = 'queued';
create index if not exists message_templates_organization_id_idx on public.message_templates(organization_id);
create index if not exists messaging_settings_organization_id_idx on public.messaging_settings(organization_id);
create index if not exists messaging_consent_organization_id_idx on public.messaging_consent(organization_id);
create index if not exists messaging_consent_customer_id_idx on public.messaging_consent(customer_id);
create index if not exists messaging_consent_captured_by_idx on public.messaging_consent(captured_by);
create index if not exists messaging_consent_active_idx
  on public.messaging_consent(customer_id, channel, scope)
  where opted_out_at is null and opted_in_at is not null;

drop trigger if exists set_conversations_updated_at on public.conversations;
create trigger set_conversations_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

drop trigger if exists set_messages_updated_at on public.messages;
create trigger set_messages_updated_at
before update on public.messages
for each row execute function public.set_updated_at();

drop trigger if exists set_message_templates_updated_at on public.message_templates;
create trigger set_message_templates_updated_at
before update on public.message_templates
for each row execute function public.set_updated_at();

drop trigger if exists set_messaging_settings_updated_at on public.messaging_settings;
create trigger set_messaging_settings_updated_at
before update on public.messaging_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_messaging_consent_updated_at on public.messaging_consent;
create trigger set_messaging_consent_updated_at
before update on public.messaging_consent
for each row execute function public.set_updated_at();

-- Same org-member policy set the foundation migration applies to every
-- tenant-scoped table, created only where it is not already present.
do $$
declare
  messaging_table text;
begin
  foreach messaging_table in array array[
    'conversations', 'messages', 'message_templates', 'messaging_settings',
    'messaging_consent'
  ]
  loop
    execute format('alter table public.%I enable row level security', messaging_table);

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = messaging_table
        and policyname = format('Organization members can view %s', messaging_table)
    ) then
      execute format(
        'create policy "Organization members can view %1$s" on public.%1$I for select to authenticated using ((select private.is_org_member(organization_id)))',
        messaging_table
      );
      execute format(
        'create policy "Organization members can add %1$s" on public.%1$I for insert to authenticated with check ((select private.is_org_member(organization_id)))',
        messaging_table
      );
      execute format(
        'create policy "Organization members can update %1$s" on public.%1$I for update to authenticated using ((select private.is_org_member(organization_id))) with check ((select private.is_org_member(organization_id)))',
        messaging_table
      );
      execute format(
        'create policy "Organization members can delete %1$s" on public.%1$I for delete to authenticated using ((select private.is_org_member(organization_id)))',
        messaging_table
      );
    end if;
  end loop;
end;
$$;

grant select, insert, update, delete on table public.conversations to authenticated, service_role;
grant select, insert, update, delete on table public.messages to authenticated, service_role;
grant select, insert, update, delete on table public.message_templates to authenticated, service_role;
grant select, insert, update, delete on table public.messaging_settings to authenticated, service_role;
grant select, insert, update, delete on table public.messaging_consent to authenticated, service_role;

-- Captured as found: the deployed database also grants anon select, insert, and
-- update on public.messages. No anon policy exists on that table, so RLS denies
-- every row today and the grant is unreachable. It is revoked in a later
-- migration rather than here, to keep this file a faithful capture.
grant select, insert, update on table public.messages to anon;
