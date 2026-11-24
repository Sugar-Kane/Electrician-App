#!/usr/bin/env node
/**
 * Start a legal refresh: snapshot the current registers as a dated baseline, list what needs
 * re-checking, and (with --diff) compare two baselines. The actual reading of official sources
 * is done by the compliance skills with web access; this script never overwrites a baseline.
 *
 *   node compliance/scripts/refresh-legal-requirements.mjs snapshot          copy registry → legal-history/<date>/
 *   node compliance/scripts/refresh-legal-requirements.mjs worklist [--days 90]   what to re-verify
 *   node compliance/scripts/refresh-legal-requirements.mjs diff <old dir> <new dir>   regulatory change report
 */
import fs from "node:fs";
import path from "node:path";
import { COMPLIANCE_DIR, REGISTERS, REGISTRY_DIR, loadRegister } from "./lib.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const HISTORY = path.join(COMPLIANCE_DIR, "legal-history");
const today = new Date().toISOString().slice(0, 10);

function load(dir) {
  const map = new Map();
  for (const name of REGISTERS) for (const r of loadRegister(name, dir)?.requirements || []) map.set(r.id, r);
  return map;
}

if (cmd === "snapshot") {
  const target = path.join(HISTORY, today);
  if (fs.existsSync(target)) {
    console.error(`${target} already exists; baselines are never overwritten. Use a new date or suffix.`);
    process.exit(1);
  }
  fs.mkdirSync(target, { recursive: true });
  for (const name of REGISTERS) {
    const src = path.join(REGISTRY_DIR, `${name}.json`);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(target, `${name}.json`));
  }
  console.log(`baseline snapshot → ${target}`);
} else if (cmd === "worklist") {
  const days = rest.includes("--days") ? Number(rest[rest.indexOf("--days") + 1]) : 90;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const items = [...load(REGISTRY_DIR).values()].filter((r) => !r.source_verified || !r.last_verified || r.last_verified < cutoff || ["future-effective", "pending-legislation"].includes(r.requirement_type));
  const byHost = {};
  for (const r of items) {
    let host = "(no source URL)";
    try { host = new URL(r.official_source_url).hostname; } catch { /* keep */ }
    (byHost[host] ||= []).push({ id: r.id, citation: r.citation, url: r.official_source_url, why: !r.source_verified ? "never verified" : r.last_verified < cutoff ? `last verified ${r.last_verified}` : r.requirement_type });
  }
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), stale_after_days: days, count: items.length, by_source_host: byHost }, null, 2));
} else if (cmd === "diff") {
  const [oldDir, newDir] = rest.map((p) => path.resolve(p));
  const a = load(oldDir);
  const b = load(newDir);
  const changed = [];
  const fields = ["citation", "official_source_url", "effective_date", "requirement_type", "required_behavior", "applicability", "risk_severity", "source_verified"];
  for (const [id, r] of b) {
    const prev = a.get(id);
    if (!prev) continue;
    const diffs = fields.filter((f) => JSON.stringify(prev[f]) !== JSON.stringify(r[f]));
    if (diffs.length) changed.push({ id, fields: diffs });
  }
  const report = {
    generated_at: new Date().toISOString(),
    old_baseline: oldDir,
    new_baseline: newDir,
    added: [...b.keys()].filter((id) => !a.has(id)),
    removed_or_repealed: [...a.keys()].filter((id) => !b.has(id)),
    changed,
    future_effective: [...b.values()].filter((r) => r.requirement_type === "future-effective").map((r) => ({ id: r.id, effective_date: r.effective_date })),
    needs_legal_interpretation: [...b.values()].filter((r) => r.legal_review_required).map((r) => r.id),
  };
  console.log(JSON.stringify(report, null, 2));
} else {
  console.error("usage: refresh-legal-requirements.mjs snapshot | worklist [--days N] | diff <old> <new>");
  process.exit(2);
}
