-- Phone calls answered by the app.
--
-- A call is a conversation with no thread to hang it on: Twilio hands back one
-- transcribed sentence at a time and expects an answer within seconds, so the
-- turns so far have to live somewhere addressable by CallSid between requests.
--
-- It doubles as the record of what was said, which is the part a business
-- actually needs the morning after — the schedule shows the appointment, this
-- shows how it was arrived at.

create table if not exists public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  call_sid text not null unique,
  from_number text not null,
  to_number text not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'transferred', 'emergency', 'abandoned')),
  -- [{ "role": "user" | "assistant", "text": "..." }], oldest first.
  turns jsonb not null default '[]'::jsonb
    check (jsonb_typeof(turns) = 'array'),
  failed_turns integer not null default 0 check (failed_turns >= 0),
  outcome text,
  booking_request_id uuid references public.sms_booking_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists voice_calls_org_created_idx
  on public.voice_calls(organization_id, created_at desc);
create index if not exists voice_calls_customer_idx on public.voice_calls(customer_id);
create index if not exists voice_calls_booking_request_idx on public.voice_calls(booking_request_id);

drop trigger if exists set_voice_calls_updated_at on public.voice_calls;
create trigger set_voice_calls_updated_at
before update on public.voice_calls
for each row execute function public.set_updated_at();

alter table public.voice_calls enable row level security;

drop policy if exists "Organization members can view voice calls" on public.voice_calls;
create policy "Organization members can view voice calls"
on public.voice_calls for select
to authenticated
using ((select private.is_org_member(organization_id)));

-- Written only by the voice webhook through the service role. A transcript of
-- what a customer said in their own home is not anon-readable.
revoke all on table public.voice_calls from public, anon;
grant select on table public.voice_calls to authenticated;
