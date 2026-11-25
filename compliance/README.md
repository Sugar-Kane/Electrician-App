# Compliance

Volteira's regulatory, accessibility and cybersecurity compliance program: the requirement
registers, audit tooling, audit results and history. **Results are evidence, not legal advice,
and never a certification or protection against lawsuits.**

## Layout

| Path | What |
|---|---|
| `registry/*.json` | Requirement registers: law, standards and contractual rules only. Statuses never live here. 9 registers: `federal`, `california`, `california-contractors`, `website-federal`, `website-california`, `website-contractors`, `website-accessibility` (every WCAG 2.2 A/AA criterion), `website-security`, `application-security`. Plus `cslb-license-lookup.json`. |
| `schemas/` | JSON schemas for requirements, findings, evidence and reports. |
| `scripts/` | Node tools (no extra dependencies): `validate-requirements`, `run-website-audit`, `evaluate-website`, `generate-report`, `compare-audits`, `refresh-legal-requirements`, `verify-command-registry`, `package-website-skill`. |
| `tests/manifest.json` | Compliance tests → requirement IDs. Unit tests live in `src/compliance-tests/` (run by `npm test`); `tests/tenant-isolation/` holds the rolled-back two-tenant SQL. |
| `templates/` | Dashboard HTML template; proposed CI workflow (`ci-compliance.yml.example`, not active). |
| `application-audits/<date>/` | One application audit: `findings/`, `evidence/`, `report.{md,json}`, `dashboard.html`. |
| `website-audits/<domain>/<timestamp>/` | One website audit: `observations.json`, `screenshots/`, `findings.json`, `report.*`, `dashboard.html`. |
| `legal-history/` | Dated baseline snapshots and legal verification / change reports. Never overwritten. |
| `release-gates.{md,json}` | Proposed release gates (not enforced). |
| `remediation-backlog.md` | P0–P3 fixes for approval. Nothing here is implemented without approval. |

## Statuses

🟢 GREEN compliant (verified with evidence) · 🟡 YELLOW partial · 🔴 RED non-compliant · ⚪ GRAY not
applicable (with a reason) · 🔵 BLUE unable to verify (with the reason).

GREEN is never given for code merely existing, a comment, a policy statement, an untested setting
or an automated scan alone. A requirement whose official source has not been verified in the
current baseline is reported BLUE, with what the evidence showed kept as `observed_status`.

Metrics (Gray excluded; "not available" when the denominator is zero):
- Verified pass rate = Green ÷ (Green + Yellow + Red)
- Verification coverage = (Green + Yellow + Red) ÷ (Green + Yellow + Red + Blue)
- Overall verified applicable compliance = Green ÷ (Green + Yellow + Red + Blue)

Legal requirements and recommended security controls are always totalled separately.

## Commands

Use the skills (see `.claude/COMMANDS.md`):

```
/volteira-compliance [quick|federal|california|contractors|security|accessibility|privacy|communications|contracts|invoices|payments|mcp|refresh-laws|compare|release]
/website-compliance <URL> [full|quick|federal|california|contractors|accessibility|privacy|security|communications|compare]
/website-compliance refresh-laws
/command-registry [all|compliance|website|security|installed]
```

Or the scripts directly:

```
node compliance/scripts/validate-requirements.mjs
node compliance/scripts/run-website-audit.mjs https://example.com --mode full
node compliance/scripts/evaluate-website.mjs <run dir>
node compliance/scripts/generate-report.mjs website <run dir>
node compliance/scripts/generate-report.mjs application compliance/application-audits/<date>
node compliance/scripts/compare-audits.mjs --latest compliance/application-audits --release
node compliance/scripts/refresh-legal-requirements.mjs worklist
node compliance/scripts/refresh-legal-requirements.mjs snapshot
```

## Legal change management

1. `refresh-legal-requirements.mjs worklist` lists requirements never verified, older than 90
   days, or future-effective.
2. Re-read each official source (the skills do this with web access), correcting citations and
   recording what changed in the requirement's `notes`.
3. `refresh-legal-requirements.mjs snapshot` keeps the old baseline in `legal-history/<date>/`,
   and `diff <old> <new>` writes the regulatory change report (added, repealed, amended,
   future-effective, needing legal interpretation).
4. Re-run the audits; `compare-audits.mjs` shows newly compliant, newly failing and regressions.

## Sensitive evidence

Evidence is redacted: no customer data, credentials, payment details or secrets. This
repository is private; security findings should stay out of public repositories.
