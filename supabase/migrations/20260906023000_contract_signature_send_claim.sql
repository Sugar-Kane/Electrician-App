-- Claim a draft while its external envelope is being created.  A disabled UI
-- button prevents a normal double-click; this claim also covers concurrent
-- browser tabs and multiple owners.  Old claims expire in application logic so
-- a crashed request cannot leave the contract stuck forever.

alter table public.contracts
  add column if not exists signature_send_token uuid,
  add column if not exists signature_send_started_at timestamptz;

comment on column public.contracts.signature_send_token is
  'Short-lived idempotency claim held while an external signing envelope is created.';
comment on column public.contracts.signature_send_started_at is
  'Start time for the signature-send claim; claims older than ten minutes may be replaced.';
