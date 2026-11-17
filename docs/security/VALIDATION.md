# Validation evidence — 2026-11-17 UTC

Baseline repository commit: `b0da8e51bc584ed371fd3bd7f2041cab2c63f5c3`.
Runtime: Node v24.22.1. Local PostgreSQL fixture: `postgres:17-alpine`, pulled digest `sha256:a77aa70e641402a21411b92b721c58d10f23b50ae5fdd2333efd22d166e1e5f7`. No production credentials or customer records used.

| Check | Result |
|---|---|
| `npm ci --ignore-scripts` | PASS, existing lockfile retained |
| `npm test` | PASS: runner reports 129 tests, 129 pass, 0 fail/skipped; includes new path, actual attachment-loader and MCP authorization tests |
| `npx tsc --noEmit` | PASS |
| ESLint on all changed TypeScript files | PASS |
| `npm run lint` | FAIL: two errors in unchanged pages, `src/app/estimate/[token]/page.tsx:73` and `src/app/jobs/new/page.tsx:47`, React purity rule for `Date.now()` during rendering |
| `git diff --check` | PASS |
| `bash scripts/security/test-tenant-guards.sh` | PASS on fresh disposable PostgreSQL; baseline cross-tenant FK write reproduced, candidate rejects it; fixtures destroyed by harness |
| `npm run build` | BLOCKED/FAIL: Turbopack internal CSS processing requires port binding; environment returns `Operation not permitted`. Retry with additional permissions gave same result |
| `npm run build -- --webpack` | FAIL: Next reports `Could not parse output from TypeScript's --showConfig`. No successful production build is claimed |
| Authenticated browser E2E | NOT EXECUTED: approved Supabase test environment/configuration unavailable |
| Actual storage bucket/API isolation | NOT EXECUTED |
| All MCP tools via HTTP / ChatGPT | NOT EXECUTED |
| Effective live RLS/catalog inspection | READ-ONLY SNAPSHOT CAPTURED after reconnection; 89 public tables have RLS enabled, policy behavior not fully verified |
| Full Supabase migration replay | NOT EXECUTED; focused standalone fixtures only |
| Background concurrency and webhook replay | NOT EXECUTED |
| Real second-business onboarding | NOT EXECUTED |

The standalone SQL test uses the repository's foundation and contracts migrations, stubbed `auth.uid()` backed by separate request identities, and a minimal documents table. It is a meaningful database policy/constraint test, not an emulator of Supabase Auth, Storage, or the entire final schema.

Sanitized SQL harness success marker:

```text
CONFIRMED baseline: authenticated A can reference B customer
PASS synthetic PostgreSQL RLS, cross-tenant FK, immutable tenant, metadata path, normal write, aggregate and SET NULL checks
```

Additional path variants rejected by database constraints: another tenant prefix, organization-only path, trailing slash, traversal, encoded traversal and empty segments. The synthetic historical cross-reference is deliberately preserved to prove the migration does not reassign/delete ambiguous data. It exists only in the disposable test fixture.

Raw logs in `/tmp/volteira-*.log` contain local build/test output only and are not production evidence. Production log payloads, tokens, customer details and live signed URLs were not exported.
