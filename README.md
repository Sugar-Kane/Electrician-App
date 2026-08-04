# Electrician App

A field-first business operating system for small electrical contractors. The initial MVP focuses on the owner’s daily command center, paid diagnostic intake, scheduling, technician availability, route-aware dispatch, and the records required to grow into estimates, invoices, inventory, and reporting.

## Current MVP

- Responsive desktop and mobile operations dashboard
- Finger-friendly mobile search, navigation drawer, and bottom navigation
- Tappable dashboard metrics linked to jobs, revenue, invoices, materials, and routes
- Weekly schedule with selectable job cards and detailed field-ready job pages
- Customer contact, property, work scope, access notes, documents, and material requirements
- Material shortage review with Lowe’s and Home Depot live-search handoffs and clearly labeled pilot pricing
- User-confirmed retailer products with saved links, quantities, prices, availability, store details, and verification timestamps
- Offline-safe product confirmations that persist on the device and sync to the signed-in business through Supabase
- Supplier integration status for Lowe’s Product Discovery and Home Depot’s affiliate catalog feed
- Selectable Lowe’s or Home Depot supply stops, including the exact store confirmed with a saved product, before route optimization
- Route builder that locks stop order before Google Maps or Apple Maps handoff
- Today’s revenue, jobs, technicians, estimates, and unpaid invoices
- Schedule, route, technician, inventory, and activity summaries
- AI intake and workflow entry points
- Supabase Auth client and Next.js session proxy
- Multi-tenant Postgres foundation with Row Level Security
- Mobile-first owner onboarding that atomically creates the business, owner membership, technician profile, service settings, and activity record
- Authenticated onboarding guard so new owners complete setup before entering the real dashboard
- Pilot service settings for diagnostic, emergency, after-hours, cancellation, travel, and scheduling rules

## Stack

- Next.js 16 App Router and React 19
- TypeScript and Tailwind CSS 4
- Supabase Auth and Postgres
- Vercel deployment

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and add the Supabase project URL and publishable key:

   ```text
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

When no authenticated business is available, the dashboard intentionally displays realistic pilot data. Once a signed-in user belongs to an organization, the same dashboard reads the permitted organization records from Supabase.

## Pilot integration notes

- Google Maps receives the full ordered route through a standard Maps URL.
- Apple Maps opens the next stop because Apple Map Links do not support a full multi-stop waypoint list.
- Retailer prices shown inside the pilot are estimates. Each sourcing link opens current retailer search results.
- Lowe’s store-level pricing and real-time availability require approved Product Discovery credentials.
- Home Depot’s public partner route is its Impact affiliate program, which provides a daily product data feed. It is not advertised as a real-time local inventory API, so local stock remains a live retailer-page handoff unless Home Depot grants separate partner access.

## Supplier onboarding

Open `/settings/integrations` to see approval and configuration status.

1. Apply for Lowe’s Product Discovery through the Lowe’s Developer Hub.
2. Apply for The Home Depot Affiliate Program and request its daily product feed through Impact.
3. Add the approved values to Vercel as server-only environment variables using the names in `.env.example`.
4. Redeploy after adding credentials. Never prefix supplier secrets with `NEXT_PUBLIC_`.

## Database

The initial migration is in `supabase/migrations`. It creates organizations, members, customers, properties, technicians, jobs, blackout periods, service settings, estimates, invoices, inventory, and activity history.

Every tenant-owned table has Row Level Security enabled. Frontend access uses the publishable key; secret and service-role keys must never be exposed to the browser.
