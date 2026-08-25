-- Making the way back real.
--
-- Every regeneration since August has archived the version it replaced rather
-- than deleting it, and `restoreDocumentVersion` swaps two flags to put an
-- earlier one back on file. That has been honest so far only because
-- regeneration is deterministic: a contract PDF is rebuilt from
-- `contracts.body`, so the file and the record cannot disagree.
--
-- The moment the assistant can *edit* that record, the swap stops being an
-- undo. The file goes back, the source does not, and the next regeneration
-- quietly reintroduces the edit somebody believed they had reversed. A
-- claw-back that restores the picture and not the thing is worse than none,
-- because it is believed.
--
-- So a version carries the source that produced it.

alter table public.documents
  add column if not exists source_snapshot jsonb;

comment on column public.documents.source_snapshot is
  'The record this version was rendered from, so restoring the version can restore the record. Null for versions made before edits were tracked.';

-- Deliberately nullable with no backfill. Every version that already exists
-- predates this, and there is no honest way to reconstruct what produced it —
-- a guessed snapshot would restore a record to something it never held. A null
-- says "unknown", and the restore path says so out loud rather than pretending.

-- What was substituted for {{scope}} when the body was frozen.
--
-- `contracts.body` is the filled template, kept verbatim so the document can be
-- reproduced years later without the template, the prices or the model still
-- agreeing with what they said that day. That is the right call and it is why
-- this column is needed: without knowing exactly which passage was the scope,
-- there is no way to replace that passage and nothing else, and "the assistant
-- may edit the scope of work" becomes unenforceable.
alter table public.contracts
  add column if not exists scope text;

comment on column public.contracts.scope is
  'The scope-of-work passage as substituted into body, so it can be replaced without touching the terms around it.';
