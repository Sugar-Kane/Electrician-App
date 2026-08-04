create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 120),
  phone text check (phone is null or char_length(phone) between 7 and 30),
  job_title text check (job_title is null or char_length(job_title) between 2 and 80),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 512),
  timezone text not null default 'America/Los_Angeles'
    check (char_length(timezone) between 3 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  text_size text not null default 'standard'
    check (text_size in ('standard', 'large', 'extra_large')),
  compact_mode boolean not null default false,
  email_notifications boolean not null default true,
  sms_notifications boolean not null default true,
  push_notifications boolean not null default true,
  default_map_app text not null default 'system'
    check (default_map_app in ('system', 'google_maps', 'apple_maps')),
  default_landing_page text not null default 'dashboard'
    check (default_landing_page in ('dashboard', 'schedule', 'jobs', 'route')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, organization_id)
);

create table public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique
    references public.organizations(id) on delete cascade,
  provider text not null default 'stripe' check (provider = 'stripe'),
  plan text not null default 'starter'
    check (plan in ('starter', 'premium', 'growth', 'enterprise')),
  status text not null default 'inactive'
    check (status in (
      'inactive', 'trialing', 'active', 'past_due', 'paused',
      'canceled', 'unpaid', 'incomplete', 'incomplete_expired'
    )),
  seats integer not null default 1 check (seats between 1 and 500),
  stripe_customer_id text unique
    check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text unique
    check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  stripe_price_id text
    check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.square_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique
    references public.organizations(id) on delete cascade,
  status text not null default 'not_connected'
    check (status in ('not_connected', 'pending', 'connected', 'error', 'revoked')),
  environment text not null default 'production'
    check (environment in ('sandbox', 'production')),
  merchant_id text
    check (merchant_id is null or (char_length(merchant_id) between 3 and 128 and merchant_id ~ '^[A-Za-z0-9_-]+$')),
  default_location_id text
    check (default_location_id is null or (char_length(default_location_id) between 3 and 128 and default_location_id ~ '^[A-Za-z0-9_-]+$')),
  business_name text check (business_name is null or char_length(business_name) <= 160),
  account_email text check (account_email is null or char_length(account_email) <= 254),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  connected_by uuid references auth.users(id) on delete set null,
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_preferences_organization_id_idx
  on public.user_preferences(organization_id);
create index organization_subscriptions_status_idx
  on public.organization_subscriptions(status);
create index square_payment_accounts_connected_by_idx
  on public.square_payment_accounts(connected_by);

create trigger set_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

create trigger set_user_preferences_updated_at
before update on public.user_preferences
for each row execute function public.set_updated_at();

create trigger set_organization_subscriptions_updated_at
before update on public.organization_subscriptions
for each row execute function public.set_updated_at();

create trigger set_square_payment_accounts_updated_at
before update on public.square_payment_accounts
for each row execute function public.set_updated_at();

insert into public.user_profiles (user_id, display_name)
select
  auth_user.id,
  left(
    case
      when char_length(
        coalesce(
          nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
          nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
          nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
          ''
        )
      ) >= 2
      then coalesce(
        nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
        nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
        'Account user'
      )
      else 'Account user'
    end,
    120
  )
from auth.users as auth_user
on conflict (user_id) do nothing;

alter table public.user_profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.square_payment_accounts enable row level security;

create policy "Users can view their own profile"
on public.user_profiles for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own profile"
on public.user_profiles for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own profile"
on public.user_profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own profile"
on public.user_profiles for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can view their own organization preferences"
on public.user_preferences for select to authenticated
using (
  (select auth.uid()) = user_id
  and (select private.is_org_member(organization_id))
);

create policy "Users can create their own organization preferences"
on public.user_preferences for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and (select private.is_org_member(organization_id))
);

create policy "Users can update their own organization preferences"
on public.user_preferences for update to authenticated
using (
  (select auth.uid()) = user_id
  and (select private.is_org_member(organization_id))
)
with check (
  (select auth.uid()) = user_id
  and (select private.is_org_member(organization_id))
);

create policy "Users can delete their own organization preferences"
on public.user_preferences for delete to authenticated
using (
  (select auth.uid()) = user_id
  and (select private.is_org_member(organization_id))
);

create policy "Organization members can view subscription status"
on public.organization_subscriptions for select to authenticated
using ((select private.is_org_member(organization_id)));

create policy "Organization admins can add subscriptions"
on public.organization_subscriptions for insert to authenticated
with check ((select private.is_org_admin(organization_id)));

create policy "Organization admins can update subscriptions"
on public.organization_subscriptions for update to authenticated
using ((select private.is_org_admin(organization_id)))
with check ((select private.is_org_admin(organization_id)));

create policy "Organization admins can remove subscriptions"
on public.organization_subscriptions for delete to authenticated
using ((select private.is_org_admin(organization_id)));

create policy "Organization members can view Square connection status"
on public.square_payment_accounts for select to authenticated
using ((select private.is_org_member(organization_id)));

create policy "Organization admins can add Square account details"
on public.square_payment_accounts for insert to authenticated
with check (
  (select private.is_org_admin(organization_id))
  and connected_by = (select auth.uid())
);

create policy "Organization admins can update Square account details"
on public.square_payment_accounts for update to authenticated
using ((select private.is_org_admin(organization_id)))
with check ((select private.is_org_admin(organization_id)));

create policy "Organization admins can remove Square account details"
on public.square_payment_accounts for delete to authenticated
using ((select private.is_org_admin(organization_id)));

revoke all on table public.user_profiles from public, anon;
revoke all on table public.user_preferences from public, anon;
revoke all on table public.organization_subscriptions from public, anon;
revoke all on table public.square_payment_accounts from public, anon;

grant select, insert, update, delete on table public.user_profiles to authenticated;
grant select, insert, update, delete on table public.user_preferences to authenticated;
grant select, insert, update, delete on table public.organization_subscriptions to authenticated;
grant select, insert, update, delete on table public.square_payment_accounts to authenticated;

grant select, insert, update, delete on table public.user_profiles to service_role;
grant select, insert, update, delete on table public.user_preferences to service_role;
grant select, insert, update, delete on table public.organization_subscriptions to service_role;
grant select, insert, update, delete on table public.square_payment_accounts to service_role;
