#!/usr/bin/env node
/**
 * Copy the website audit tooling into the self-contained website-compliance skill, so the
 * skill works without this repository (for example when installed in ~/.claude/skills/).
 * compliance/ stays canonical; run this after changing any of the copied files.
 *
 *   node compliance/scripts/package-website-skill.mjs [--check]
 * --check exits 1 if the skill's copies differ from the canonical files (for CI or review).
 */
import fs from "node:fs";
import path from "node:path";
import { COMPLIANCE_DIR } from "./lib.mjs";

const skill = path.resolve(COMPLIANCE_DIR, "..", ".claude", "skills", "website-compliance");
const files = [
  ["scripts/lib.mjs", "scripts/lib.mjs"],
  ["scripts/run-website-audit.mjs", "scripts/run-website-audit.mjs"],
  ["scripts/evaluate-website.mjs", "scripts/evaluate-website.mjs"],
  ["scripts/generate-report.mjs", "scripts/generate-report.mjs"],
  ["scripts/compare-audits.mjs", "scripts/compare-audits.mjs"],
  ["scripts/validate-requirements.mjs", "scripts/validate-requirements.mjs"],
  ["templates/dashboard.html", "templates/dashboard.html"],
  ["schemas/requirement.schema.json", "schemas/requirement.schema.json"],
  ["schemas/finding.schema.json", "schemas/finding.schema.json"],
  ["schemas/audit-report.schema.json", "schemas/audit-report.schema.json"],
  ["registry/website-federal.json", "registry/website-federal.json"],
  ["registry/website-california.json", "registry/website-california.json"],
  ["registry/website-contractors.json", "registry/website-contractors.json"],
  ["registry/website-accessibility.json", "registry/website-accessibility.json"],
  ["registry/website-security.json", "registry/website-security.json"],
];
const check = process.argv.includes("--check");
let differ = 0;
for (const [from, to] of files) {
  const src = path.join(COMPLIANCE_DIR, from);
  const dst = path.join(skill, to);
  if (!fs.existsSync(src)) {
    console.log(`- skip ${from} (not present yet)`);
    continue;
  }
  const same = fs.existsSync(dst) && fs.readFileSync(src).equals(fs.readFileSync(dst));
  if (check) {
    if (!same) {
      differ += 1;
      console.log(`✗ ${to} differs from compliance/${from}`);
    }
    continue;
  }
  if (!same) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    console.log(`copied ${from}`);
  }
}
if (check) {
  console.log(differ ? `${differ} file(s) out of date; run without --check` : "✓ website-compliance skill matches compliance/");
  process.exit(differ ? 1 : 0);
}
