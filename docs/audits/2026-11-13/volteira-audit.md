# Volteira repository-wide code quality and dead-code audit

Date: November 13, 2026 (America/Chicago)

Repository: [Sugar-Kane/Electrician-App](https://github.com/Sugar-Kane/Electrician-App). Baseline: `fba4db3816c0e63a5a1da679c2df9c9a06d0e6b5`, cloned from current `main`. Local branch: `audit/dead-code-cleanup`. Cleanup commit: `b37bfbaf6af31664a20a6fa37ce4ca403cb4ff11`.

## 1. Executive summary

The codebase has strong unit-test coverage and passes TypeScript and production compilation, but its local browser-test setup does not currently reach readiness without Supabase configuration. The safe cleanup removes **166 physical source lines**, two orphaned modules, and two unreferenced display helpers. No dependency could be confirmed unnecessary. No known regression was introduced in the checks that could run; real business transactions and authenticated browser workflows remain unverified.

The audit covered the full tracked repository through file inventory, manifests/configuration review, framework-aware unused-code analysis, TypeScript binding/reference analysis, duplicate-code scanning, dependency auditing, builds, linting, and the complete available unit suite. Manual review concentrated on candidates and critical integration boundaries, not a claim of line-by-line verification of all 126,616 source lines. External consumers cannot be ruled out by static analysis; uncertain candidates were retained.

Primary follow-ups are restoring reproducible browser tests, resolving one existing lint failure, reviewing unused export surfaces and older UI/AI implementations, and reducing concentrated workflow complexity. No critical production vulnerability was established by this audit. This was not a penetration test or a production-data audit.

### Architecture and discovery

- One private npm package; no workspace/monorepo configuration or additional package manifests. npm lockfile retained unchanged. Node v24.16.0 / npm 11.13.0 used locally.
- Next.js **16.4.6**, React **19.2.4**, strict TypeScript, App Router, Turbopack, Tailwind 4/PostCSS, ESLint 9/Next rules. Installed Next documentation and repository `AGENTS.md` were read before edits.
- Baseline inventory: 868 tracked files, 703 source files, **75 page files, 29 route handlers, 49 `use server` modules, 102 explicitly marked client modules, 120 unit-test files and 120 SQL migrations**. Source-file counting is defined below.
- Entrypoints include `src/app/layout.tsx`, page/layout/loading/error conventions, metadata routes, `src/proxy.ts`, route handlers, server actions, CLI scripts, Playwright configuration, and Supabase SQL/templates. All literal dynamic imports were included in the reference review; examples include invoice/contract PDF generation, workflow notifications and the PDF.js worker.
- Authentication uses browser/server/public/admin Supabase clients and a session proxy. `src/lib/request-context.ts` caches identity/context per request; membership and role checks appear throughout server operations. These security boundaries were retained.
- Business functionality spans customers; diagnostic-to-work-order transitions; estimates/contracts; job lines/material lists/stock; visits and progress; invoices/refunds/payments; scheduling/dispatch; messages; documents; and admin/support tooling.
- Integrations: Supabase Auth/Postgres/Storage, Stripe Connect/checkouts/webhooks, Twilio SMS/voice/recordings/callbacks, Anthropic and xAI, tokenized MCP tools, Google Maps/Calendar/Drive, Vercel Blob/domain management, email delivery, and supplier search/cart handoffs. Square account configuration remains in the repository and is protected despite an unconsumed action candidate.
- Operational entrypoints `scripts/mint-mcp-url.mjs` and `scripts/xai-voice-worker.mjs` are executable scripts, not unused application modules. No Vercel cron is declared in `vercel.json`. SQL history includes task-worker setup and a later stop-worker migration; neither history nor associated contracts were removed. Live scheduler state was not queried.
- Vercel connector discovery found `electrician-app`, Node 24.x, with latest deployment metadata reporting `READY`. This does not validate current production workflows. Supabase project listing returned `project-volterra`; its binding to this checkout was not independently established from secret configuration. No tables, rows, logs, keys, production schema, or environment secrets were accessed or changed.

## 2. Quantified results

| Metric | Before | After | Change |
|---|---:|---:|---:|
| Total source files | 703 | 701 | −2 |
| Source lines, physical | 126,616 | 126,450 | −166 |
| Confirmed unused files in cleanup set | 2 | 0 | −2 |
| Raw Knip file candidates | 5 | 3 | −2; remaining are protected entrypoints |
| Unused runtime export candidates, Knip | 107 | 105 | −2 |
| Unused type export candidates, Knip | 63 | 63 | 0 |
| Confirmed unused dependencies | 0 | 0 | 0 |
| Raw dependency candidates | 1 | 1 | Google Maps ambient-type false positive |
| Duplicate code | 37 clone pairs / 784 lines | 37 / 784 | 0 |
| Lint errors / warnings | 1 / 0 | 1 / 0 | Unchanged |
| TypeScript errors | 0 | 0 | 0 |
| Build status | Pass | Pass | Unchanged |
| Unit tests | 1,368 pass; 0 fail | 1,368 pass; 0 fail | Unchanged |
| Browser tests | Readiness timeout; 0 executed | Same; 0 executed | Unchanged limitation |
| Built app-path manifest keys | 110 | 110 | Identical key set |
| Build/bundle performance improvement | Not measured | Not measured | No claim |

Methodology: source files are tracked `.ts`, `.tsx`, `.js`, `.mjs`, and `.css` files across source, scripts, tests and config; physical lines include comments/blanks and exclude SQL, binary assets, documentation, lockfiles, generated output and dependencies. Metrics precede addition of audit documentation. Knip 6.45.1 defaults discover Next entrypoints; exported-but-locally-used helpers are included in its export counts and are not necessarily dead implementations. Orphan module exports are not separately counted by Knip. jscpd 5.4.3 used `--min-lines 10 --min-tokens 100 --ignore '**/fonts/**'` on `src`; it processed 642 files before and 640 after, finding 0.6266% and 0.6274% duplicated lines respectively. The slight percentage increase reflects a smaller denominator, not new clones. Clone-line counts are scanner totals, not a measure of independently removable lines.

## 3. Dead code inventory

See [the complete candidate inventory](dead-code-inventory.md) for **all 176 baseline scanner candidates**, confidence, baseline locations, evidence and disposition. Supporting binding and text-reference evidence is included in the evidence archive.

| Removed item | Baseline location | Evidence |
|---|---|---|
| `Card`, `CardHeader`, `DataRow` and private styles | `src/components/ui/card.tsx:1–78` | Orphan in Knip; no imports or registration. Actual admin `Card` consumers import a distinct `src/components/admin-ui.tsx`. |
| Product-selection types, labels and three helpers | `src/lib/material-sourcing.ts:1–56` | Orphan in Knip; no path or symbol consumers outside the file. Not a route, action, published package entry or registered adapter. Active material/stock workflows use other modules and remain. |
| `stateTone` | `src/lib/job-workflow.ts:185` | Knip plus exact repository search found only declaration; pure presentation mapping with no side effects. Workflow transitions and state labels remain. |
| `currentTimeIn` | `src/lib/timezones.ts:32` | Knip plus exact repository search found only declaration; isolated formatter. Timezone options, validation and labels remain. |

Key retained candidates include `askAboutBusiness` (`src/lib/claude.ts:106`), `JobProgress` (`src/components/job-progress.tsx:148`), old material-list pricing/prompt helpers, and `updateSquareAccount` (`src/app/account/actions.ts:294`). These merit focused review, not automatic deletion of AI, workflow or payment-related functionality.

Many candidates are simply unnecessary export visibility. For example, `getJobVisits` is used by `getJobVisitsByNumber` in the same module, and `useDictationAvailable` is called by `DictateButton`. Re-exports such as `hasCoordinates` and `describeDelivery` also point to live underlying implementations. Generated database types were retained.

Additional searches covered unused locals/parameters, dynamic imports, runtime registration patterns, public assets, commented/debug/workaround markers, and lint diagnostics. No other confirmed unreachable/local dead code was removed. Comments explaining operational behavior were treated as documentation. Static scans cannot exhaustively prove runtime reachability or safe CSS deletion.

## 4. Dependencies report

See [the full dependency assessment](dependencies.md) for all 21 declared packages and evidence.

- No package or lockfile change was justified. `@types/google.maps` is consumed through ambient `google.maps` types in `job-map.tsx`, even without an import.
- PDF generation and PDF preview libraries serve different functions; neither was treated as redundant.
- Knip reports 92 unlisted `server-only` import occurrences. Next handles this boundary marker and both builds succeed. Guards remain intact.
- `npm audit` reports seven moderate dependency entries associated with one minimatch advisory in the development tooling; no high/critical findings. This is separate from dead-code detection. No automatic upgrades or audit fixes were performed.
- Outdated-version survey and per-dependency bundle-cost attribution: **not measured**.

## 5. Code quality findings

| Severity | Finding and evidence | Impact / disposition |
|---|---|---|
| High — validation gap | Browser harness waits on `/`; clean local startup returns HTTP 500 with “Supabase server environment variables are not configured.” Both Playwright runs time out at 120 seconds before executing tests. `playwright.config.ts:4–12` promises a no-database demo; `request-context.ts:52` calls configured server client. | Cannot substantiate end-to-end workflow regression safety. Establish a local/test-only fixture backend or repair documented demo prerequisites in a separate change. No production credentials substituted. |
| Medium | Existing `react-hooks/purity` lint error at `src/app/jobs/new/page.tsx:47` (`Date.now()` while computing the repair-now window). Same exact diagnostic before/after. | Lint is not a clean gate. Review request-time calculation in the installed Next/React model; preserve quarter-hour rounding and business scheduling behavior. No suppression added. |
| Medium | Supabase type escape layer: `src/lib/supabase/flexible.ts:3–38` and `src/lib/supabase/admin.ts:5–32` use open-ended table/function records; many data modules cast results. | Compiler success cannot establish database-column/RPC compatibility. Regenerate and adopt concrete types incrementally in a dedicated schema-validated effort. No schema drift was asserted without inspection. |
| Medium | Large orchestration modules: `job-data.ts` 1,772 lines; job page 1,517; `mcp-business-tools.ts` 1,242; `job-workflow.tsx` 1,100; `claude.ts` 1,062. | Concentrated responsibilities make changes harder to review. Split by cohesive reads/operations only with workflow fixtures; no architectural rewrite here. |
| Medium | Seven moderate development dependency entries from `npm audit`; details in dependency report. | Schedule compatible remediation separately; no dependency upgrades in cleanup. |
| Low | 37 duplicate-code clone pairs / 784 scanner lines. Examples: Twilio callback signature/URL setup; tenant-host versus slug journal rendering; customer/stock picker setup; repeated contract generation and email escaping. | Review shared primitives where behavior truly matches. Keep endpoint-specific auth, signing and response behavior. No consolidation was necessary for safe dead-code removal. |
| Low | 170 runtime/type export candidates at baseline, most retained; some are used locally or are re-export surfaces. | Reduce module surface area in focused follow-up batches. Do not delete locally used functions merely to clear scanner output. |
| Low | Five unreferenced starter public SVG paths; stale demo assumptions in e2e documentation; no tracked GitHub Actions workflow found. | Verify external asset consumption and CI ownership. Add appropriate automated gates after repairing baseline failures; do not assume absent workflow files means no external CI. |

React review: 102 explicit client modules include interactive forms, maps, dictation, chat and document previews. Existing lint checks covered hooks/purity concerns; no new hooks/state rewrite was warranted by the dead-code evidence. No profiler or authenticated render-performance measurement was performed. Next configuration (stale times, server-action upload limit, headers and preview behavior), metadata routes and server/client guards were preserved. Repeated validation/authentication is not automatically redundant.

## 6. Completed cleanup

- Deleted two files: `src/components/ui/card.tsx`, `src/lib/material-sourcing.ts`.
- Modified two files: `src/lib/job-workflow.ts`, `src/lib/timezones.ts`.
- Removed eight function/component declarations, one exported label constant and two exported types across these changes; nine runtime exports in total. Knip’s count drops by only two because it reports orphan files separately.
- Source diff: **0 insertions, 166 deletions**. No dependencies removed, duplicate implementations consolidated, tests weakened or rules disabled.
- Cleanup is committed locally as `b37bfba`; audit documentation is a separate cohesive commit. Review patch supplied separately. Nothing was pushed, merged or deployed; pushing a connected branch could trigger a Vercel preview.
- No bundle-size, startup-speed or production-performance improvement is claimed. Unreferenced code may already have been excluded from application bundles.

## 7. Protected and uncertain code

Retained all routes/actions, webhooks, authentication/authorization, payment/refund logic, public tokens/contracts, AI tool registries, scripts, migration history, database schema/types, email templates, audit/security functionality and retention behavior. SHA-256 comparison verified **204 route/action/Supabase files unchanged**. Broader diff review confirms only the four listed source files changed.

The production app-path manifest has the same 110 keys. This supports unchanged route inventory, not a claim that every externally observable behavior was tested. All 29 route-handler files and 49 server-action modules are byte-for-byte unchanged; removed exports were private application helpers with no consumers, not public endpoints.

Specific higher-risk items requiring explicit approval before removal/redesign: the Square account server action/payment integration; any webhook/API/MCP contract; schema or migration changes, including historic task-worker migrations; auth/role redesign; billing rules; diagnostic-to-work-order/invoice rules; and major orchestration refactoring. Other probable source-only candidates require additional consumer evidence, not necessarily a permission request.

## 8. Testing and validation

Commands ran in the isolated repository checkout with no `.env` files or production credentials loaded. Logs are in the evidence archive.

| Exact command | Baseline | Final |
|---|---|---|
| `npm ci` | Pass, exact lockfile installation; audit warnings | Not repeated; dependencies unchanged |
| `npm test` | Exit 0: 1,368 pass, 0 fail, 0 skipped | Same |
| `npm run lint -- --format json --output-file ../baseline-lint.json` | Exit 1: one purity error, zero warnings | Same command using `../final-lint.json`; identical error |
| `npm run build` | Exit 0 | Exit 0 |
| `npm exec -- tsc --noEmit --pretty false` | Exit 0, no diagnostics | Exit 0, no diagnostics |
| `npm exec -- tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false` | Exit 0, no diagnostics | Baseline supplemental analysis only |
| `npm run test:e2e -- --workers=2 --reporter=json` | Exit 1, 120s readiness timeout, 0 executed | Same |
| `npm exec --yes --package=knip -- knip --reporter json` | Resolved Knip 6.45.1; exit 1 because candidates exist | Pinned `--package=knip@6.45.1`; exit 1; two fewer file and two fewer export candidates |
| `npm exec --yes --package=jscpd -- jscpd src --min-lines 10 --min-tokens 100 --ignore '**/fonts/**' --reporters json --output ../duplicates-source` | Resolved 5.4.3; exit 0 | Pinned `--package=jscpd@5.4.3`, output `../final-duplicates`; exit 0 |
| `npm audit --json` | Exit 1: 7 moderate entries | Not repeated; lockfile unchanged |
| `git diff --check` | Clean before edits | Pass; transient trailing blank line corrected |

An initial duplicate scan without the font exclusion found a license-text clone (38 pairs / 870 lines); it was superseded by the identical source-focused configuration used for before/after comparison. Temporary npm-exec analysis tools were not added to package manifests. A supplemental TypeScript compiler-API script linked scanner symbols to identifier references; exact text-reference searches independently checked file/symbol names. Report-generation scripts and evidence are included for review.

### Workflow verification limits

Existing unit tests for job flow, diagnostic outcomes, job billing, follow-up jobs, material lists, stock reservations, invoice math/payment/refunds, contracts/signatures, booking tools, SMS consent, MCP protocol/tokens, permissions and navigation passed unchanged. These verify the covered pure rules and fixtures, not live operations.

Not executed: authenticated customer/job CRUD, diagnostic-to-work-order transactions, purchasing, actual signing/approvals, Stripe payment/refund transactions, real dispatch/maps, notifications, live AI tools, third-party callbacks, database/RLS SQL test scripts, or migration replay against a disposable backend. Browser tests never reached execution. Production rows and runtime logs were intentionally not queried. No secret/config files were copied into the deliverables; source changes contain deletions only, and environment settings were untouched.

## 9. Prioritized follow-up improvements

| Priority | Work | Estimated effort | Risk |
|---|---|---|---|
| 1 | Restore deterministic local/test-only backend or no-backend demo; make full Playwright suite runnable | 1–3 days | Medium; auth/demo boundary needs care |
| 2 | Resolve repair-now purity diagnostic while preserving scheduling behavior | 0.5–1 day | Low–medium |
| 3 | Review and remediate minimatch/tooling advisory with compatible lockfile changes | 0.5–1 day | Low–medium; separate upgrade scope |
| 4 | Add a reviewed Knip configuration for operational scripts, metadata routes, ambient types and server-only markers | 0.5–1 day | Low; explain exceptions instead of hiding findings |
| 5 | Narrow confirmed local-only exports; review standalone formatters, pilot helpers and obsolete `JobProgress` composition | 1–2 days | Low–medium; check shared children and current callers |
| 6 | Owner review of older AI/material pricing/prompt paths and Square configuration | 1–3 days investigation | Medium–high; integration/contract removal needs approval |
| 7 | Adopt generated Supabase table/RPC types incrementally with disposable schema validation | 3–5 days initial slice | Medium–high; do not change production schema for typing |
| 8 | Split job-data/page/AI orchestration into cohesive operations; consolidate verified duplicate journal/picker/email logic | 1–2 weeks in slices | Medium–high; workflow regression fixtures first |
| 9 | Add CI gates for the repaired lint/type/unit/build/browser baseline | 0.5–1 day after prerequisites | Low; confirm existing external CI ownership |

Estimates are planning ranges, not measured delivery commitments. No proposed higher-risk change was implemented as part of cleanup.
