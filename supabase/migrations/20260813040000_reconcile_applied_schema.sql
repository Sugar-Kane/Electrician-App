-- Everything the deployed database has and this repository never declared.
--
-- Six migrations were applied to production that are not in `supabase/`:
-- document_folders_year_month_blueprint, ai_receptionist, assistant_memories,
-- booking_requests_status_union, payments_point_at_booking_requests and
-- drop_booking_intakes. The last three turned out to be the same work as
-- migrations that *are* here under different names, so their effects already
-- match. The first three left real objects behind with nothing to recreate
-- them, which means `supabase db reset` produced a database the application
-- could not run against — `src/lib/assistant-memory.ts` reads a table no
-- migration created.
--
-- The repository even knew: the header of realign_document_folder_triggers
-- names document_folders_year_month_blueprint as the thing it is correcting,
-- and that migration is not here.
--
-- Written from the live schema rather than from memory, and idempotent
-- throughout, so it is a no-op against production and rebuilds the missing
-- pieces anywhere else. Nothing here is a design decision; it is a transcript.

-- 1. document_folders_year_month_blueprint
--
-- Filing by year and month. `realign_document_folder_triggers` already narrowed
-- folder_type to include 'year' and 'month' — it is only these three columns
-- that went missing.

alter table public.document_folders
  add column if not exists period_year integer,
  add column if not exists period_month integer,
  add column if not exists filed_on date;

alter table public.document_folders
  drop constraint if exists document_folders_period_year_check;
alter table public.document_folders
  add constraint document_folders_period_year_check
  check (period_year is null or (period_year >= 2000 and period_year <= 2999));

alter table public.document_folders
  drop constraint if exists document_folders_period_month_check;
alter table public.document_folders
  add constraint document_folders_period_month_check
  check (period_month is null or (period_month >= 1 and period_month <= 12));

-- 2. assistant_memories
--
-- What the assistant has been told to remember about a business. Read by
-- src/lib/assistant-memory.ts, which is how the gap was found.

create table if not exists public.assistant_memories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  fact text not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

alter table public.assistant_memories
  drop constraint if exists assistant_memories_fact_check;
-- `trim(both from fact)` rather than the equivalent `btrim(fact)`: Postgres
-- stores the expression as written, and the deployed constraint says the
-- former. They behave identically, and a reconciliation whose whole purpose is
-- fidelity should not leave the two databases rendering the same rule
-- differently.
alter table public.assistant_memories
  add constraint assistant_memories_fact_check
  check (length(trim(both from fact)) > 0 and length(fact) <= 500);

create index if not exists assistant_memories_org_idx
  on public.assistant_memories (organization_id, archived_at, created_at desc);

alter table public.assistant_memories enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
    and tablename = 'assistant_memories' and policyname = 'assistant_memories_member_read') then
    create policy "assistant_memories_member_read"
      on public.assistant_memories for select
      using ((select private.is_org_member(organization_id)));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
    and tablename = 'assistant_memories' and policyname = 'assistant_memories_member_write') then
    create policy "assistant_memories_member_write"
      on public.assistant_memories for all
      using ((select private.is_org_member(organization_id)))
      with check ((select private.is_org_member(organization_id)));
  end if;
end;
$$;

-- 3. ai_receptionist
--
-- Calls and texts as they arrive, before anything decides they are a booking.
-- Separate from `conversations` and `messages`, which are the outbound
-- messaging system: this is what the receptionist heard.

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'inbound_channel') then
    create type public.inbound_channel as enum ('voice', 'sms');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'lead_status') then
    create type public.lead_status as enum ('new', 'contacted', 'scheduled', 'converted', 'closed');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'lead_urgency') then
    create type public.lead_urgency as enum ('emergency', 'urgent', 'routine', 'unknown');
  end if;
end;
$$;

create table if not exists public.inbound_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_phone text not null,
  contact_name text,
  customer_id uuid references public.customers (id) on delete set null,
  last_channel public.inbound_channel not null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, contact_phone)
);

create index if not exists inbound_conversations_org_recent_idx
  on public.inbound_conversations (organization_id, last_message_at desc);
create index if not exists inbound_conversations_customer_idx
  on public.inbound_conversations (customer_id);

create table if not exists public.inbound_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid references public.inbound_conversations (id) on delete set null,
  provider text not null,
  provider_call_id text not null,
  from_number text not null,
  to_number text not null,
  status text not null,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  ended_reason text,
  recording_url text,
  transcript text,
  summary text,
  created_at timestamptz not null default now(),
  unique (provider, provider_call_id)
);

create index if not exists inbound_calls_org_created_idx
  on public.inbound_calls (organization_id, created_at desc);
create index if not exists inbound_calls_conversation_idx
  on public.inbound_calls (conversation_id);

