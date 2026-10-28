-- A person taking over a text conversation from the assistant.
--
-- Set when somebody at the business sends a message from Volteira, or turns
-- the assistant off on the thread; cleared when they turn it back on. While it
-- is set, the assistant reads nothing and replies to nothing in that
-- conversation: the customer's texts wait for the person who took over.
alter table public.conversations
  add column if not exists assistant_paused_at timestamptz,
  add column if not exists assistant_paused_by uuid references auth.users (id) on delete set null;

comment on column public.conversations.assistant_paused_at is
  'When a person took this conversation over from the assistant. While set, the assistant does not reply.';
comment on column public.conversations.assistant_paused_by is
  'Who took the conversation over.';
