-- Correct the channel on bookings the AI took by phone.
--
-- `communication_channel` was added and backfilled from `source`, and `source`
-- was the column that had the bug: the voice agent's bookings were written as
-- 'sms'. So the backfill faithfully copied the wrong answer forward, and a job
-- booked by somebody speaking on the telephone still shows a Text badge on the
-- job screen. The code no longer does this — `recordBookingRequest` takes the
-- channel as a required argument — but nothing has gone back for the rows that
-- were already wrong.
--
-- The evidence is `model`. Only `booking-tools.ts`, which exists to serve the
-- voice agent's tool calls, writes 'grok-voice'; nothing else in the codebase
-- uses that string. A row carrying it was a phone call, whatever the channel
-- says.
--
-- Deliberately narrow. Rows the AI took by phone through a path that did not
-- stamp a model are indistinguishable here from a text conversation, and are
-- left alone: a label that is stale is recoverable, a label this migration
-- confidently changed to the wrong thing is not.
--
-- `source` moves with it. The two columns are kept in step by the application,
-- and leaving them disagreeing would make whichever one a future reader picks a
-- coin toss. Note the vocabularies differ — `source` says 'voice' where
-- `communication_channel` says 'phone' — because `source` predates the split
-- and its check constraint has always spelled it that way.

update public.booking_requests
set
  communication_channel = 'phone',
  source = 'voice'
where model = 'grok-voice'
  and (communication_channel is distinct from 'phone' or source is distinct from 'voice');
