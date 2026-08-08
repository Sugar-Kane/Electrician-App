-- AI receptionist: inbound calls and texts from people who are not customers yet.
--
-- A stranger phones or texts the business number. The AI answers, works out who
-- they are and what they need, answers questions about the business, and files a
-- lead. Nobody is signed in on that path, so every write below happens through
-- the service role in a webhook and every read policy is scoped to org members.

create type public.inbound_channel as enum ('voice', 'sms');

create type public.lead_status as enum ('new', 'contacted', 'scheduled', 'converted', 'closed');

create type public.lead_urgency as enum ('emergency', 'urgent', 'routine', 'unknown');

-- Maps a phone number the public dials or texts to the tenant that owns it.
-- Inbound webhooks carry a number, not an organization, so this is the only way
-- to resolve a caller to a tenant.
create table public.inbound_numbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  phone_number text not null unique,
  label text,
  voice_enabled boolean not null default true,
  sms_enabled boolean not null default true,
  forward_to_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.inbound_numbers.phone_number is 'E.164, e.g. +18055550168. Unique across tenants: one number belongs to one business.';
comment on column public.inbound_numbers.forward_to_number is 'Where a live transfer or missed-call escalation rings. Null disables transfer.';

-- One thread per person per tenant, spanning both channels, so a caller who
-- texts later is recognized rather than treated as a new stranger.
create table public.inbound_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_phone text not null,
  contact_name text,
  customer_id uuid references public.customers(id) on delete set null,
  last_channel public.inbound_channel not null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, contact_phone)
);

create table public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.inbound_conversations(id) on delete cascade,
  channel public.inbound_channel not null,
  -- 'contact' is the person outside the business; 'assistant' is the AI;
  -- 'staff' is a human at the business replying from the app.
  role text not null check (role in ('contact', 'assistant', 'staff')),
  body text not null,
  provider_message_id text,
  created_at timestamptz not null default now()
);

create table public.inbound_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid references public.inbound_conversations(id) on delete set null,
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

comment on column public.inbound_calls.recording_url is 'Only populated when recording is enabled at the provider. California is a two-party consent state, so the agent must disclose recording before it starts.';

-- What the AI actually captured. Deliberately separate from customers/jobs: a
-- lead is unverified until someone at the business acts on it.
create table public.inbound_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid references public.inbound_conversations(id) on delete set null,
  call_id uuid references public.inbound_calls(id) on delete set null,
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
  converted_job_id uuid references public.jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.inbound_leads.summary is 'The AI''s account of what the caller wants, in the caller''s terms. Not a diagnosis.';

create index inbound_numbers_org_idx on public.inbound_numbers(organization_id);
create index inbound_conversations_org_recent_idx on public.inbound_conversations(organization_id, last_message_at desc);
create index inbound_conversations_customer_idx on public.inbound_conversations(customer_id);
create index inbound_messages_conversation_idx on public.inbound_messages(conversation_id, created_at);
create index inbound_messages_org_idx on public.inbound_messages(organization_id);
create index inbound_calls_org_created_idx on public.inbound_calls(organization_id, created_at desc);
create index inbound_calls_conversation_idx on public.inbound_calls(conversation_id);
create index inbound_leads_org_status_idx on public.inbound_leads(organization_id, status, created_at desc);
create index inbound_leads_conversation_idx on public.inbound_leads(conversation_id);
create index inbound_leads_call_idx on public.inbound_leads(call_id);
create index inbound_leads_converted_job_idx on public.inbound_leads(converted_job_id);

create trigger set_inbound_numbers_updated_at
  before update on public.inbound_numbers
  for each row execute function public.set_updated_at();

create trigger set_inbound_conversations_updated_at
  before update on public.inbound_conversations
  for each row execute function public.set_updated_at();

create trigger set_inbound_leads_updated_at
  before update on public.inbound_leads
  for each row execute function public.set_updated_at();

alter table public.inbound_numbers enable row level security;
alter table public.inbound_conversations enable row level security;
alter table public.inbound_messages enable row level security;
alter table public.inbound_calls enable row level security;
alter table public.inbound_leads enable row level security;

-- Reads are org-member only. There are deliberately no insert/update policies
-- for anon or authenticated on the webhook-written tables: inbound traffic is
-- written by the service role, which bypasses RLS, so an authenticated user
-- cannot forge a call, a transcript, or a lead.
create policy "Organization members can view inbound numbers"
  on public.inbound_numbers for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy "Organization admins can manage inbound numbers"
  on public.inbound_numbers for all to authenticated
  using ((select private.is_org_admin(organization_id)))
  with check ((select private.is_org_admin(organization_id)));

create policy "Organization members can view inbound conversations"
  on public.inbound_conversations for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy "Organization members can view inbound messages"
  on public.inbound_messages for select to authenticated
  using ((select private.is_org_member(organization_id)));

-- Staff replies from inside the app are the one message a signed-in user may
-- write, and only as themselves.
create policy "Organization members can add staff replies"
  on public.inbound_messages for insert to authenticated
  with check ((select private.is_org_member(organization_id)) and role = 'staff');

create policy "Organization members can view inbound calls"
  on public.inbound_calls for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy "Organization members can view inbound leads"
  on public.inbound_leads for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy "Organization members can update inbound leads"
  on public.inbound_leads for update to authenticated
  using ((select private.is_org_member(organization_id)))
  with check ((select private.is_org_member(organization_id)));
