-- Twilio keeps the media; Volteira stores only identifiers and safe metadata.
-- Playback is proxied through an authenticated route, so no credential-bearing
-- or reusable provider URL is exposed to the browser.

alter table public.inbound_calls
  add column if not exists recording_sid text,
  add column if not exists recording_status text,
  add column if not exists recording_channels integer,
  add column if not exists recording_started_at timestamptz;

alter table public.inbound_calls
  drop constraint if exists inbound_calls_recording_status_check,
  add constraint inbound_calls_recording_status_check
    check (recording_status is null or recording_status in ('in-progress', 'completed', 'absent', 'failed')),
  drop constraint if exists inbound_calls_recording_channels_check,
  add constraint inbound_calls_recording_channels_check
    check (recording_channels is null or recording_channels in (1, 2));

create unique index if not exists inbound_calls_recording_sid_idx
  on public.inbound_calls (recording_sid)
  where recording_sid is not null;
