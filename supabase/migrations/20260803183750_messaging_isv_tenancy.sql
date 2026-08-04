-- Captured from the deployed database (version 20260803183750), which had this
-- migration applied with no corresponding file in the repo.
--
-- Adds the per-tenant Twilio identifiers the ISV model needs: under a single
-- Twilio account each tenant gets its own subaccount, TrustHub profile, A2P
-- brand, and messaging service, so a campaign rejection or a carrier block hits
-- one tenant rather than every business on the platform.
--
-- No-op where the columns already exist.

alter table public.messaging_settings
  add column if not exists twilio_subaccount_sid text,
  add column if not exists trusthub_profile_sid text,
  add column if not exists a2p_brand_id text,
  add column if not exists messaging_service_sid text;
