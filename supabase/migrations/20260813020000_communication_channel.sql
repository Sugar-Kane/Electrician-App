-- How the customer reached us, kept apart from who did the talking.
--
-- `booking_requests.source` has meant two things at once since it was added:
-- 'sms', 'voice' and 'web' are transports, and 'owner' is a person. So there was
-- no way to say "a phone call, handled by the AI" versus "a phone call, taken by
-- the owner" — and, worse, no code ever set the column at all.
--
-- `recordBookingRequest` is shared by the SMS intake and the voice intake and
-- writes neither value, so every row fell to the `default 'sms'`. A customer who
-- rang up and spoke to the AI receptionist was filed as a text message, and the
-- only reason the older rows read correctly is a one-off backfill in the
-- one_booking_table migration that matched them against voice_calls.
--
-- Two columns, because they answer two questions and the analytics that matter
-- later need both: "are the phones or the texts bringing in work" is a channel
-- question, and "is the AI actually closing bookings" is not.
--
-- Note on the name: `created_by` here is a kind of actor, not a user id. On
-- `jobs` and `documents` the same word is a uuid. They are deliberately
-- different things — a booking request has no single user behind it when a
-- machine took it — and this is the one place the two conventions meet.

alter table public.booking_requests
  add column if not exists communication_channel text not null default 'sms'
    check (communication_channel in ('phone', 'sms', 'web', 'manual'));

alter table public.booking_requests
  add column if not exists created_by text not null default 'ai'
    check (created_by in ('ai', 'customer', 'staff'));

-- What the old column already knew, split into the two things it was saying.
-- 'voice' was always a phone call; 'owner' was always a person typing it in.
update public.booking_requests
set communication_channel = case source
      when 'voice' then 'phone'
      when 'web' then 'web'
      when 'owner' then 'manual'
      else 'sms'
    end,
    created_by = case source
      when 'owner' then 'staff'
      when 'web' then 'customer'
      else 'ai'
    end;

-- Anything with a call attached was a phone call, whatever the source column
-- was left at. This repeats the one_booking_table backfill deliberately: rows
-- created since then have the same defect and the same evidence for fixing it.
update public.booking_requests r
set communication_channel = 'phone'
where exists (select 1 from public.voice_calls v where v.booking_request_id = r.id);

comment on column public.booking_requests.communication_channel is
  'How the customer reached us: phone, sms, web or manual. The transport, never who handled it.';
comment on column public.booking_requests.created_by is
  'Who produced the request: ai, customer or staff. A kind of actor, not a user id — unlike created_by elsewhere.';

-- "Where is the work coming from", answered without a scan.
create index if not exists booking_requests_channel_idx
  on public.booking_requests (organization_id, communication_channel, created_at desc);

-- Reading a job's origin means looking it up by the job it created, which had
-- no index of its own on the renamed table.
create index if not exists booking_requests_created_job_idx
  on public.booking_requests (created_job_id)
  where created_job_id is not null;
