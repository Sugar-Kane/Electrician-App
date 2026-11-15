---
name: multi-tenant-supabase
description: Design or change database tables, Row Level Security, roles, migrations, storage buckets, server actions and API routes for an app where many businesses or organizations share one Supabase/Postgres database. Use whenever you add a table or column, write a policy, add a server action or route handler that reads or writes data, write a migration, handle who may see or change something, or touch sign-in, roles, invites or admin screens. Also use before any "execute_sql" or "apply_migration" call against a real project.
---

# Multi-tenant Supabase

The two failure modes that matter: one business seeing another's data, and a database whose real schema no longer matches the migration files. Everything here prevents one of those.

## Every new table

1. Include `organization_id uuid not null references organizations(id) on delete cascade` (or the tenant key the app already uses; check an existing table first).
2. `alter table ... enable row level security;` in the same migration. A table without RLS is public to anyone with the anon key.
3. Write policies that derive access from membership, not from anything the client sends. Prefer a stable helper, e.g. `(select private.is_org_admin(organization_id))`; wrapping it in `select` lets Postgres cache it per statement.
4. Separate policies per operation (`select`, `insert`, `update`, `delete`) and per role. Default to no access and add what's needed. Never `using (true)` to "get it working".
5. Add an index on `organization_id` plus the usual sort column.
6. Use `check` constraints for enums and lengths, and `unique` constraints for idempotency (e.g. `(organization_id, event_type, event_key)` so a webhook delivered twice is one row).
7. Make idempotent: `create table if not exists`, `drop policy if exists` before `create policy`, so a migration can be replayed.

## Every server action or route handler

1. Resolve the signed-in user and their organization on the **server** (`currentContext()`-style helper). Never accept `organization_id` or `user_id` from the request body as the authority.
2. Check the **role** the action needs (owner/admin/technician), not just that someone is signed in.
3. Use the user-scoped client so RLS applies. Use the service-role client only for work no user can do (webhooks, executors), and then scope every query by organization explicitly.
4. Return a typed result for expected failures; never leak raw provider/database error text to the browser. Log the detail server-side.
5. Anything that spends money (maps, SMS, AI) sits behind a session and, where relevant, a per-business limit.
6. Public endpoints (booking pages, webhooks) use the anon key or a verified signature, validate every field, and cannot reach other tenants' rows.

## Migrations: keep files and production in lockstep

- Name files `YYYYMMDDHHMMSS_short_name.sql`, later than every existing file.
- Never change production schema without a file. `execute_sql` leaves no record.
- If you use Supabase MCP `apply_migration`, it records the apply time as the version. Immediately rewrite that history row to the file's version and name, in the same change that adds the file:
  ```sql
  update supabase_migrations.schema_migrations
  set version = '<file version>', name = '<file name>'
  where version = '<recorded version>';
  ```
- Don't edit a migration that has run. The only exception is making it replayable from an empty database without changing what it does to one that already ran it.
- Check for drift: compare `ls supabase/migrations` with `select version, name from supabase_migrations.schema_migrations order by version`.
- After a schema change, run the Supabase security and performance advisors and fix what they flag for your tables.

(This repo's AGENTS.md has the authoritative version of these rules; follow it if it differs.)

## Tests to add (and not add)

Add a test when you write a rule about who may see or change what, or about keeping one business's data from another's. Prefer extracting the rule into a pure function (see `money-and-trust-code`) and testing that. Don't add tests for layout or wording.
