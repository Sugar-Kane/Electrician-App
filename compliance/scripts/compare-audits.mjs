#!/usr/bin/env node
/**
 * Compare two audit reports (report.json) and list what changed, and keep the history index.
 *
 *   node compliance/scripts/compare-audits.mjs <older report.json> <newer report.json> [--out FILE]
 *   node compliance/scripts/compare-audits.mjs --latest <dir of audits> [--release] [--out FILE]
 *
 * --latest finds the two newest report.json files under the directory (application-audits or
 * website-audits/<domain>). --release adds a release-readiness verdict from
 * compliance/release-gates.json. History is append-only: old reports are never rewritten.
 */
import fs from "node:fs";
import path from "node:path";
import { COMPLIANCE_DIR, readJson } from "./lib.mjs";

const argv = process.argv.slice(2);
const out = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : null;
const release = argv.includes("--release");

function findReports(dir) {
  const found = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === "report.json") found.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found
    .map((p) => ({ p, at: readJson(p).started_at || "" }))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((x) => x.p);
}

let olderPath;
let newerPath;
if (argv[0] === "--latest") {
  const reports = findReports(path.resolve(argv[1] || path.join(COMPLIANCE_DIR, "application-audits")));
  newerPath = reports.at(-1);
  olderPath = reports.at(-2);
  if (!newerPath) {
    console.error("no report.json found");
    process.exit(2);
  }
} else {
  [olderPath, newerPath] = argv.filter((a) => !a.startsWith("--") && a !== out);
}

const newer = readJson(newerPath);
const older = olderPath ? readJson(olderPath) : null;
const byReq = (r) => new Map((r?.findings || []).map((f) => [f.requirement_id, f]));
const a = byReq(older);
const b = byReq(newer);
const rank = { GREEN: 3, YELLOW: 2, BLUE: 1, RED: 0, GRAY: -1 };

const changes = { newly_compliant: [], newly_noncompliant: [], regressions: [], improvements: [], resolved: [], new_findings: [], newly_verified: [], newly_unverified: [], removed_requirements: [], evidence_changed: [] };
for (const [id, f] of b) {
  const prev = a.get(id);
  if (!prev) {
    changes.new_findings.push({ id, status: f.status });
    continue;
  }
  if (prev.status === f.status) {
    if (JSON.stringify(prev.evidence) !== JSON.stringify(f.evidence)) changes.evidence_changed.push(id);
    continue;
  }
  const move = { id, from: prev.status, to: f.status };
  if (f.status === "GREEN") changes.newly_compliant.push(move);
  if (f.status === "RED") changes.newly_noncompliant.push(move);
  if (prev.status === "BLUE" && f.status !== "BLUE") changes.newly_verified.push(move);
  if (f.status === "BLUE" && prev.status !== "BLUE") changes.newly_unverified.push(move);
  if (["RED", "YELLOW"].includes(prev.status) && ["GREEN", "GRAY"].includes(f.status)) changes.resolved.push(move);
  if (rank[f.status] < rank[prev.status] && f.status !== "GRAY") changes.regressions.push(move);
  else if (rank[f.status] > rank[prev.status]) changes.improvements.push(move);
}
for (const id of a.keys()) if (!b.has(id)) changes.removed_requirements.push(id);

const legalBaselineChanged = older && older.legal_baseline_version !== newer.legal_baseline_version;
const result = {
  compared_at: new Date().toISOString(),
  older: older ? { audit_id: older.audit_id, started_at: older.started_at, git_commit: older.git_commit, legal_baseline_version: older.legal_baseline_version, totals: older.totals } : null,
  newer: { audit_id: newer.audit_id, started_at: newer.started_at, git_commit: newer.git_commit, legal_baseline_version: newer.legal_baseline_version, totals: newer.totals },
  legal_baseline_changed: !!legalBaselineChanged,
  changes,
};

if (release) {
  const gatesFile = path.join(COMPLIANCE_DIR, "release-gates.json");
  const gates = fs.existsSync(gatesFile) ? readJson(gatesFile) : { block: [] };
  const blocking = (newer.findings || []).filter((f) => f.status === "RED" && gates.block.some((g) => (g.requirement_prefixes || []).some((p) => f.requirement_id.startsWith(p)) && (!g.min_severity || ["critical", "high", "medium", "low", "informational"].indexOf(f.severity) <= ["critical", "high", "medium", "low", "informational"].indexOf(g.min_severity))));
  const escalate = (newer.findings || []).filter((f) => f.status === "BLUE" && ["critical", "high"].includes(f.severity));
  result.release = { verdict: blocking.length || changes.regressions.length ? "NOT READY" : "READY (no blocking verified findings)", blocking: blocking.map((f) => f.finding_id), regressions: changes.regressions, escalate_unverified_high_risk: escalate.length, note: "Proposed gates only; not enforced in CI." };
}

const text = JSON.stringify(result, null, 2);
if (out) fs.writeFileSync(out, text);
console.log(text);
