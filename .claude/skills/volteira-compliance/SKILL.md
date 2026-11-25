---
name: volteira-compliance
description: Run Volteira's regulatory, security and accessibility compliance audit of this application - federal law, California law, California contractor (CSLB) rules, cybersecurity, ADA/WCAG, privacy, customer communications, contracts and e-signatures, invoices, payments, and the AI/MCP tools - against the requirement registers in compliance/registry, and produce evidence-backed GREEN/YELLOW/RED/GRAY/BLUE findings and reports. Use when the user types /volteira-compliance (optionally with quick, federal, california, contractors, security, accessibility, privacy, communications, contracts, invoices, payments, mcp, refresh-laws, compare or release), or asks whether Volteira is compliant, release-ready, or what changed since the last audit.
argument-hint: "[quick|federal|california|contractors|security|accessibility|privacy|communications|contracts|invoices|payments|mcp|refresh-laws|compare|release]"
---

# Volteira compliance

Audits **this application** (the Volteira codebase, its Supabase database rules, its deployment
settings and its customer-facing flows). Public websites are audited separately by
`/website-compliance`. Results are evidence, not legal advice and not a certification.

## Ground rules (always)

- **Read-only.** No change to app code, production data or deployment settings. No real texts,
  emails, contracts, invoices or payments. No destructive or active security testing.
- **Database checks only inside a rolled-back transaction** (`begin; … rollback;`) using
  synthetic tenants, and only through the Supabase MCP `execute_sql`. Show the SQL first. Never
  read real customer rows beyond counts.
- **GREEN needs evidence**: a passing test, a rolled-back database check, a rendered document,
  or observed behaviour. Never GREEN from code existing, a comment, a policy statement, an
  untested setting or an automated scan alone. Unverifiable → BLUE with the reason. Not
  applicable → GRAY with the reason.
- Keep legal requirements separate from recommended security controls in every total.
- Redact secrets and personal information from anything written to `compliance/`.
- Never begin remediation; produce the backlog and wait for approval.

## Files

| What | Where |
|---|---|
| Requirement registers (law, standards) | `compliance/registry/*.json` (never holds statuses) |
| Schemas | `compliance/schemas/*.schema.json` |
| Test → requirement map | `compliance/tests/manifest.json` |
| Unit regression tests | `src/compliance-tests/*.test.ts` (run by `npm test`) |
| Findings for an audit | `compliance/application-audits/<date>/findings/*.json` |
| Reports | `compliance/application-audits/<date>/report.{md,json,html}` |
| History index | `compliance/application-audits/history.json` |
| Backlog | `compliance/remediation-backlog.md` |
| Proposed release gates | `compliance/release-gates.md` |

## Subcommands

Parse `$ARGUMENTS` (first word). Default (no argument) = **full audit**.

| Argument | Scope (registers / requirement prefixes) | What to run |
|---|---|---|
| *(none)* | all registers except `website-*` | everything below, then reports |
| `quick` | requirements with `automated_test_ids` only | `npm test` + `node compliance/scripts/run-compliance-audit.mjs --quick`. Report says manual and legal items were **not** re-verified. |
| `federal` | `federal` | |
| `california` | `california` | |
| `contractors` | `california-contractors` | include synthetic contract PDF render check |
| `security` | `application-security` | incl. rolled-back tenant isolation SQL |
| `accessibility` | `website-accessibility` applied to app pages | Playwright + axe on a local build (`npm run build && npm start`) with synthetic routes |
| `privacy` | CA-001…CA-004, FED-004, SEC-002/005 | |
| `communications` | FED-002, FED-003, CA-006, SEC-007 consent items | |
| `contracts` | FED-001, CA-005, CSLB-002…CSLB-008 | |
| `invoices` | FED-006, CA-010, CSLB-005 | |
| `payments` | FED-007, CSLB-004, Stripe/webhook SEC items | |
| `mcp` | SEC-007, FED-010 | |
| `refresh-laws` | all | `node compliance/scripts/refresh-legal-requirements.mjs`, then re-read each `official_source_url` with WebFetch; never overwrite, write a new baseline and change report |
| `compare` | — | `node compliance/scripts/compare-audits.mjs` (latest vs previous) |
| `release` | P0/P1 gates | `node compliance/scripts/compare-audits.mjs --release` and apply `compliance/release-gates.md`; answer READY / NOT READY with the blocking finding IDs |

## Full audit procedure

1. **Record the run**: date, `git rev-parse HEAD`, branch, latest Vercel deployment id (Vercel MCP
   `list_deployments`), legal baseline version (`baseline_version` in the registers), skill
   version (below). Note which MCPs are connected (Supabase, Vercel, Stripe, GitHub, Playwright)
   and list missing ones as limitations.
2. **Validate the baseline**: `node compliance/scripts/validate-requirements.mjs`. If a register
   is stale (`last_verified` older than 90 days) or unverified, its requirements can be at best
   BLUE until refreshed.
3. **Automated tests**: `npm test` (includes `src/compliance-tests`). Record pass/fail per test ID.
4. **Code review** per area, citing `file:line`. Key places: `src/lib/customer-text.ts`
   (consent gate), `src/lib/sms-consent.ts`, `src/app/api/twilio/*` (STOP), `src/lib/email.ts`,
   `src/lib/contract-*.ts`, `supabase/migrations/*sign_contract*`, `src/lib/payment-plan*.ts`,
   `src/lib/job-prepayment-pay.ts`, `src/app/api/stripe/webhook/route.ts`,
   `src/lib/invoice-*.ts`, `src/lib/mcp-*.ts`, `src/lib/supervised-*.ts`, `src/proxy.ts`,
   `next.config.ts`, `src/lib/public-paths.ts`.
5. **Database (rolled back)**: list RLS status and policies
   (`select relname, relrowsecurity from pg_class …`), SECURITY DEFINER functions without
   `search_path`, and run the two-tenant isolation script in
   `compliance/tests/tenant-isolation/two-tenant-rollback.sql` (it ends in `rollback`).
6. **Rendered documents**: generate a synthetic contract PDF locally from fixtures (no database
   writes, nothing sent) and check required headings and notices in the extracted text.
7. **Write findings** (one per requirement, schema `compliance/schemas/finding.schema.json`).
8. **Report**: `node compliance/scripts/generate-report.mjs application <audit-dir>` → Markdown,
   JSON and HTML with scorecards; totals must reconcile (the script checks).
9. **Compare** with the previous audit and update `history.json` (never overwrite old audits).
10. **Backlog**: update `compliance/remediation-backlog.md` (P0–P3) for RED/YELLOW findings. Do
    not implement.

## Output to the user

Totals (G/Y/R/Gray/B) per scorecard with the three metrics (verified pass rate, verification
coverage, overall verified applicable compliance — N/A when a denominator is zero), critical and
high findings, top fixes, what was not tested and why, missing access, legal-review items, and
the report paths. Never claim legal certification or immunity from lawsuits.

Skill version: 1.0.0 (2026-11-24). Update `.claude/COMMANDS.md` if this file changes.
