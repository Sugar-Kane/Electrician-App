# website-compliance

A Claude Code skill that audits any public website from the outside: federal, California and
California contractor requirements, WCAG 2.2 A/AA, privacy and tracking, customer communications,
and a security-header baseline. One report per site (Markdown, JSON, interactive HTML).

```
/website-compliance https://pacificplainselectric.com
/website-compliance https://volteira.com quick
/website-compliance https://a.example https://b.example        # separate reports
/website-compliance https://volteira.com accessibility
/website-compliance refresh-laws
```

## Install globally (your own machine)

The canonical copy lives in the Volteira repository. To use it in every project:

```
mkdir -p ~/.claude/skills
cp -R /path/to/Electrician-App/.claude/skills/website-compliance ~/.claude/skills/
cd ~/.claude/skills/website-compliance && npm init -y >/dev/null && npm i @playwright/test axe-core
npx playwright install chromium
```

Then start a new Claude Code session; `/website-compliance` appears in the skill list. To update,
copy the folder again (after `node compliance/scripts/package-website-skill.mjs` in the repo).

## Needs

Node 20+, Playwright with Chromium, axe-core, and network access to the site being audited.

## Limits

Outside-in only: no logins, form submissions, bookings or payments. Automated accessibility
checks find only part of WCAG, and no assistive-technology testing is done, so most success
criteria stay BLUE until a person reviews them. Anything that depends on the business's records
or server behaviour is BLUE. Not legal advice.
