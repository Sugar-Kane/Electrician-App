#!/usr/bin/env node
/**
 * Validate every requirement register against the requirement schema and check that IDs are
 * unique, statuses are not stored in registers, unverified sources are flagged, and
 * recommended controls are not labelled as law.
 *
 *   node compliance/scripts/validate-requirements.mjs [--registry DIR]
 * Exit code 1 when any register has problems.
 */
import path from "node:path";
import { REGISTERS, REGISTRY_DIR, SCHEMA_DIR, loadRegister, readJson, validate } from "./lib.mjs";

const i = process.argv.indexOf("--registry");
const dir = i > -1 ? path.resolve(process.argv[i + 1]) : REGISTRY_DIR;
const schema = readJson(path.join(SCHEMA_DIR, "requirement.schema.json"));

const ids = new Map();
let failures = 0;
let total = 0;
for (const name of REGISTERS) {
  const reg = loadRegister(name, dir);
  if (!reg) {
    console.log(`- ${name}: missing`);
    failures += 1;
    continue;
  }
  const problems = [];
  if (reg.register !== name) problems.push(`register field is "${reg.register}", expected "${name}"`);
  if (!reg.baseline_version) problems.push("no baseline_version");
  const list = Array.isArray(reg.requirements) ? reg.requirements : [];
  if (!list.length) problems.push("no requirements");
  let unverified = 0;
  for (const r of list) {
    const where = r.id || "(no id)";
    problems.push(...validate(r, schema, where));
    if (r.register && r.register !== name) problems.push(`${where}: register "${r.register}" in ${name}.json`);
    if (ids.has(r.id)) problems.push(`${where}: duplicate ID (also in ${ids.get(r.id)})`);
    ids.set(r.id, name);
    if ("status" in r) problems.push(`${where}: registers must not hold a status`);
    if (r.source_verified === false) {
      unverified += 1;
      if (r.last_verified) problems.push(`${where}: unverified source must have an empty last_verified`);
    } else if (r.source_verified === true && (!r.official_source_url || !/^\d{4}-\d{2}-\d{2}$/.test(r.last_verified || ""))) {
      problems.push(`${where}: verified source needs official_source_url and a YYYY-MM-DD last_verified`);
    }
    if (["recommended-control", "technical-standard"].includes(r.requirement_type) && ["Federal", "California"].includes(r.jurisdiction) && /standard|owasp|nist|cis|wcag/i.test(r.citation || "")) {
      problems.push(`${where}: a standard is filed under a legal jurisdiction`);
    }
  }
  total += list.length;
  if (problems.length) {
    failures += 1;
    console.log(`✗ ${name}: ${list.length} requirements, ${problems.length} problem(s)`);
    for (const p of problems.slice(0, 25)) console.log(`    ${p}`);
    if (problems.length > 25) console.log(`    ... and ${problems.length - 25} more`);
  } else {
    console.log(`✓ ${name}: ${list.length} requirements (${unverified} with unverified sources)`);
  }
}
console.log(`\n${total} requirements across ${REGISTERS.length} registers; ${failures ? `${failures} register(s) with problems` : "all valid"}`);
process.exit(failures ? 1 : 0);
