#!/usr/bin/env node
/**
 * Build report.json, report.md and dashboard.html for one audit.
 *
 *   node compliance/scripts/generate-report.mjs <application|website> <audit-dir> [--registry DIR]
 *
 * <audit-dir> holds meta.json and either findings.json (an array) or findings/*.json (each an
 * array or one finding). Totals are computed from the findings and reconciled before anything
 * is written; a mismatch stops the run. Legal and standards scorecards are kept apart.
 */
import fs from "node:fs";
import path from "node:path";
import { LABEL, REGISTRY_DIR, SCHEMA_DIR, STATUSES, loadAllRequirements, metrics, pct, readJson, totals, validate } from "./lib.mjs";

const [kind, dirArg] = process.argv.slice(2);
if (!["application", "website"].includes(kind) || !dirArg) {
  console.error("usage: generate-report.mjs <application|website> <audit-dir> [--registry DIR]");
  process.exit(2);
}
const dir = path.resolve(dirArg);
const argv = process.argv;
const registryDir = argv.includes("--registry") ? path.resolve(argv[argv.indexOf("--registry") + 1]) : REGISTRY_DIR;
const meta = readJson(path.join(dir, "meta.json"));
const requirements = loadAllRequirements(registryDir);

let findings = [];
if (fs.existsSync(path.join(dir, "findings.json"))) findings = readJson(path.join(dir, "findings.json"));
const fdir = path.join(dir, "findings");
if (fs.existsSync(fdir)) {
  for (const f of fs.readdirSync(fdir).filter((n) => n.endsWith(".json")).sort()) {
    const v = readJson(path.join(fdir, f));
    findings.push(...(Array.isArray(v) ? v : [v]));
  }
}

// A requirement whose official source was not verified can be at best BLUE: what the evidence
// showed is kept as observed_status so real problems still reach the backlog.
for (const f of findings) {
  const r = requirements.get(f.requirement_id);
  if (r && r.source_verified === false && ["GREEN", "YELLOW", "RED"].includes(f.status)) {
    f.observed_status = f.status;
    f.status = "BLUE";
    f.status_reason = `Official source not yet verified in this legal baseline (observed: ${f.observed_status}).${f.status_reason ? ` ${f.status_reason}` : ""}`;
  }
}

// ---------- validation and reconciliation ----------
const schema = readJson(path.join(SCHEMA_DIR, "finding.schema.json"));
const problems = [];
const seen = new Set();
for (const f of findings) {
  problems.push(...validate(f, schema, f.finding_id || "(finding)"));
  if (seen.has(f.requirement_id)) problems.push(`${f.requirement_id}: more than one finding`);
  seen.add(f.requirement_id);
  if (!requirements.has(f.requirement_id)) problems.push(`${f.requirement_id}: not in any register`);
  if ((f.status === "GRAY" || f.status === "BLUE") && !f.status_reason) problems.push(`${f.finding_id}: ${f.status} needs a status_reason`);
  if (f.status === "GREEN" && !(f.evidence || []).length) problems.push(`${f.finding_id}: GREEN without evidence`);
}
if (problems.length) {
  console.error(`✗ ${problems.length} problem(s) in findings:`);
  for (const p of problems.slice(0, 40)) console.error(`   ${p}`);
  process.exit(1);
}

const reqOf = (f) => requirements.get(f.requirement_id) || {};
const isLegal = (r) => ["statutory", "regulatory", "legal-interpretation-required", "future-effective", "pending-legislation", "guidance"].includes(r.requirement_type);

const SCORECARDS = {
  application: [
    ["Federal requirements", (r) => r.register === "federal"],
    ["California requirements", (r) => r.register === "california"],
    ["California contractor requirements", (r) => r.register === "california-contractors"],
    ["Cybersecurity (recommended controls)", (r) => r.register === "application-security"],
    ["ADA and accessibility", (r) => r.register === "website-accessibility" || /FED-005|CA-007/.test(r.id)],
    ["Privacy", (r) => /^(CA-00[1-4]|FED-004|FED-011)/.test(r.id) || /^SEC-00[25]/.test(r.id)],
    ["Customer communications", (r) => /^(FED-00[23]|CA-006)/.test(r.id)],
    ["Electronic signatures", (r) => /^(FED-001|CA-005)/.test(r.id)],
    ["Contracts", (r) => /^CSLB-00[2-8]/.test(r.id)],
    ["Invoices and payments", (r) => /^(FED-00[67]|FED-009|CA-010|CSLB-00[45])/.test(r.id)],
    ["AI and MCP security", (r) => /^(SEC-007|FED-010)/.test(r.id)],
  ],
  website: [
    ["Federal website requirements", (r) => r.register === "website-federal"],
    ["California website requirements", (r) => r.register === "website-california"],
    ["California contractor website requirements", (r) => r.register === "website-contractors"],
    ["Accessibility (WCAG 2.2 A/AA)", (r) => r.register === "website-accessibility"],
    ["Privacy and tracking", (r) => /privacy|tracking|cookie|gpc|ccpa|caloppa|cipa/i.test(`${r.title} ${r.category}`)],
    ["Customer communications", (r) => /sms|text|tcpa|email|can-spam|communicat/i.test(`${r.title} ${r.category}`)],
    ["Cybersecurity baseline (audit policy, not law)", (r) => r.register === "website-security"],
  ],
};

