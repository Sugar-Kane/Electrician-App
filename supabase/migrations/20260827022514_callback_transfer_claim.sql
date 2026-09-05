-- One open callback can be reused across calls, but only one concurrent MCP
-- invocation may redirect the live Twilio call. The notification sender has
-- its own atomic claim; this is the equivalent claim for a transfer.
alter table public.booking_requests
  add column if not exists transfer_started_at timestamptz;

comment on column public.booking_requests.transfer_started_at is
  'Atomic claim that prevents duplicate AI tool calls from starting multiple live transfers.';
