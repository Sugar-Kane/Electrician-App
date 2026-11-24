#!/usr/bin/env node
/**
 * Check .claude/COMMANDS.md against the skills on disk.
 *
 * Every row with status "Installed" and scope "project" must have .claude/skills/<name>/SKILL.md
 * whose frontmatter has that name and a description; every project skill folder must have a row.
 * Rows for global (user-level) skills are checked against ~/.claude/skills when that folder
 * exists, and reported as "not checkable here" otherwise.
 *
 *   node compliance/scripts/verify-command-registry.mjs [--repo DIR]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMPLIANCE_DIR } from "./lib.mjs";

const repo = process.argv.includes("--repo") ? path.resolve(process.argv[process.argv.indexOf("--repo") + 1]) : path.resolve(COMPLIANCE_DIR, "..");
const registryFile = path.join(repo, ".claude", "COMMANDS.md");
const skillsDir = path.join(repo, ".claude", "skills");
const problems = [];
const notes = [];

if (!fs.existsSync(registryFile)) {
  console.error(`✗ ${registryFile} not found`);
  process.exit(1);
}
const md = fs.readFileSync(registryFile, "utf8");
// Index table rows: | `/name` | status | scope | ...
const rows = [...md.matchAll(/^\|\s*`\/([a-z0-9-]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gim)].map((m) => ({ name: m[1], status: m[2].trim(), scope: m[3].trim().toLowerCase() }));

function frontmatter(file) {
  const text = fs.readFileSync(file, "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-z-]+):\s*(.*)$/i);
    if (kv) fm[kv[1]] = kv[2].replace(/^"|"$/g, "");
  }
  return fm;
}

const projectSkills = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir).filter((d) => fs.existsSync(path.join(skillsDir, d, "SKILL.md"))) : [];
const userSkillsDir = path.join(os.homedir(), ".claude", "skills");

for (const row of rows) {
  if (!/installed/i.test(row.status)) continue;
  if (row.scope.startsWith("built-in")) continue;
  const base = row.scope.startsWith("global") ? userSkillsDir : skillsDir;
  if (row.scope.startsWith("global") && !fs.existsSync(userSkillsDir)) {
    notes.push(`/${row.name}: global; ${userSkillsDir} not present on this machine, not checkable here`);
    continue;
  }
  const file = path.join(base, row.name, "SKILL.md");
  if (!fs.existsSync(file)) {
    problems.push(`/${row.name}: marked Installed (${row.scope}) but ${file} does not exist`);
    continue;
  }
  const fm = frontmatter(file);
  if (!fm) problems.push(`/${row.name}: ${file} has no frontmatter`);
  else {
    if (fm.name !== row.name) problems.push(`/${row.name}: frontmatter name is "${fm.name}"`);
    if (!fm.description || fm.description.length < 20) problems.push(`/${row.name}: frontmatter description missing or too short`);
  }
}
for (const dir of projectSkills) {
  if (!rows.some((r) => r.name === dir)) problems.push(`.claude/skills/${dir} has no row in COMMANDS.md`);
}

for (const n of notes) console.log(`- ${n}`);
if (problems.length) {
  console.log(`✗ ${problems.length} problem(s):`);
  for (const p of problems) console.log(`   ${p}`);
  process.exit(1);
}
console.log(`✓ ${rows.length} registry rows checked; ${projectSkills.length} project skills all listed`);
