-- The language a customer gets written to in.
--
-- Two columns rather than one, and the second is the whole point.
--
-- Detecting a language from a text message is a guess. "ok gracias" from an
-- English speaker is one word of Spanish, and a guess that keeps overwriting
-- the owner's correction is worse than no detection at all — the owner fixes
-- it, the next message flips it back, and they stop trusting the setting.
--
-- So `language_source` records *who decided*. Detection may only write over a
-- row it decided itself; a row the owner set is never touched again.

alter table public.customers
  add column if not exists preferred_language text not null default 'en',
  add column if not exists language_source text not null default 'detected';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname = 'customers_preferred_language_check'
  ) then
    alter table public.customers
      add constraint customers_preferred_language_check
      check (preferred_language in ('en', 'es'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname = 'customers_language_source_check'
  ) then
    alter table public.customers
      add constraint customers_language_source_check
      check (language_source in ('detected', 'owner'));
  end if;
end $$;

comment on column public.customers.preferred_language is
  'The language this customer is written to in.';
comment on column public.customers.language_source is
  'Who decided it. Detection may only overwrite ''detected''; ''owner'' is final.';

-- One body per trigger per language.
--
-- The automatic messages are rows the owner edits, not strings in code, so a
-- Spanish message is a Spanish row — which means the owner can rewrite the
-- wording in their own voice exactly as they can the English.
alter table public.message_templates
  add column if not exists language text not null default 'en';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.message_templates'::regclass
      and conname = 'message_templates_language_check'
  ) then
    alter table public.message_templates
      add constraint message_templates_language_check
      check (language in ('en', 'es'));
  end if;
end $$;

-- The old key allowed one row per (organization, trigger, channel), which is
-- exactly one language. Widened so the pair can coexist.
alter table public.message_templates
  drop constraint if exists message_templates_organization_id_trigger_event_channel_key;

create unique index if not exists message_templates_org_trigger_channel_language_key
  on public.message_templates (organization_id, trigger_event, channel, language);

-- The Spanish bodies are deliberately NOT seeded here.
--
-- `automatic-messages.ts` reads a template with `.maybeSingle()` filtered by
-- (organization, trigger, channel). A second row under that filter makes the
-- lookup ambiguous and the send fails — so seeding Spanish before the
-- language-aware read is deployed breaks every automatic message in the gap
-- between the migration and the release.
--
-- Learned the hard way: this migration originally carried the seed, and it did
-- exactly that to production for the few minutes it took to notice. The rows
-- live in `20260825161000_spanish_message_templates.sql`, which is applied
-- *after* the release that can read them.
