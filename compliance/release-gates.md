# Proposed compliance release gates

**Status: proposed only. Nothing here runs in CI or blocks a merge until Adam approves it.**
The machine-readable version is `compliance/release-gates.json`; `compare-audits.mjs --release`
applies it to the latest audit and prints READY / NOT READY with the blocking findings.

## Would block a release (verified RED findings)

| Gate | Blocks on | Requirement families | Minimum severity |
|---|---|---|---|
| GATE-01 | Cross-tenant information exposure | SEC-002 | high |
| GATE-02 | Critical cybersecurity vulnerability | SEC-001, SEC-003, SEC-004 | critical |
| GATE-03 | Consent enforcement bypass (texts, calls, email) | FED-002, FED-003, CA-006 | high |
| GATE-04 | Silent change to a signed contract; e-signature integrity | FED-001, CA-005, CSLB-006 | high |
| GATE-05 | Contractor down payment or progress payment limit bypass | CSLB-004, CSLB-005 | high |
| GATE-06 | Unauthorized payment; card data stored improperly | FED-007 | high |
| GATE-07 | AI or MCP bypassing consent, money or tenant controls | SEC-007, FED-010 | high |
| GATE-08 | Critical accessibility barrier on a customer journey | WCAG-* | critical |

Only **verified** findings block. A requirement that is BLUE (unverified) never blocks by
itself; it is escalated instead.

## Would escalate (needs a person, not an automatic block)

- A legal-review requirement whose observed status is RED or YELLOW.
- A high or critical requirement still BLUE at release time.
- Any regression since the previous release (`compare-audits.mjs`).

## Proposed CI integration (not installed)

`compliance/templates/ci-compliance.yml.example` is a GitHub Actions workflow for review. It
runs on pull requests:

1. `npm ci && npm test` (the unit tests include `src/compliance-tests/`).
2. `node compliance/scripts/validate-requirements.mjs`.
3. `node compliance/scripts/verify-command-registry.mjs`.
4. `node compliance/scripts/package-website-skill.mjs --check`.
5. Report-only at first: `node compliance/scripts/compare-audits.mjs --latest compliance/application-audits --release`
   posts the verdict but does not fail the build.

Suggested rollout: report-only for two releases, then make steps 1–4 required, then turn on
GATE-01, GATE-03, GATE-05 and GATE-07 as blocking, then the rest.

To activate: copy the file to `.github/workflows/compliance.yml` in a reviewed PR.
