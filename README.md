# Electrician App

A field-first business operating system for small electrical contractors. The initial MVP focuses on the owner’s daily command center, paid diagnostic intake, scheduling, technician availability, route-aware dispatch, and the records required to grow into estimates, invoices, inventory, and reporting.

## Current MVP

- Responsive desktop and mobile operations dashboard
- Finger-friendly mobile search, navigation drawer, and bottom navigation
- Tappable dashboard metrics linked to jobs, revenue, invoices, materials, and routes
- Weekly schedule with selectable job cards and detailed field-ready job pages
- Customer contact, property, work scope, access notes, documents, and material requirements
- Material shortage review with Lowe’s live-search handoff and clearly labeled pilot pricing
- Route builder that locks stop order before Google Maps or Apple Maps handoff
- Today’s revenue, jobs, technicians, estimates, and unpaid invoices
- Schedule, route, technician, inventory, and activity summaries
- AI intake and workflow entry points
- Supabase Auth client and Next.js session proxy
- Multi-tenant Postgres foundation with Row Level Security
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
- Lowe’s prices shown inside the pilot are estimates. Each sourcing link opens current Lowe’s search results. Store-level pricing and real-time availability require approved Lowe’s Product Discovery credentials.

## Database

The initial migration is in `supabase/migrations`. It creates organizations, members, customers, properties, technicians, jobs, blackout periods, service settings, estimates, invoices, inventory, and activity history.

Every tenant-owned table has Row Level Security enabled. Frontend access uses the publishable key; secret and service-role keys must never be exposed to the browser.
