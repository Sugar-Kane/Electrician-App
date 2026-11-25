# Command registry

The master list of custom Claude Code commands and skills for this repository. Keep it current:
whenever a custom skill or command is created, renamed, changed or deprecated, update its row
here and run `node compliance/scripts/verify-command-registry.mjs` (see `/command-registry`).

Statuses: **Installed** (files present and seen loaded in a session), **Proposed**, **Deprecated**,
**Unavailable**. A command is never marked Installed until its files exist and it has been seen
in a session's skill list or invoked.

## Index

| Command | Status | Scope | Tags | Example |
|---|---|---|---|---|
| `/volteira-compliance` | Installed | project | compliance, security, accessibility | `/volteira-compliance quick` |
| `/website-compliance` | Installed | project (global install optional) | compliance, website, accessibility, security | `/website-compliance https://pacificplainselectric.com` |
| `/command-registry` | Installed | project | registry | `/command-registry installed` |
| `/design-tokens-first` | Installed | project | ui | (model-invoked; no arguments) |
| `/money-and-trust-code` | Installed | project | money, security, compliance | (model-invoked; no arguments) |
| `/multi-tenant-supabase` | Installed | project | security, database | (model-invoked; no arguments) |
| `/responsive-ui` | Installed | project | ui, accessibility | (model-invoked; no arguments) |
| `/ship-a-change` | Installed | project | workflow | (model-invoked; no arguments) |
| `/volteira-conventions` | Installed | project | workflow | (model-invoked; no arguments) |
| `/code-review` | Installed | built-in (Claude Code) | security, review | `/code-review high` |
| `/security-review` | Installed | built-in (Claude Code) | security | `/security-review` |

## Details

### `/volteira-compliance`

| Field | Value |
|---|---|
| Description | Regulatory, security and accessibility audit of the Volteira application against `compliance/registry`; evidence-backed GREEN/YELLOW/RED/GRAY/BLUE findings, reports, backlog. |
| Required arguments | none (default = full audit) |
| Optional arguments | `quick`, `federal`, `california`, `contractors`, `security`, `accessibility`, `privacy`, `communications`, `contracts`, `invoices`, `payments`, `mcp`, `refresh-laws`, `compare`, `release` |
| Examples | `/volteira-compliance` · `/volteira-compliance quick` · `/volteira-compliance contractors` · `/volteira-compliance release` |
| Skill file | `.claude/skills/volteira-compliance/SKILL.md` |
| Scope | project |
| Required integrations | Supabase MCP (database checks, rolled back only), Vercel MCP (deployment id); optional Stripe MCP, Playwright (library, local) |
| Output | `compliance/application-audits/<date>/` (report.md, report.json, dashboard.html, findings/) |
| Can modify | Writes only under `compliance/`. Read-only toward app code, production data and deployments. |
| Created / last verified | 2026-11-24 / 2026-11-24 (seen in session skill list) |
| Version | 1.0.0 |
| Known limitations | Legal sources must be reachable for `refresh-laws`; without them requirements stay BLUE. Not legal advice. |

### `/website-compliance`

| Field | Value |
|---|---|
| Description | Outside-in compliance audit of any public website URL (federal, California, CSLB contractor, WCAG 2.2 A/AA, privacy and tracking, communications, security baseline), with a separate report per site. Works without the site's source code. |
| Required arguments | `<URL>` (one or more), or `refresh-laws` |
| Optional arguments | `full` (default), `quick`, `federal`, `california`, `contractors`, `accessibility`, `privacy`, `security`, `communications`, `compare` |
| Examples | `/website-compliance https://pacificplainselectric.com` · `/website-compliance https://volteira.com quick` · `/website-compliance https://a.com https://b.com` · `/website-compliance refresh-laws` |
| Skill file | `.claude/skills/website-compliance/SKILL.md` (self-contained: own `registry/` and `scripts/`) |
| Scope | project; optional global copy at `~/.claude/skills/website-compliance/` (see its README) |
| Required integrations | Node 20+, Playwright + Chromium, axe-core; network access to the audited site |
| Output | `compliance/website-audits/<domain>/<timestamp>/` in this repo, or `./website-audits/` elsewhere |
| Can modify | Writes only its output folder. Never submits forms, books, signs, pays or logs in. |
| Created / last verified | 2026-11-24 / 2026-11-24 (seen in session skill list) |
| Version | 1.0.0 |
| Known limitations | Automated accessibility checks are partial; no assistive-technology testing. Backend obligations show as BLUE. The global copy is not installed on Adam's machine by this session. |

### `/command-registry`

| Field | Value |
|---|---|
| Description | Shows and maintains this registry. |
| Required arguments | none |
| Optional arguments | `all`, `compliance`, `website`, `security`, `installed` |
| Examples | `/command-registry` · `/command-registry installed` |
| Skill file | `.claude/skills/command-registry/SKILL.md` |
| Scope | project |
| Required integrations | none |
| Output | prints to the session |
| Can modify | Updates `.claude/COMMANDS.md` only when asked to record a change |
| Created / last verified | 2026-11-24 / 2026-11-24 (seen in session skill list) |
| Version | 1.0.0 |
| Known limitations | Global (`~/.claude`) skills are only checked on the machine that has them. |

### Existing project skills

`design-tokens-first`, `money-and-trust-code`, `multi-tenant-supabase`, `responsive-ui`,
`ship-a-change`, `volteira-conventions`: guidance skills Claude loads automatically for matching
work (`.claude/skills/<name>/SKILL.md`, project scope, no arguments, read-only guidance). Created
before 2026-11-24; verified present 2026-11-24.

### Built-in commands (Claude Code, not ours)

`/code-review`, `/security-review` and other built-ins come with Claude Code. Listed for
reference only; they are not maintained here.

## Copy-ready reference

```
/volteira-compliance
/volteira-compliance quick
/volteira-compliance federal
/volteira-compliance california
/volteira-compliance contractors
/volteira-compliance security
/volteira-compliance accessibility
/volteira-compliance privacy
/volteira-compliance communications
/volteira-compliance contracts
/volteira-compliance invoices
/volteira-compliance payments
/volteira-compliance mcp
/volteira-compliance refresh-laws
/volteira-compliance compare
/volteira-compliance release
/website-compliance https://pacificplainselectric.com
/website-compliance https://volteira.com full
/website-compliance https://volteira.com quick
/website-compliance <URL> federal | california | contractors | accessibility | privacy | security | communications | compare
/website-compliance refresh-laws
/command-registry
/command-registry all | compliance | website | security | installed
```
