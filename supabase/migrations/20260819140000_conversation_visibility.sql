-- ---------------------------------------------------------------------------
-- Hiding a conversation from the inbox, without destroying the business record.
--
-- The inbox needs a way to clear a thread that is finished with. What it must
-- not do is take the history with it: the same messages are the record of what
-- was agreed on a job, and "the owner tidied their inbox" is not a reason for a
-- job to lose its conversation.
--
-- So this is a timestamp, not a delete. `archived_at` already existed and
-- already worked that way; `deleted_at` is its stronger sibling — archived
-- means "done with, still mine", deleted means "out of my inbox" — and neither
-- touches messages, attachments, the customer, the inquiry or the job.
--
-- Both are nullable and default null, so every existing row keeps the meaning
-- it already had.
-- ---------------------------------------------------------------------------

alter table public.conversations
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

comment on column public.conversations.deleted_at is
  'Hidden from the inbox. The conversation, its messages and every relationship it has are kept — this is visibility, not deletion.';

comment on column public.conversations.deleted_by is
  'Who hid it. Kept so an admin looking at a deleted thread can see whose decision it was.';

-- The inbox reads "not archived and not deleted" on every load, and both
-- columns are null for almost every row, so a partial index on the live ones is
-- the shape that helps.
create index if not exists conversations_inbox_idx
  on public.conversations (organization_id, last_message_at desc)
  where archived_at is null and deleted_at is null;

-- And the other direction, for the Deleted view, which is rare and small.
create index if not exists conversations_deleted_idx
  on public.conversations (organization_id, deleted_at desc)
  where deleted_at is not null;
