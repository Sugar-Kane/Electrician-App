#!/usr/bin/env node
/**
 * Build the remediation backlog and the legal review register from an application audit's
 * findings (and optionally website audits).
 *
 *   node compliance/scripts/build-backlog.mjs compliance/application-audits/<date> [website run dirs...]
 *
 * Uses each finding's observed result (observed_status when the report forced BLUE for an
 * unverified source, otherwise status), so a real problem is never hidden by an unverified
 * citation. Writes compliance/remediation-backlog.md and compliance/legal-review-register.md.
 * Nothing in the backlog is implemented by this script.
 */
import fs from "node:fs";
import path from "node:path";
import { COMPLIANCE_DIR, readJson, loadAllRequirements } from "./lib.mjs";

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error("usage: build-backlog.mjs <application audit dir> [website run dirs...]");
  process.exit(2);
}

const reqs = loadAllRequirements();
const findings = [];
for (const d of dirs) {
  const one = path.join(d, "findings.json");
  const files = fs.existsSync(one)
    ? [one]
    : fs.readdirSync(path.join(d, "findings")).filter((f) => f.endsWith(".json")).map((f) => path.join(d, "findings", f));
  for (const f of files) {
    const data = readJson(f);
    for (const x of Array.isArray(data) ? data : data.findings || []) findings.push({ ...x, _source: path.relative(COMPLIANCE_DIR, f) });
  }
}

const observed = (f) => f.observed_status || f.status;
const SEV = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const sevRank = (s) => SEV[s] ?? 5;

function priorityOf(f) {
  if (f.priority && f.priority !== "none") return f.priority;
  const s = observed(f);
  if (s === "RED" && (f.severity === "critical" || f.severity === "high")) return f.severity === "critical" ? "P0" : "P1";
  if (s === "RED") return "P2";
  if (s === "YELLOW" && (f.severity === "critical" || f.severity === "high")) return "P2";
  return "P3";
}

const open = findings.filter((f) => ["RED", "YELLOW"].includes(observed(f)));
open.sort((a, b) => priorityOf(a).localeCompare(priorityOf(b)) || sevRank(a.severity) - sevRank(b.severity) || a.requirement_id.localeCompare(b.requirement_id));

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const cut = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");
const today = new Date().toISOString().slice(0, 10);

const md = [];
md.push("# Remediation backlog");
md.push("");
md.push(`Generated ${today} by \`compliance/scripts/build-backlog.mjs\` from: ${dirs.map((d) => `\`${d}\``).join(", ")}.`);
md.push("");
md.push("**For approval. Nothing here has been implemented.** Each item names the finding, the rule it");
md.push("supports, where the problem is, and what would show it fixed. Priorities: P0 fix before relying");
md.push("on the feature; P1 fix soon; P2 planned; P3 improvement. Items marked ⚖️ need a lawyer to confirm");
md.push("the requirement or the fix before work starts. A citation not yet re-verified against its official");
md.push("source is marked ❔; the problem was still observed.");
md.push("");
const counts = {};
for (const f of open) counts[priorityOf(f)] = (counts[priorityOf(f)] || 0) + 1;
md.push(`| Priority | Items |`);
md.push(`|---|---|`);
for (const p of ["P0", "P1", "P2", "P3"]) md.push(`| ${p} | ${counts[p] || 0} |`);
md.push(`| **Total** | **${open.length}** |`);
md.push("");

for (const p of ["P0", "P1", "P2", "P3"]) {
  const items = open.filter((f) => priorityOf(f) === p);
  if (!items.length) continue;
  md.push(`## ${p}`);
  md.push("");
  if (p === "P3" || p === "P2") {
    md.push("| Finding | Requirement | Observed | Severity | Problem | Fix | Files |");
    md.push("|---|---|---|---|---|---|---|");
    for (const f of items) {
      const r = reqs.get(f.requirement_id);
      const flags = `${f.legal_review_required || r?.legal_review_required ? " ⚖️" : ""}${r && !r.source_verified ? " ❔" : ""}`;
      md.push(`| ${f.finding_id}${flags} | ${f.requirement_id} ${esc(cut(r?.title, 60))} | ${observed(f)} | ${f.severity} | ${esc(cut(f.actual, 220))} | ${esc(cut(f.remediation, 220))} | ${esc((f.affected_files || []).slice(0, 3).join(", "))} |`);
    }
    md.push("");
    continue;
  }
  for (const f of items) {
    const r = reqs.get(f.requirement_id);
    const flags = `${f.legal_review_required || r?.legal_review_required ? " ⚖️" : ""}${r && !r.source_verified ? " ❔" : ""}`;
    md.push(`### ${f.finding_id}${flags}: ${esc(r?.title || f.requirement_id)}`);
    md.push("");
    md.push(`- **Requirement:** ${f.requirement_id}${r ? ` (${r.citation})` : ""}`);
    md.push(`- **Observed:** ${observed(f)}, severity ${f.severity}, confidence ${f.confidence}`);
    md.push(`- **Problem:** ${esc(f.actual)}`);
    md.push(`- **Fix:** ${esc(f.remediation)}`);
    if ((f.affected_files || []).length) md.push(`- **Files:** ${f.affected_files.map((x) => `\`${x}\``).join(", ")}`);
    md.push(`- **Done when:** ${esc(f.expected)}${(r?.automated_test_ids || []).length ? ` Tests: ${r.automated_test_ids.join(", ")}.` : " Add a regression test if it touches money, security, consent or signatures (AGENTS.md)."}`);
    md.push(`- **Source:** \`${f._source}\``);
    md.push("");
  }
}
fs.writeFileSync(path.join(COMPLIANCE_DIR, "remediation-backlog.md"), md.join("\n"));

// Legal review register: every requirement flagged for legal review that has a finding, plus
// every unverified legal source with a RED/YELLOW observation.
const legal = findings.filter((f) => {
  const r = reqs.get(f.requirement_id);
  return f.legal_review_required || r?.legal_review_required || (r && !r.source_verified && ["RED", "YELLOW"].includes(observed(f)) && !["standard", "recommended", "contractual"].includes(r.requirement_type));
});
legal.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.requirement_id.localeCompare(b.requirement_id));
const lr = [];
lr.push("# Legal review register");
lr.push("");
lr.push(`Generated ${today} by \`compliance/scripts/build-backlog.mjs\`. Questions for a California-licensed`);
lr.push("lawyer. The audit does not decide these; it records what the software does today.");
lr.push("");
lr.push("| Requirement | Citation | Source verified | Observed | Severity | Question / what was observed |");
lr.push("|---|---|---|---|---|---|");
for (const f of legal) {
  const r = reqs.get(f.requirement_id);
  lr.push(`| ${f.requirement_id} ${esc(cut(r?.title, 60))} | ${esc(r?.citation)} | ${r?.source_verified ? "yes" : "no"} | ${observed(f)} | ${f.severity} | ${esc(cut(f.status_reason || f.actual, 260))} |`);
}
lr.push("");
lr.push(`${legal.length} items.`);
fs.writeFileSync(path.join(COMPLIANCE_DIR, "legal-review-register.md"), lr.join("\n"));

console.log(`✓ backlog: ${open.length} items (${["P0", "P1", "P2", "P3"].map((p) => `${p} ${counts[p] || 0}`).join(", ")}); legal review: ${legal.length}`);
