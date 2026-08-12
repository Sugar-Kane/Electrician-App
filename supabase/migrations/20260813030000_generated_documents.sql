-- The PDF a customer actually receives, tied to the record it was made from.
--
-- `documents` already models most of this — storage_path, mime_type,
-- size_bytes, checksum, version_number and archived_at have been there since the
-- storage migration — and nothing has ever written a generated file into it.
-- Invoices and contracts existed only as rows and, for a contract, a block of
-- text with a "Read" button that showed it as plain text.
--
-- What is missing is the link back. A document could say which job it belonged
-- to and not which invoice, so "the PDF for invoice 1024" had no answer and
-- regenerating one after an edit had no way to supersede the last.
--
-- Nullable on purpose: most documents are photos and permits that belong to a
-- job and to no invoice at all.

alter table public.documents
  add column if not exists invoice_id uuid references public.invoices (id) on delete cascade,
  add column if not exists contract_id uuid references public.contracts (id) on delete cascade;

-- A contract PDF had nowhere to be filed: the type list ran from 'intake' to
-- 'other' and contracts were not in it, so they would all have landed as
-- 'other' alongside genuinely miscellaneous files.
alter table public.documents
  drop constraint if exists documents_document_type_check;
alter table public.documents
  add constraint documents_document_type_check
  check (document_type in (
    'intake', 'estimate', 'permit', 'photo_before', 'photo_after',
    'invoice', 'contract', 'payment', 'warranty', 'completion', 'license',
    'insurance', 'certification', 'purchase_order', 'report', 'other'
  ));

-- "The current PDF for this invoice" — the newest one nobody has superseded.
-- Partial, because the overwhelming majority of documents are neither.
create index if not exists documents_invoice_idx
  on public.documents (invoice_id, version_number desc)
  where invoice_id is not null and archived_at is null;

create index if not exists documents_contract_idx
  on public.documents (contract_id, version_number desc)
  where contract_id is not null and archived_at is null;

comment on column public.documents.invoice_id is
  'The invoice this document was generated from. Null for everything that is not a generated invoice PDF.';
comment on column public.documents.contract_id is
  'The contract this document was generated from. Null for everything that is not a generated contract PDF.';

-- Regenerating after an edit supersedes rather than overwrites: the old row is
-- archived and a new one takes version_number + 1. That is what makes "contract
-- v1, v2, signed" a later migration rather than a rewrite — and it is why a
-- customer who was sent v1 can still be shown exactly what they were sent.
comment on column public.documents.version_number is
  'Increments each time the source record is edited and its PDF regenerated. The previous version is archived, never overwritten.';

-- What has to appear on the paperwork.
--
-- A California electrical contractor's invoice carries their CSLB number, and
-- there was nowhere to keep it — so a generated invoice would have gone out
-- without the one thing that makes it a contractor's invoice rather than a
-- receipt. Payment terms are here for the same reason: "due on receipt" versus
-- "net 30" is the business's decision and was hardcoded nowhere because
-- invoices had no document to print it on.
alter table public.organizations
  add column if not exists license_number text,
  add column if not exists payment_terms text;

alter table public.organizations
  drop constraint if exists organizations_license_number_check;
alter table public.organizations
  add constraint organizations_license_number_check
  check (license_number is null or char_length(license_number) between 2 and 40);

alter table public.organizations
  drop constraint if exists organizations_payment_terms_check;
alter table public.organizations
  add constraint organizations_payment_terms_check
  check (payment_terms is null or char_length(payment_terms) <= 300);

comment on column public.organizations.license_number is
  'Contractor licence as it must appear on invoices and contracts, e.g. a CSLB number. Printed verbatim.';
comment on column public.organizations.payment_terms is
  'What the invoice footer says about when payment is due. Falls back to "Payment is due on receipt." when unset.';
