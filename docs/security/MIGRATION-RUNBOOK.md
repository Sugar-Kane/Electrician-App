# Candidate migration and rollback runbook

This is a development candidate, not authorization to modify production. The user requires explicit approval before production RLS/schema/data changes or deployment. Supabase access is currently blocked. No production backup has been taken by this audit.

## Preflight and backup

1. Verify repository commit, deployment, Supabase project/environment and PostgreSQL version (15+ required). Run the read-only `scripts/security/tenant-catalog.sql` with a restricted operator; keep catalog output restricted, and publish only redacted counts/status. Inspect function bodies privately for membership, scope, search-path and grants. Export actual views, storage policies, queues/cron and exposed-schema configuration separately.
2. Compare migration history to the repository; do not repair history by guessing. Identify the existing business UUID from actual business and membership evidence. Inspect null tenant references, orphans, cross-tenant FKs, polymorphic IDs and file path prefixes. Ambiguous records are flagged for their owner's review, never bulk backfilled.
3. Before applying to production, obtain a provider recovery point/PITR and an encrypted restricted logical backup of all affected tables/schema, grants/policies, auth/membership references and relevant storage metadata/objects. A database dump alone does not back up file bytes or external integrations. Record backup IDs, timestamps, checksums, retention and restore test results without including row contents or credentials in this repository.
4. Restore to an approved restricted environment and prove restoration. Disable outbound integrations there, including cron migrations: the existing history contains scheduled HTTP callbacks and must not be replayed with network access to production.
5. Review generated relationship coverage and index names against the actual catalog. The candidate automatically covers single-column FKs only where both public tables carry organization IDs. Review nullable/shared/platform relations individually. Existing indexes may make some new indexes redundant. Estimate table sizes and lock duration; unique index builds are not concurrent inside this migration. A five-second lock timeout fails rather than waiting indefinitely, but is not a full statement timeout.

## Development verification

- `npm ci --ignore-scripts`
- `npm test`
- `npx tsc --noEmit`
- `npm run lint` (record existing failures separately; do not suppress security checks)
- `bash scripts/security/test-tenant-guards.sh` (Docker required; disposable network-isolated PostgreSQL only)
- Replay the complete actual schema in the approved Supabase test environment and run all 20 tests with two complete synthetic tenants and separate authenticated identities. The standalone harness is a focused fixture, not a substitute.
- Test current file path conventions and metadata. Canonical-path checks reject empty segments, dot/traversal segments, percent encodings, backslashes and control characters. Existing malformed paths must be reviewed; do not rewrite another tenant's paths automatically.
- Test PostgreSQL 15 and/or the actual deployed version, all FK delete actions and existing triggers before production approval. Current test used PostgreSQL 17.

## Apply only after explicit approval

1. Freeze the reviewed artifact/commit, backups, risk register, owner mapping and rollback plan. Obtain user approval for the exact production migration and deployment.
2. Ensure migration execution is transactional with the provider/CLI; verify catalog, migration history and lock timeouts afterward. Do not execute isolated statements against production without migration tracking. If using a provider migration tool, follow repository `AGENTS.md` history naming requirements with the approved file version.
3. `NOT VALID` is deliberate: it protects new writes without modifying old rows. Existing invalid rows remain ambiguous. Flag them, obtain ownership evidence, remediate only with separate authorization, then validate every added constraint. Validating constraints is a separate reviewed operation.
4. Deploy the path checks and MCP shared authorization. Smoke-test existing business and a synthetic tenant without real customer exports, sends, payments or signatures. Verify existing MCP connections, revoke controls and dashboards.
5. Stop onboarding if any HIGH/CRITICAL boundary fails. Record counts and sanitized errors, never tokens, raw queries containing customer values or live signed URLs.

## Rollback

- If migration application fails inside a transaction, roll back that transaction. Confirm no partial schema/index/trigger changes and no migration-history drift.
- The migration does not delete/reassign data or remove original FKs. Capture the exact added constraint/index/trigger manifest before applying. Rollback removes **only** the manifest's new `tenant_fk_*` constraints, `tenant_document_storage_path`, `tenant_inventory_photo_path`, new `guard_tenant_ownership` triggers, unused new `tenant_parent_*` indexes and the new private guard function. Review dependencies before dropping; never use `CASCADE`.
- Revert the application commit if necessary, but recognize that doing so reopens the metadata storage risk. Prefer a forward fix and keep onboarding stopped. Rolling back schema guards likewise reopens the relationship weakness.
- Rollback does not restore rows automatically, repair historical ambiguity, recall signed URLs already delivered, or reverse external sends/charges. Use verified backups/PITR only under a separately approved recovery plan; never restore blindly over new production writes.
- No credentials are rotated, no storage objects are deleted and no production RLS policy is changed by this runbook without a concrete approved action.
