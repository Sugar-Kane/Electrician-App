# Account, profile, subscription, and Square settings

## What users can manage

- Profile photo, name, job title, email, phone, and timezone
- Email, SMS, and push-notification preferences
- Preferred maps application and starting screen
- Personal display preferences
- Password changes using Supabase Auth
- Volteira Premium checkout and Stripe-hosted billing management
- Square merchant, default location, environment, account email, and currency

Personal settings are stored per authenticated user. Subscription and Square records belong to the organization. Only organization owners and administrators can change organization billing or Square information.

## Database activation

Apply the pending Supabase migrations, including:

```text
20260804144538_user_profiles_preferences_billing_square.sql
```

The migration explicitly grants Data API access, enables row-level security, and restricts each profile to its authenticated user. Organization subscription and Square changes require an owner or administrator membership.

## Stripe Premium activation

Create the recurring Premium product and price in Stripe, then add the price ID to Vercel:

```text
STRIPE_PREMIUM_PRICE_ID=price_...
```

The existing server-only values are also required:

```text
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_APP_URL=https://electrician-app-blue.vercel.app
```

Enable the Stripe Customer Portal and keep the existing webhook endpoint subscribed to:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.expired
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
```

## Square information

The current screen stores Square-issued merchant and location identifiers. It never accepts or stores an access token. A production Square connection should use Square OAuth, retrieve merchant information through the Merchants API, list locations through the Locations API, and store provider tokens only in encrypted server-side storage.

Until OAuth is added, manually entered Square identifiers remain in `pending` status so the application does not claim that the connection has been verified.

## Profile photos

Profile photos are uploaded by a server action to the private `profile-avatars` Supabase Storage bucket. The bucket is created when the first photo is uploaded. Signed URLs expire after one hour and the service credential never reaches the browser.
