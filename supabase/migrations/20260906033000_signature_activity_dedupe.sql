-- A provider webhook and the browser action can observe the same signature
-- transition independently. Give those two writers one durable event key so
-- recovery fills a missing history row without ever duplicating it.

alter table public.activity_events
  add column if not exists dedupe_key text;

create unique index if not exists activity_events_organization_dedupe_key_idx
  on public.activity_events (organization_id, dedupe_key);

comment on column public.activity_events.dedupe_key is
  'Optional stable key for an externally observable event that more than one recovery path may record.';
