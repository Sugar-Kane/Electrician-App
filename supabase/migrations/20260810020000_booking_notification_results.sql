-- Whether anybody was actually told.
--
-- Asked plainly — "how do I know Nick got notified?" — there was no answer. The
-- customer's confirmation text lands in the message thread with its carrier
-- error, but the owner's text and the emails left no trace at all, so a send
-- that never happened and a send that failed looked exactly like a send that
-- worked.
--
-- Every attempt now writes its outcome here: which channel, where it went,
-- whether it succeeded, and what went wrong if not. Kept on the booking rather
-- than in a log table because that is where somebody stands when they ask the
-- question.

alter table public.sms_booking_requests
  add column if not exists notification_results jsonb not null default '[]'::jsonb;

alter table public.sms_booking_requests
  drop constraint if exists sms_booking_requests_notification_results_check;
alter table public.sms_booking_requests
  add constraint sms_booking_requests_notification_results_check
  check (jsonb_typeof(notification_results) = 'array');
