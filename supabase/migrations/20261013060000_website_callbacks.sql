-- The assistant calling back the people who asked for a call.
--
-- When a website request says "call me", the assistant rings them from the
-- business's number. What happened on that call belongs on the request, where
-- the owner is looking: whether it was answered, went to voicemail or rang out.
-- The call's Twilio id is what the status callback finds the request by.
--
-- calling and answered are the live states; completed, voicemail, no_answer,
-- busy and failed are where a call ends, and moving into one is claimed once,
-- so a retried status callback cannot alert the owner twice.

alter table public.booking_requests
  add column if not exists callback_call_sid text
    check (callback_call_sid is null or callback_call_sid ~ '^CA[0-9a-f]{32}$'),
  add column if not exists callback_called_at timestamptz,
  add column if not exists callback_outcome text
    check (callback_outcome is null or callback_outcome in ('calling', 'answered', 'completed', 'voicemail', 'no_answer', 'busy', 'failed'));

create unique index if not exists booking_requests_callback_call_idx
  on public.booking_requests (callback_call_sid)
  where callback_call_sid is not null;
