# Live database inspection — 2026-11-17

Supabase reconnection succeeded. This supersedes the connector-access blocker in the initial readiness report. **Readiness remains NOT READY.** Only read-only discovery was performed; no production writes, policy edits, test identities, credentials, migrations or deployment changes were made.

Project `project-volterra` (`wyyzptlciccewyxxjkyx`) has the application schema and an exact Pacific Plains Electric organization-name match. The existing tenant UUID was resolved from that record, not invented; customer records were not retrieved. The separately connected Pacific Plains account contains a different project and was not used for Volteira schema changes.

## Confirmed live metadata

- 89 public tables; all have RLS enabled. Policy correctness and authenticated isolation still require verification.
- 209 policies across inspected public/private/storage schemas; 184 functions; 257 public foreign keys; 80 non-internal public triggers. No public/private views or materialized views found.
- `business-documents` is private; `public-branding` is public. Storage object policies authorize membership/admin access using the first object-path segment.
- 130 applied migrations, latest `20261115010000`. Version/name comparison matches every historical repository migration. The only local-only migration is the new candidate `20261117044948_tenant_relationship_and_storage_guards`.
- No existing development branches are listed. This is not authorization to create a billable branch or test on production.

## Findings corroborated by live inspection

The jobs table has single-column customer/property/technician foreign keys. Its policies authorize the child organization but do not check those parent tenants. The inspected triggers cover follow-up ownership, defaults and document folders, without a general customer/property/technician tenant guard. Thus the relationship control gap reproduced locally is also present in the inspected live schema; no production exploit was attempted.

Document policies permit tenant members to update tenant-owned metadata. Live document checks constrain path length but do not bind its prefix to the document organization. Inventory has no inspected tenant photo-prefix constraint. This corroborates the need for the local privileged-storage defenses and candidate metadata constraints; actual cross-tenant storage access was not attempted.

Read-only integrity counts found zero job/customer, job/property and job/technician tenant mismatches, and zero document or inventory-photo prefix mismatches. These narrow aggregate checks reveal no current violations in those categories; they do not demonstrate that unauthorized future writes are prevented. No customer values or object paths were returned.

## Advisor triage

The security advisor flags 22 anonymously executable SECURITY DEFINER functions and 92 authenticated-executable SECURITY DEFINER functions. These are review leads, not 114 confirmed vulnerabilities. Focused inspection found that `accept_organization_invitation` checks signed-in identity, matching confirmed email, expiration and revocation; `organization_roster` gates results through `private.can_manage_members`; `pending_invitation_for_me` binds lookup to `auth.uid()`.

Four server-oriented tables have RLS with no policies: Calendar connection/events, organization AI keys and task work. This may intentionally deny ordinary access; inspect grants/service paths before changing it. Leaked-password protection is reported disabled and warrants Auth configuration review.

Advisor references: [public SECURITY DEFINER execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated SECURITY DEFINER execution](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Remaining boundary

The catalog snapshot is in `live-catalog.json` and contains schema metadata, not customer rows or credentials. An approved test target with separate authenticated synthetic users is still needed for complete HTTP, Storage, background-worker and all-tool MCP testing. Existing local fixtures remain usable. No production approval is requested for the still-incomplete candidate.
