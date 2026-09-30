-- Server-only storage: calendar credentials must never be readable through a user session.
create table public.booking_calendar_connections (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 account_email text not null,
 encrypted_refresh_token text,
 last_error text,
 connected_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.booking_calendar_connections enable row level security;
revoke all on public.booking_calendar_connections from public,anon,authenticated;
grant all on public.booking_calendar_connections to service_role;
create table public.booking_calendar_events (
 booking_request_id uuid primary key references public.booking_requests(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 account_email text not null,
 event_id text not null,
 synced_at timestamptz,
 last_error text
);
alter table public.booking_calendar_events enable row level security;
revoke all on public.booking_calendar_events from public,anon,authenticated;
grant all on public.booking_calendar_events to service_role;
