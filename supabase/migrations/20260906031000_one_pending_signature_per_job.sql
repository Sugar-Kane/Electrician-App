-- A job can have many historical drafts, but only one contract may be in the
-- act of being sent or waiting for signatures.  The send token enters this
-- index before any provider envelope is created, so two different drafts
-- cannot both pass a read-then-send race.

create unique index if not exists contracts_one_pending_signature_per_job_idx
  on public.contracts (job_id)
  where job_id is not null
    and (
      status = 'sent'
      or (status = 'draft' and signature_send_token is not null)
    );

comment on index public.contracts_one_pending_signature_per_job_idx is
  'Allows one in-flight or sent signature request per job, across all of its contract drafts.';

comment on column public.contracts.signature_send_token is
  'Short-lived claim that freezes a draft while its exact PDF is restored or sent for signature.';