function scorecard(name, test) {
  const list = findings.filter((f) => test(reqOf(f)));
  const t = totals(list);
  let result = "INSUFFICIENT EVIDENCE";
  const mandatoryFail = list.some((f) => f.status === "RED");
  const assessed = t.GREEN + t.YELLOW + t.RED;
  if (mandatoryFail) result = "FAIL";
  else if (assessed > 0 && t.BLUE === 0 && t.YELLOW === 0) result = "PASS";
  else if (assessed > 0) result = "CONDITIONAL PASS";
  return { name, totals: t, metrics: metrics(t), result };
}

const cards = SCORECARDS[kind].map(([name, test]) => scorecard(name, test));
const all = totals(findings);
const legal = totals(findings.filter((f) => isLegal(reqOf(f))));
const nonLegal = totals(findings.filter((f) => !isLegal(reqOf(f))));
// Reconciliation: the per-status sum must equal the finding count, and legal + non-legal must
// add up to the whole.
for (const t of [all, legal, nonLegal]) {
  if (STATUSES.reduce((n, s) => n + t[s], 0) !== t.total) throw new Error("totals do not reconcile");
}
if (legal.total + nonLegal.total !== all.total) throw new Error("legal and standards totals do not add up");

let websiteResult;
if (kind === "website") {
  const legalCards = cards.filter((c) => !/baseline/.test(c.name));
  if (meta.pages_tested === 0) websiteResult = "INSUFFICIENT EVIDENCE";
  else if (legalCards.some((c) => c.result === "FAIL")) websiteResult = "FAIL";
  else if (legalCards.every((c) => c.result === "PASS")) websiteResult = "PASS";
  // CONDITIONAL PASS needs most applicable requirements actually assessed; otherwise the
  // honest answer is that the evidence is insufficient.
  else if ((metrics(all).verification_coverage ?? 0) >= 50) websiteResult = "CONDITIONAL PASS";
  else websiteResult = "INSUFFICIENT EVIDENCE";
}

const critical = findings.filter((f) => ["RED", "YELLOW"].includes(f.status) && f.severity === "critical");
const high = findings.filter((f) => ["RED", "YELLOW"].includes(f.status) && f.severity === "high");
const legalReview = findings.filter((f) => f.legal_review_required);

const report = {
  ...meta,
  kind,
  generated_at: new Date().toISOString(),
  totals: all,
  metrics: metrics(all),
  legal_totals: legal,
  legal_metrics: metrics(legal),
  standards_totals: nonLegal,
  standards_metrics: metrics(nonLegal),
  scorecards: cards,
  website_result: websiteResult,
  critical_findings: critical.map((f) => f.finding_id),
  high_findings: high.map((f) => f.finding_id),
  legal_review: legalReview.map((f) => f.requirement_id),
  findings,
};
fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));

