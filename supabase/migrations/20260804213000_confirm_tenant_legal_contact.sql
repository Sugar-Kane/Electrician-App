-- Do not publish a tenant's legal pages until a human has checked what is on
-- them.
--
-- create_tenant_legal_page seeded the row from onboarding data and published it
-- immediately, which put the owner's login email on a page carriers read as the
-- business's public support address. For a sole trader signing up with a
-- personal address that is the wrong thing to publish, and nothing in the
-- product ever asked them.
--
-- The row is still seeded at signup, so the details are prefilled rather than
-- typed from scratch, but it starts unpublished and the owner publishes it from
-- Settings once the support contact is right. Tenants published before this
-- migration are left alone: their pages are live and a carrier may already be
-- reviewing them.

create or replace function public.create_tenant_legal_page()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  defaults record;
begin
  select * into defaults from private.tenant_legal_page_defaults(new.id);

  if defaults.slug is null then
    return new;
  end if;

  insert into public.tenant_legal_pages (
    organization_id, slug, legal_business_name, support_phone, support_email,
    mailing_address, program_name, published
  ) values (
    new.id, defaults.slug, defaults.legal_business_name, defaults.support_phone,
    -- Prefilled from the owner's login address, which is a starting point and
    -- not necessarily the business's public support address. Unpublished until
    -- confirmed, so an unreviewed address never reaches a carrier.
    defaults.support_email, defaults.mailing_address, defaults.program_name, false
  )
  on conflict (organization_id) do nothing;

  return new;
end;
$$;

revoke all on function public.create_tenant_legal_page() from public, anon, authenticated;

-- Captured in 20260803173933_messaging_foundation.sql as it stands in the
-- deployed database: anon holds select, insert, and update on public.messages.
-- No anon policy exists there, so RLS denies every row and the grant is
-- unreachable today — but it is one accidental `disable row level security`
-- away from exposing every customer's message history, and nothing anonymous
-- has any business reading or writing messages.
revoke select, insert, update on table public.messages from anon;
