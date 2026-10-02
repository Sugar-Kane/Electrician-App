<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Database migrations

Production's migration history (`supabase_migrations.schema_migrations`) lists exactly the files in `supabase/migrations`: the same versions, with the same names. If the two drift apart, `supabase db push` tries to re-run old files against production.

- A migration's version is the timestamp in its file name. Name new files `YYYYMMDDHHMMSS_short_name.sql`, later than every existing one.
- Supabase MCP's `apply_migration` records the time you applied it, not your file's version. Right after applying, give that row the file's version and name, and do it in the same change that adds the file:

  ```sql
  update supabase_migrations.schema_migrations
  set version = '<file version>', name = '<file name>'
  where version = '<version apply_migration recorded>';
  ```

- Never change production's schema without a migration file; `execute_sql` leaves no record.
- Don't edit a migration once it has run. The one exception: making it replayable from an empty database without changing what it does to a database that already ran it. See `20260810000000_phone_intake_and_deposit.sql`.
- To check for drift, compare the file list with `select version, name from supabase_migrations.schema_migrations order by version`.

# Tests

`npm test` runs the unit tests in `src/**/*.test.ts`. Keep every one of them, and run the whole suite before each merge, but don't grow it with every change.

- Add tests only for money and security rules: prices, totals, invoices, deposits, credits and payments; signing in, and what each person may see or change; keeping one business's data from another's; contract signatures; texting consent and opt-outs.
- Everything else (layout, wording, a new page or field, maps, how something loads) is checked by building the app and using the change in a browser, with no new tests.
- When a change breaks an existing test, fix the code, or update the test if the behavior was meant to change. Don't delete or skip a test to get a merge through.
