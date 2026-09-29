-- Production and these files now describe the same database.
--
-- A database built from this directory was compared with production, object
-- by object: every table and column, function, index, constraint, trigger,
-- policy and grant. 1,251 of 1,278 matched. Fifteen more were function bodies
-- that differ only in comments and spacing; the code is identical. What is
-- left is settled here, and in every case the files were right.

/*
 * 1. What #105 left behind.
 *
 * Its Documenso migrations ran in production but never merged, and the PR is
 * closed: built-in signing (#108) took its place. These columns are empty, and
 * nothing in the app or the database uses them or the two functions. If
 * Documenso ever comes back, its own migrations recreate all of it.
 *
 * The columns #108 shares with it stay — signature_provider, signed_at,
 * signature_sent_at, signature_send_token — because
 * 20260927120000_contract_signatures.sql creates them.
 */
drop function if exists public.apply_documenso_event(text, uuid, text, timestamptz, text, timestamptz);
drop function if exists public.finalize_signed_contract_document(uuid, uuid, uuid, timestamptz, timestamptz);

drop index if exists public.contracts_signature_envelope_idx;
drop index if exists public.documents_signature_envelope_idx;
drop index if exists public.activity_events_organization_dedupe_key_idx;

alter table public.contracts
  drop column if exists signature_envelope_id,
  drop column if exists signature_recipient_email,
  drop column if exists signature_contractor_email,
  drop column if exists signature_downloaded_at,
  drop column if exists signature_rejected_at,
  drop column if exists signature_last_event,
  drop column if exists signature_last_event_at,
  drop column if exists signature_send_started_at;

alter table public.documents
  drop column if exists signature_envelope_id;

alter table public.activity_events
  drop column if exists dedupe_key;

/*
 * 2. A second trigger doing the first one's job.
 *
 * Production kept an early `sync_tenant_legal_slug_on_org_rename` alongside
 * `sync_tenant_legal_page_slug`, so renaming a business rewrote its legal
 * page's slug twice. The one these files create stays; `updated_at` is still
 * bumped by the page's own trigger.
 */
drop trigger if exists sync_tenant_legal_slug_on_org_rename on public.organizations;

/*
 * 3. A cloud link goes with its folder.
 *
 * The migration that creates `document_cloud_links` says `on delete cascade`;
 * production had `restrict`, under which deleting a folder that had been synced
 * to Google Drive fails on its own link. The table is empty, so this changes
 * no rows, only what happens next time.
 */
alter table public.document_cloud_links
  drop constraint if exists document_cloud_links_folder_id_fkey;
alter table public.document_cloud_links
  add constraint document_cloud_links_folder_id_fkey
  foreign key (folder_id) references public.document_folders (id) on delete cascade;
