---
name: volteira-conventions
description: Project map and conventions for Volteira, the electrician business app in this repo (Next.js 16 App Router, React 19, Tailwind 4, Supabase, Stripe, Twilio, Vercel). Use at the start of any task in this repository, whenever you need to know where something lives (shell, navigation, tokens, money math, consent, migrations, tests) or which existing helper to reuse before writing a new one.
---

# Volteira conventions

Facts specific to this codebase. Verify against the code if something seems off; this file can drift.

## Layout of the repo

- `src/app/<route>/` pages, `actions.ts` server actions beside them, `src/app/api/*` route handlers (stripe, twilio, mcp, operations, intake, admin...).
- `src/components/` shared components; `src/components/ui/` primitives (keyboard focus trap, nav icon, page skeleton).
- `src/lib/` business rules as small files with a sibling `*.test.ts` (invoice-math, sms-consent, booking-hold, ...). Put new rules here, not in components.
- `supabase/migrations/` ~130 timestamped SQL files; follow the migration rules in `multi-tenant-supabase` and AGENTS.md.
- `docs/` feature plans and audits; `e2e/` Playwright navigation checks (desktop 1440x900 and Pixel 7).

## UI frame and design system

- Every signed-in page renders inside `FieldPageShell` (`src/components/field-page-shell.tsx`). `compact` shrinks the header, `bar` replaces it, `fill` gives a `100dvh` frame where a child owns scrolling (conversations), `bottomNav={false}` frees the bottom for a composer.
- Which menu item is active is derived from the URL (`src/lib/navigation.ts`), never passed by pages. Phone chrome is `mobile-app-chrome.tsx` (top bar, bottom bar, More menu); desktop is `app-sidebar.tsx`.
- Theme tokens live in `src/app/globals.css` `@theme`: `canvas/surface/raised/sunken`, `brand` (#ffc21c) + `on-brand`, `ink/ink-muted/ink-faint`, `line`, `positive/caution/critical/info` (+ `-bg`), radii `panel 24 / control 16 / chip 12`. One dark theme. Use these classes, not hex.
- Breakpoints in use: mostly `sm:` and `lg:` with very few `md:`, so check the 768-1023px tablet range explicitly (`responsive-ui`).
- The viewport is deliberately `userScalable: false` with `viewportFit: "cover"` (see `src/app/layout.tsx`); body pads `env(safe-area-inset-left/right)`. Keep inputs at 16px so iOS doesn't zoom.

## Rules to reuse, not rewrite

- Money: `src/lib/invoice-math.ts` (cents, one percent platform fee rounded down, diagnostic credit), refund and receipt helpers beside it.
- Texting: `src/lib/sms-consent.ts` (one consent check for every text; only STOP blocks), `customer-text.ts`, `manual-sms-consent.ts`.
- Auth/tenant context: `src/lib/request-context.ts` (`currentContext()`); session refresh in `src/proxy.ts` (it must live under `src/`).
- Supervised AI actions: approvals queue and executor (`docs/PHASE-2-SUPERVISED-AUTOMATION.md`); AI never sends or spends without approval of the exact content.

## Commands

`npm run dev | build | lint | test`; `npm run test:e2e` for Playwright. Signed out, the app serves a demo workspace, so every route renders without a database.

## Project policy highlights (from AGENTS.md)

- Read the Next.js docs in `node_modules/next/dist/docs/` before framework code.
- Tests only for money, security, tenancy, signatures and consent; everything else is verified in a browser. Never delete or skip a test to merge.
- Migration history must match `supabase/migrations` exactly.
