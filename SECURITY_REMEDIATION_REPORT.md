# Volteira security remediation report

## Assessment metadata

| | |
|---|---|
| Date | 2026-11-10 |
| Original branch | `claude/field-service-electrician-redesign-urrnhb` (clean working tree) |
| Baseline commit | `fc8e1df2164d8c8e960fc80b5d08aa2b274515d8` (= `main`, PR #211) |
| Security branch | `security/autonomous-remediation` (local) |
| Stack | Next.js 16 App Router (server actions, `src/proxy.ts`), TypeScript, React 19, Supabase (Postgres + RLS, Auth, Storage, Vault, pg_cron, Edge Functions), Stripe Connect (direct charges + application fee), Twilio, Resend, xAI voice, Google OAuth (Drive/Calendar), Vercel, MCP server for ChatGPT/Claude at `/api/mcp/[token]` |
| Tools | `npm audit`; Semgrep 1.x with a local ruleset (the registry at semgrep.dev is blocked by this environment's network); detect-secrets over tracked files; regex secret scan over full git history; Supabase security advisor (live, read-only); read-only SQL against production catalogs (`pg_proc`, `pg_policies`, grants, triggers); disposable local PostgreSQL 16 for migration testing; `tsc`, ESLint, `node --test`, `next build` |
| Not available | CodeQL, Trivy, OSV-Scanner, Gitleaks binaries (no network route to their downloads); Semgrep registry rules |

### Areas inspected
- Every route handler under `src/app/**/route.ts` (31) for authentication and authorization.
- Proxy/session refresh, auth callback and the `next` redirect helper.
- Supabase: all SECURITY DEFINER functions executable by `anon`/`authenticated` (109 flagged by the advisor), every RLS policy on `public` and `storage`, storage bucket visibility, triggers on financial and membership tables, effective grants.
- Stripe: Connect webhook handler, invoice checkout creation and webhook handling, booking deposit confirmation, application-fee calculation.
- MCP: session-token signing/verification, bearer check, business-credential lifecycle, tenant scoping of every tool query in `src/lib/mcp-*.ts`, `booking-tools.ts`, paid-in-hand and close-out code.
- Service-role (`getSupabaseAdmin`) use in `src/app` and `src/lib`; org IDs taken from requests.
- Frontend: `dangerouslySetInnerHTML`, eval-like code, redirects, security headers.
- Secrets in the tree and in git history; dependencies.

### Areas not inspected, or only sampled
- The roughly 200 server actions were sampled, not read one by one. Those using the user-session client rely on RLS, which was reviewed in full.
- Edge Functions deployed in Supabase (`send-message`, `sms-webhook`, `twilio-*`, `soleprop-onboard`, `a2p-status`, `move-number`) are not in this repository.
- Supabase Auth dashboard settings (MFA, rate limits, leaked-password protection) beyond what the advisor reports.
- Dynamic testing against a running deployment (no requests were sent to production).

## Vulnerability register

| ID | Title | Severity | Confidence | Where | Status |
|---|---|---|---|---|---|
| V-01 | Anonymous callers can create customers in any business | High | Confirmed (live grants + function body) | `find_or_create_customer_by_phone`; intended revoke in `supabase/migrations/20260826210000_booking_idempotency.sql:139` | Fixed in migration (needs applying) |
| V-02 | Org admin can promote self to owner, remove or demote the owner, add or invite owners | High | Confirmed (RLS `can_manage_members` allows owner **or admin** to write any member row; no role guard) | `organization_members`, `organization_invitations` policies | Fixed in migration (needs applying) |
| V-03 | Customer can mark their own booking deposit paid without paying | Medium | Confirmed (anon-executable; inputs are the customer's own token and checkout id; unused by app) | `mark_phone_deposit_paid` (`20260810000000_phone_intake_and_deposit.sql:154`) | Fixed in migration (needs applying) |
| V-04 | ChatGPT/Claude business connection survives removal or demotion of the owner who made it | Medium | Confirmed (route checked revocation/expiry only) | `src/app/api/mcp/[token]/route.ts` | Fixed |
| V-05 | Vulnerable dependencies: 1 critical (Next.js), 8 high (sharp, zod, undici, nanoid, source-map-js, @vercel/blob chain) | Critical (advisory) / exploitability varies | Confirmed by `npm audit` | `package.json` | Fixed |
| V-06 | `MCP_BEARER_TOKEN` compared with `===` | Low | Confirmed | `src/lib/mcp-session.ts` | Fixed |
| V-07 | Missing `Referrer-Policy`, `X-Content-Type-Options`, HSTS headers | Low | Confirmed | `next.config.ts` | Fixed |
| V-08 | PostgREST `or()` filter built from search text without removing `( ) " \` | Low (confined to own business by RLS and an org filter) | Confirmed | `src/app/search/actions.ts:71` | Fixed |
| V-09 | No script-src Content Security Policy (only `frame-ancestors`) | Low / hardening | Confirmed | `next.config.ts` | Fixed: nonce + `'strict-dynamic'` policy from `src/proxy.ts` |
| V-10 | Every member role (including technician) can edit and delete invoices and payments through the API | Medium (insider) | Confirmed; matches the app, which offers these to every member | RLS on `invoices`, `payments` | Fixed: owner toggle, on by default (migration `20261111020000`) |
| V-14 | An org admin could set `organizations.created_by` to themselves, and the owner guards trust the creator | High | Confirmed (admins may update `organizations`; no column guard) | `organizations` UPDATE policy | Fixed in migration `20261111020000` |
| V-15 | The "Owners can delete organizations" policy compares `membership.organization_id = membership.id`, so it never matches | Informational (fails closed) | Confirmed | `organizations` DELETE policy | Open: owners cannot delete their business through the API; platform deletion still works |
| V-11 | Supabase Auth leaked-password protection is off | Low | Advisor | Supabase dashboard | Open: dashboard toggle |
| V-12 | `/settings/payments/start` acts on GET (cross-site link could start Stripe onboarding for a signed-in owner) | Informational | Confirmed; Stripe's `refresh_url` requires GET; outcome is a redirect to Stripe's own page | `src/app/settings/payments/start/route.ts` | Accepted |
| V-13 | 8 moderate advisories in dev-only lint tooling (`typescript-eslint` → `minimatch`) | Low | `npm audit` | devDependencies | Open: waits on upstream |

### Evidence notes
- **V-01:** `has_function_privilege('anon', …)` is true in production. The body skips its membership check when `auth.uid()` is null, which is exactly the anonymous case. Callers in the app are the signed-in job form and service-role code, so `anon` needs nothing.
- **V-02:** `private.can_manage_members` returns true for role `admin`. The UPDATE and DELETE policies on `organization_members` and the INSERT policy on `organization_invitations` add no role restriction. Owners alone connect Stripe payouts (`settings/payments/start`) and ChatGPT, so this is a path from admin to the business's money.
- **V-04:** All 7 live credentials in production belong to current owners, so the fix cuts off no one.

### Verified as sound (no change needed)
- **Stripe webhook:** verifies the signature against both destination secrets.
- **Invoice payments:** an event is believed only for a checkout session Volteira stored, and only from that business's own connected account. The amount comes from Stripe.
- **Booking deposits:** confirmed only for the stored checkout session, at the exact amount, by a function only the server can run.
- **Twilio and xAI webhooks:** every Twilio route validates the signature; xAI uses HMAC with `timingSafeEqual`.
- **MCP tokens:** session tokens are HMAC-signed and compared with `timingSafeEqual`, and the tenant comes from the token, never from tool arguments. Every MCP tool query is scoped to the session's business; the 14 unfiltered updates found all act on IDs taken from earlier org-filtered lookups. High-impact tools require `confirmed: true` after a proposal.
- **Login redirects:** `getSafeNextPath` keeps redirects same-origin.
- **Storage:** the one bucket is private, and documents are served through token-checked routes.
- **Remaining SECURITY DEFINER functions:** the other public RPCs are token-gated by design (booking, invoice, contract and invitation links). Admin RPCs check `is_platform_admin`/`is_platform_owner`, or run only on an operation the same admin started.
- **Secrets:** none in the tree or in history. The matches are test fixtures and `env(...)` references in `supabase/config.toml`.
- **JSON-LD:** `dangerouslySetInnerHTML` is used only for JSON-LD through `safeJsonLd`, which is tested.

## Remediation changelog

| Commit | Files | Problem → correction | Tests | Behavior change |
|---|---|---|---|---|
| `662ef2e` | `supabase/migrations/20261111010000_security_role_and_rpc_hardening.sql`, `scripts/security/role-guard-stub.sql`, `scripts/security/role-guard-test.sql` | **V-01, V-03:** revoke `anon` (and `authenticated` for the deposit function). **V-02:** `private.can_grant_owner` plus triggers on members and invitations: only an owner, the creator, a platform owner or the service role may add, change, remove or invite an owner. Memberships cannot be moved between businesses. Accepting an owner invitation still works. | 19 checks on a disposable PostgreSQL 16, all passed | Admins can no longer create or alter owners through the API (the app never offered it) |
| `f783d60` | `src/app/api/mcp/[token]/route.ts`, `src/lib/mcp-session.ts`, `src/lib/mcp-session-token.ts`, `src/lib/mcp-session-token.test.ts` | **V-04:** a business connection requires its maker to still be an owner. **V-06:** constant-time bearer compare. | 2 new unit tests; file suite 12/12 | A removed or demoted owner's ChatGPT link stops working at once |
| `e1fc743` | `package.json`, `package-lock.json` | **V-05:** next and eslint-config-next 16.4.6; overrides sharp 0.35.5, zod 4.6.7, undici 6.29.1; `npm audit fix` | 1355/1355 unit tests, lint, `next build` | None observed |
| `6cbf358` | `next.config.ts`, `src/app/search/actions.ts` | **V-07:** security headers. **V-08:** search input. | tsc, lint, build | None (searches containing `()"\` treat those characters as spaces) |

No changes were reverted.

## Testing results

| Check | Result |
|---|---|
| `npm test` | 1355 passed, 0 failed |
| `tsc --noEmit` | passed |
| ESLint (`src`, `next.config.ts`) | passed |
| `next build` (16.4.6) | passed |
| `npm audit --omit=dev` | 0 vulnerabilities (was 1 critical, 8 high) |
| `npm audit` (incl. dev) | 8 moderate, dev-only |
| Migration test on disposable Postgres | 19/19 passed |
| Semgrep (local rules) | 8 results, all reviewed: 2 safe JSON-LD, 1 non-security `Math.random` key, 1 filter (V-08), 4 informational fetches |
| detect-secrets and history scan | no real secrets |

**Needs additional validation:** apply the migration and confirm in the app that inviting a teammate, accepting an invitation and the owner's team page still work. Applying it is a production schema change, so it was not done here. A browser check of pages that load Google Maps and the Stripe redirect is also worth doing after deploy, though the new headers do not restrict scripts.

## Functionality verification
- **Not affected:** jobs, scheduling, invoices, payments, contracts and booking code paths (no source changes). The full unit suite and build pass.
- **ChatGPT/MCP:** unchanged for current connections, all made by owners.
- **Team management:** owner flows unchanged; admins can still invite and manage non-owner roles (tested).
- **Customer creation from the job form and phone intake:** the `authenticated` and `service_role` grants are kept. Only `anon` was removed.

## Follow-up batch (same day)

| Change | Files | Detail | Tests |
|---|---|---|---|
| Owner toggle: technicians and billing (V-10) | `supabase/migrations/20261111020000_technician_billing_toggle.sql`, `src/lib/billing-permission*.ts`, `src/app/invoices/actions.ts`, `src/app/jobs/[jobId]/invoice-actions.ts`, `src/app/settings/team/*` | `organizations.technicians_can_edit_billing` (default on). When off, technicians can see invoices but can't raise, edit, send or delete one, or record or edit a payment. That rule is applied in RLS, in `record_invoice_payment`/`record_invoice_paid_in_hand`, and in the app actions; the app check is the only guard on sending. Only an owner can flip it, on Settings → Team. | 11 disposable-DB checks, 3 unit tests |
| `created_by` cannot be rewritten (V-14) | same migration | Trigger `guard_organization_settings` | covered above |
| Script-blocking CSP (V-09) | `src/lib/csp.ts`, `src/proxy.ts`, `src/lib/supabase/proxy.ts`, `src/app/layout.tsx`, `src/app/welcome/page.tsx`, `src/app/demo/page.tsx` | Per-request nonce plus `'strict-dynamic'`; `object-src 'none'`, `base-uri 'self'`, `worker-src 'self' blob:`. `'unsafe-eval'` and `blob:` are kept for the Google Maps JavaScript API. Previews send it report-only, so Vercel's toolbar loads. Every page is now rendered per request; `/welcome` and `/demo` were static and could not carry a nonce, and they still arrive complete. | 3 unit tests. Headless Chromium against `next start`: 6 public pages hydrate with no violations, and injected inline scripts, external scripts and inline handlers are all blocked. |

## Remaining risks
1. **The migration is not applied yet.** Until it runs in Supabase, V-01, V-02 and V-03 remain exploitable in production.
2. **Not checked in a browser:** the CSP on map pages (`/schedule`, `/route`, a job page) after deploy. Previews report rather than block, so check the console there first.
3. **Still in the policy:** `'unsafe-eval'` is allowed for Maps. Remove it if Maps works without it.
4. **V-11:** leaked-password protection is off.
5. **Not reviewed:** the Supabase Edge Functions that live outside this repository.

## Git change summary
- Original branch: `claude/field-service-electrician-redesign-urrnhb` at `fc8e1df`.
- Security branch: `security/autonomous-remediation`. Commits `662ef2e`, `f783d60`, `e1fc743`, `6cbf358`, plus this report.
- Nothing was pushed, merged, deployed or applied to production.

## Verdict: Conditional Release
The code-level fixes are made and verified. Production stays exposed to V-01 (anyone can create customers in any business), V-02 (admin-to-owner escalation) and V-03 (forged deposit status) until migration `20261111010000_security_role_and_rpc_hardening.sql` is applied. With it applied, and the dependency update deployed, no release-blocking issue remains in the reviewed scope. V-10 needs an explicit product decision or accepted risk.
