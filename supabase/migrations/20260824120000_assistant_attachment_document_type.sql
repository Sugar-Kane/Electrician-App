-- Let a file attached to the assistant actually be recorded.
--
-- `createAssistantUpload`/`recordAssistantAttachment` write documents with
-- `document_type = 'assistant_attachment'`, and that value is in no version of
-- `documents_document_type_check`. So every photo or PDF somebody attached to a
-- question uploaded to storage fine and then failed on the insert with 23514,
-- and the turn saw nothing to look at.
--
-- The list is restated in full rather than patched, because a check constraint
-- cannot be extended in place. Every value the constraint accepts today is kept,
-- including 'receipt', which lives in the deployed database and in the previous
-- migration's list but in no create statement.
alter table public.documents
  drop constraint if exists documents_document_type_check;

alter table public.documents
  add constraint documents_document_type_check
  check (document_type in (
    'intake', 'estimate', 'permit', 'photo_before', 'photo_after',
    'invoice', 'contract', 'payment', 'warranty', 'completion', 'license',
    'insurance', 'certification', 'purchase_order', 'report', 'receipt',
    'assistant_attachment', 'other'
  ));
