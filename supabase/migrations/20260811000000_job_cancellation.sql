-- Calling a job off, and being able to prove the customer was told.
--
-- 'canceled' was already a valid status, but nothing recorded who did it, why,
-- or whether anybody outside the business found out. So a customer sitting at
-- home waiting for an electrician who is never coming, and an office insisting
-- they were texted, had no record to settle it with.
--
-- Notification attempts are stored on the job for the same reason they are
-- stored on a booking: a send that never happened, one that failed, and one
-- that worked otherwise all look identical afterwards.

alter table public.jobs
  add column if not exists canceled_at timestamptz;

alter table public.jobs
  add column if not exists canceled_by uuid references auth.users(id) on delete set null;

-- Free text, shown to the customer verbatim, so it is length-limited rather
-- than trusted: it ends up in a stranger's inbox.
alter table public.jobs
  add column if not exists cancellation_reason text;

alter table public.jobs
  drop constraint if exists jobs_cancellation_reason_check;
alter table public.jobs
  add constraint jobs_cancellation_reason_check
  check (cancellation_reason is null or length(cancellation_reason) <= 500);

alter table public.jobs
  add column if not exists customer_notifications jsonb not null default '[]'::jsonb;

alter table public.jobs
  drop constraint if exists jobs_customer_notifications_check;
alter table public.jobs
  add constraint jobs_customer_notifications_check
  check (jsonb_typeof(customer_notifications) = 'array');

-- Anything already canceled predates this column, so it is stamped with the
-- best evidence available before the constraint below starts requiring one.
update public.jobs set canceled_at = coalesce(canceled_at, updated_at, now())
  where status = 'canceled' and canceled_at is null;

-- A canceled job must carry its timestamp, and an uncanceled one must not.
-- Without this a status flipped by hand elsewhere leaves a job that claims to
-- be canceled with no record of when, which is exactly the gap this migration
-- exists to close.
alter table public.jobs
  drop constraint if exists jobs_canceled_at_matches_status_check;
alter table public.jobs
  add constraint jobs_canceled_at_matches_status_check
  check (
    (status = 'canceled' and canceled_at is not null)
    or (status <> 'canceled' and canceled_at is null)
  );

create index if not exists jobs_canceled_at_idx
  on public.jobs(organization_id, canceled_at desc)
  where canceled_at is not null;

comment on column public.jobs.cancellation_reason is
  'Shown to the customer verbatim in the cancellation text and email.';
comment on column public.jobs.customer_notifications is
  'Every attempt to tell the customer about a change to this job: channel, recipient, outcome, and the reason when one is skipped.';