create table if not exists public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.inbound_conversations (id) on delete cascade,
  channel public.inbound_channel not null,
  role text not null check (role in ('contact', 'assistant', 'staff')),
  body text not null,
  provider_message_id text,
  created_at timestamptz not null default now()
);

create index if not exists inbound_messages_conversation_idx
  on public.inbound_messages (conversation_id, created_at);
create index if not exists inbound_messages_org_idx
  on public.inbound_messages (organization_id);

create table if not exists public.inbound_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid references public.inbound_conversations (id) on delete set null,
  call_id uuid references public.inbound_calls (id) on delete set null,
  channel public.inbound_channel not null,
  status public.lead_status not null default 'new',
  urgency public.lead_urgency not null default 'unknown',
  contact_name text,
  contact_phone text not null,
  contact_email text,
  service_address text,
  job_type text,
  summary text not null,
  preferred_times text,
  captured_by text not null default 'ai',
  converted_job_id uuid references public.jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inbound_leads_org_status_idx
  on public.inbound_leads (organization_id, status, created_at desc);
create index if not exists inbound_leads_conversation_idx
  on public.inbound_leads (conversation_id);
create index if not exists inbound_leads_call_idx on public.inbound_leads (call_id);
create index if not exists inbound_leads_converted_job_idx
  on public.inbound_leads (converted_job_id);

create table if not exists public.inbound_numbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  phone_number text not null unique,
  label text,
  voice_enabled boolean not null default true,
  sms_enabled boolean not null default true,
  forward_to_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inbound_numbers_org_idx
  on public.inbound_numbers (organization_id);

alter table public.inbound_conversations enable row level security;
alter table public.inbound_calls enable row level security;
alter table public.inbound_messages enable row level security;
alter table public.inbound_leads enable row level security;
alter table public.inbound_numbers enable row level security;

-- Read for members, writes only where the deployed policies allow them: staff
-- may add their own replies to a thread and admins may manage the numbers.
-- Everything else is written by the webhooks through the service role, which
-- bypasses RLS — so there is deliberately no member insert policy on calls,
-- conversations or leads.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='inbound_conversations'
    and policyname='Organization members can view inbound conversations') then
    create policy "Organization members can view inbound conversations"
      on public.inbound_conversations for select to authenticated
      using ((select private.is_org_member(organization_id)));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='inbound_calls'
    and policyname='Organization members can view inbound calls') then
    create policy "Organization members can view inbound calls"
      on public.inbound_calls for select to authenticated
      using ((select private.is_org_member(organization_id)));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='inbound_messages'
    and policyname='Organization members can view inbound messages') then
    create policy "Organization members can view inbound messages"
      on public.inbound_messages for select to authenticated
      using ((select private.is_org_member(organization_id)));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='inbound_messages'
    and policyname='Organization members can add staff replies') then
    create policy "Organization members can add staff replies"
      on public.inbound_messages for insert to authenticated
      with check ((select private.is_org_member(organization_id)) and role = 'staff');
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='inbound_leads'
    and policyname='Organization members can view inbound leads') then
    create policy "Organization members can view inbound leads"
      on public.inbound_leads for select to authenticated
      using ((select private.is_org_member(organization_id)));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='inbound_leads'
    and policyname='Organization members can update inbound leads') then
    create policy "Organization members can update inbound leads"
      on public.inbound_leads for update to authenticated
      using ((select private.is_org_member(organization_id)))
      with check ((select private.is_org_member(organization_id)));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='inbound_numbers'
    and policyname='Organization members can view inbound numbers') then
    create policy "Organization members can view inbound numbers"
      on public.inbound_numbers for select to authenticated
      using ((select private.is_org_member(organization_id)));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='inbound_numbers'
    and policyname='Organization admins can manage inbound numbers') then
    create policy "Organization admins can manage inbound numbers"
      on public.inbound_numbers for all to authenticated
      using ((select private.is_org_admin(organization_id)))
      with check ((select private.is_org_admin(organization_id)));
  end if;
end;
$$;

-- `create trigger if not exists` does not exist before Postgres 18, and this
-- has to be safe to run against a database that already has them.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'set_assistant_memories_updated_at') then
    create trigger set_assistant_memories_updated_at
      before update on public.assistant_memories
      for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'set_inbound_conversations_updated_at') then
    create trigger set_inbound_conversations_updated_at
      before update on public.inbound_conversations
      for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'set_inbound_leads_updated_at') then
    create trigger set_inbound_leads_updated_at
      before update on public.inbound_leads
      for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'set_inbound_numbers_updated_at') then
    create trigger set_inbound_numbers_updated_at
      before update on public.inbound_numbers
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

comment on table public.assistant_memories is
  'Facts the assistant has been told to remember about a business. Reconciled from the deployed schema.';
comment on table public.inbound_leads is
  'What the AI receptionist took down, before anybody decided it was a booking. Reconciled from the deployed schema.';
