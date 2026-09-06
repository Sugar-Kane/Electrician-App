-- Track the external signature request without putting provider tokens into a
-- customer-facing URL.  `contracts.status` remains the plain business state
-- (draft, sent, signed or void); these columns are the audit trail behind it.

alter table public.contracts
  add column if not exists signature_provider text,
  add column if not exists signature_envelope_id text,
  add column if not exists signature_recipient_email text,
  add column if not exists signature_contractor_email text,
  add column if not exists signature_sent_at timestamptz,
  add column if not exists signed_at timestamptz,
  add column if not exists signature_downloaded_at timestamptz,
  add column if not exists signature_rejected_at timestamptz,
  add column if not exists signature_last_event text,
  add column if not exists signature_last_event_at timestamptz;

alter table public.contracts
  drop constraint if exists contracts_signature_provider_check;
alter table public.contracts
  add constraint contracts_signature_provider_check
  check (signature_provider is null or signature_provider in ('documenso'));

create unique index if not exists contracts_signature_envelope_idx
  on public.contracts (signature_provider, signature_envelope_id)
  where signature_provider is not null and signature_envelope_id is not null;

-- A completed envelope becomes the current contract PDF.  Keeping the provider
-- reference on the document makes completion idempotent: a retried webhook can
-- find the already-filed signed copy instead of adding another version.
alter table public.documents
  add column if not exists signature_provider text,
  add column if not exists signature_envelope_id text;

alter table public.documents
  drop constraint if exists documents_signature_provider_check;
alter table public.documents
  add constraint documents_signature_provider_check
  check (signature_provider is null or signature_provider in ('documenso'));

create unique index if not exists documents_signature_envelope_idx
  on public.documents (signature_provider, signature_envelope_id)
  where signature_provider is not null and signature_envelope_id is not null;

comment on column public.contracts.signature_envelope_id is
  'The Documenso envelope for the exact frozen contract PDF sent for signing.';
comment on column public.contracts.signature_last_event_at is
  'Timestamp supplied by the latest processed provider webhook; retries with the same event do not duplicate activity.';
comment on column public.contracts.signature_downloaded_at is
  'When the sealed provider PDF was copied into the private Volteira document folder.';
comment on column public.documents.signature_envelope_id is
  'Present only on the completed, signed PDF downloaded from the signature provider.';