// ---------- Markdown ----------
const row = (t) => `${t.total} | ${t.GREEN} | ${t.YELLOW} | ${t.RED} | ${t.GRAY} | ${t.BLUE}`;
const mrow = (m) => `${pct(m.verified_pass_rate)} | ${pct(m.verification_coverage)} | ${pct(m.overall_verified_applicable_compliance)}`;
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const md = [];
md.push(`# ${kind === "website" ? "Website" : "Application"} compliance report: ${meta.target}`);
md.push("");
md.push("> Evidence-based audit results, not legal advice and not a certification. A PASS does not mean immunity from complaints or lawsuits.");
md.push("");
md.push("## Executive summary");
md.push("");
md.push(`| | |\n|---|---|`);
for (const [k, v] of [
  ["Audit", meta.audit_id],
  ["Audit date", (meta.started_at || "").slice(0, 10)],
  ["Target", meta.website_url || meta.target],
  ["Git commit", meta.git_commit || "n/a"],
  ["Deployment", meta.deployment_id || "n/a"],
  ["Environment", meta.environment],
  ["Legal baseline", meta.legal_baseline_version],
  ["Skill / tool", `${meta.skill_version}${meta.tool_version ? ` / ${meta.tool_version}` : ""}`],
  ["Overall result", websiteResult || (all.RED ? "Not ready: verified failures present" : all.BLUE ? "Incomplete: unverified requirements remain" : "No verified failures")],
]) md.push(`| ${k} | ${esc(v)} |`);
md.push("");
md.push("| Scope | Total | 🟢 Green | 🟡 Yellow | 🔴 Red | ⚪ Gray | 🔵 Blue | Verified pass rate | Verification coverage | Overall verified compliance |");
md.push("|---|---|---|---|---|---|---|---|---|---|");
md.push(`| **All requirements** | ${row(all)} | ${mrow(metrics(all))} |`);
md.push(`| Legal (statutes, regulations, guidance) | ${row(legal)} | ${mrow(metrics(legal))} |`);
md.push(`| Standards and recommended controls | ${row(nonLegal)} | ${mrow(metrics(nonLegal))} |`);
md.push("");
md.push("Verified pass rate = Green ÷ (Green + Yellow + Red). Verification coverage = (Green + Yellow + Red) ÷ (Green + Yellow + Red + Blue). Overall verified applicable compliance = Green ÷ (Green + Yellow + Red + Blue). Gray is excluded; \"not available\" means the denominator is zero.");
md.push("");
md.push(`Critical findings: ${critical.length}. High-risk findings: ${high.length}. Requirements needing legal review: ${legalReview.length}.`);
md.push("");
md.push("## Scorecards");
md.push("");
md.push("| Scorecard | Result | Total | 🟢 | 🟡 | 🔴 | ⚪ | 🔵 | Verified pass rate | Coverage |");
md.push("|---|---|---|---|---|---|---|---|---|---|");
for (const c of cards) md.push(`| ${c.name} | ${c.result} | ${row(c.totals)} | ${pct(c.metrics.verified_pass_rate)} | ${pct(c.metrics.verification_coverage)} |`);
md.push("");
if (kind === "website") {
  md.push("## Pages");
  md.push("");
  md.push(`Discovered: ${meta.pages_discovered}. Tested: ${meta.pages_tested}. Excluded: ${(meta.pages_excluded || []).length}.`);
  md.push("");
}
const order = { RED: 0, YELLOW: 1, BLUE: 2, GREEN: 3, GRAY: 4 };
const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, informational: 4 };
const sorted = [...findings].sort((a, b) => order[a.status] - order[b.status] || sevOrder[a.severity] - sevOrder[b.severity]);
md.push("## Findings");
md.push("");
md.push("| Status | Severity | Requirement | Title | Actual | Remediation |");
md.push("|---|---|---|---|---|---|");
for (const f of sorted) {
  const r = reqOf(f);
  md.push(`| ${LABEL[f.status]} | ${f.severity} | ${f.requirement_id} | ${esc(r.title)} | ${esc(f.status_reason ? `${f.actual} (${f.status_reason})` : f.actual).slice(0, 300)} | ${esc(f.remediation).slice(0, 200)} |`);
}
md.push("");
md.push("## Limitations");
md.push("");
for (const l of meta.limitations || []) md.push(`- ${l}`);
fs.writeFileSync(path.join(dir, "report.md"), md.join("\n") + "\n");

// ---------- HTML dashboard (standalone, no external requests) ----------
const data = {
  meta: { ...meta, generated_at: report.generated_at, website_result: websiteResult },
  totals: all,
  metrics: metrics(all),
  legal: { totals: legal, metrics: metrics(legal) },
  standards: { totals: nonLegal, metrics: metrics(nonLegal) },
  scorecards: cards,
  findings: sorted.map((f) => {
    const r = reqOf(f);
    return { ...f, title: r.title, citation: r.citation, source: r.official_source_url, jurisdiction: r.jurisdiction, category: r.category, register: r.register, type: r.requirement_type };
  }),
};
const template = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "templates", "dashboard.html"), "utf8");
const html = template.replace("/*__DATA__*/null", JSON.stringify(data).replace(/</g, "\\u003c"));
fs.writeFileSync(path.join(dir, "dashboard.html"), html);
console.log(`✓ ${findings.length} findings → ${path.join(dir, "report.md")}, report.json, dashboard.html`);

// ---------- History index (one entry per audit; an audit re-generated replaces its own entry) ----------
const historyFile = path.join(path.dirname(path.resolve(dir)), "history.json");
const history = fs.existsSync(historyFile) ? readJson(historyFile) : { description: "Index of audits in this folder, oldest first. Each audit folder keeps its own report; nothing here is overwritten except an audit's own entry when its report is regenerated.", audits: [] };
const entry = {
  audit_id: meta.audit_id,
  folder: path.basename(path.resolve(dir)),
  started_at: meta.started_at,
  generated_at: report.generated_at,
  git_commit: meta.git_commit || null,
  legal_baseline_version: meta.legal_baseline_version,
  result: websiteResult || (all.RED ? "Not ready: verified failures present" : all.BLUE ? "Incomplete: unverified requirements remain" : "No verified failures"),
  totals: all,
  metrics: metrics(all),
  critical_findings: report.critical_findings.length,
};
history.audits = history.audits.filter((a) => a.audit_id !== entry.audit_id).concat(entry).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
fs.writeFileSync(historyFile, JSON.stringify(history, null, 2) + "\n");
console.log(`✓ history → ${historyFile}`);
