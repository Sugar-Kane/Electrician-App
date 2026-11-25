# volteira-compliance

Project skill for Claude Code. Audits the Volteira application against the requirement registers
in `compliance/registry/` and writes evidence-backed findings and reports.

## Use

```
/volteira-compliance            full audit
/volteira-compliance quick      automated regression tests only
/volteira-compliance federal    one register (also: california, contractors, security,
                                accessibility, privacy, communications, contracts, invoices,
                                payments, mcp)
/volteira-compliance refresh-laws   re-check legal sources; new baseline, change report
/volteira-compliance compare    latest audit vs the previous one
/volteira-compliance release    release readiness against the proposed gates
```

## Needs

- This repository (it reads `compliance/` and the app code).
- Node 20+, `npm ci`. Playwright with Chromium for accessibility checks.
- Supabase MCP for database checks (rolled back only); Vercel MCP for deployment info; Stripe MCP
  optional. Missing integrations are reported as limitations, and the affected requirements
  are marked BLUE.

## Installed

Project scope: `.claude/skills/volteira-compliance/` in this repository. Claude Code loads
project skills automatically in sessions opened in this repository.
