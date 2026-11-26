-- Signed-in users may read, but never write, a business's subscription or its Stripe
-- connection. Every legitimate write comes from Stripe (webhook, Checkout, Connect
-- onboarding and refresh) through the service role: src/lib/stripe-subscription.ts and
-- src/lib/stripe-connect.ts. Before this, an owner or admin could set their own
-- subscription to 'active' (unlimited AI) or change charges_enabled / stripe_account_id
-- through the Data API (compliance finding SEC-002-010 / SEC-002-012, test TI-011).

drop policy if exists "Organization admins can add subscriptions" on public.organization_subscriptions;
drop policy if exists "Organization admins can update subscriptions" on public.organization_subscriptions;
drop policy if exists "Organization admins can remove subscriptions" on public.organization_subscriptions;

drop policy if exists "Organization admins can add Stripe connections" on public.stripe_connect_accounts;
drop policy if exists "Organization admins can update Stripe connections" on public.stripe_connect_accounts;
drop policy if exists "Organization admins can remove Stripe connections" on public.stripe_connect_accounts;

revoke insert, update, delete, truncate on public.organization_subscriptions from public, anon, authenticated;
revoke insert, update, delete, truncate on public.stripe_connect_accounts from public, anon, authenticated;

do $$
begin
  if to_regclass('public.stripe_webhook_events') is not null then
    execute 'revoke truncate on public.stripe_webhook_events from public, anon, authenticated';
  end if;
end
$$;

-- Reading stays as it was: members see their own business's rows.
grant select on public.organization_subscriptions to authenticated;
grant select on public.stripe_connect_accounts to authenticated;
