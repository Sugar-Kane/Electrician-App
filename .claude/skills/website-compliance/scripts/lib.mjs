/**
 * Shared helpers for the compliance scripts. Node only, no dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COMPLIANCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REGISTRY_DIR = path.join(COMPLIANCE_DIR, "registry");
export const SCHEMA_DIR = path.join(COMPLIANCE_DIR, "schemas");

export const REGISTERS = [
  "federal",
  "california",
  "california-contractors",
  "website-federal",
  "website-california",
  "website-contractors",
  "website-accessibility",
  "website-security",
  "application-security",
];

export const STATUSES = ["GREEN", "YELLOW", "RED", "GRAY", "BLUE"];
export const LABEL = { GREEN: "🟢 GREEN", YELLOW: "🟡 YELLOW", RED: "🔴 RED", GRAY: "⚪ GRAY", BLUE: "🔵 BLUE" };

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function loadRegister(name, dir = REGISTRY_DIR) {
  const file = path.join(dir, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  return readJson(file);
}

export function loadAllRequirements(dir = REGISTRY_DIR) {
  const all = new Map();
  for (const name of REGISTERS) {
    const reg = loadRegister(name, dir);
    if (!reg) continue;
    for (const r of reg.requirements || []) all.set(r.id, r);
  }
  return all;
}

/**
 * A small validator for the JSON Schema subset these schemas use: type, required, enum,
 * pattern, minLength, minItems, items, properties, additionalProperties:false. Returns a
 * list of problems; empty means valid.
 */
export function validate(value, schema, at = "$") {
  const problems = [];
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : null;
  const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
  if (types) {
    const t = typeOf(value);
    const ok = types.some((want) => want === t || (want === "number" && (t === "integer" || t === "number")));
    if (!ok) return [`${at}: expected ${types.join("|")}, got ${t}`];
  }
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.join(", ")}`);
  if (typeof value === "string") {
    if (schema.minLength && value.length < schema.minLength) problems.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) problems.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) problems.push(`${at}: needs at least ${schema.minItems} item(s)`);
    if (schema.items) value.forEach((v, i) => problems.push(...validate(v, schema.items, `${at}[${i}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!(key in value)) problems.push(`${at}: missing required "${key}"`);
    const props = schema.properties || {};
    for (const [key, v] of Object.entries(value)) {
      if (props[key]) problems.push(...validate(v, props[key], `${at}.${key}`));
      else if (schema.additionalProperties === false) problems.push(`${at}: unexpected property "${key}"`);
    }
  }
  return problems;
}

export function totals(findings) {
  const t = { GREEN: 0, YELLOW: 0, RED: 0, GRAY: 0, BLUE: 0, total: findings.length };
  for (const f of findings) t[f.status] += 1;
  return t;
}

/** The three audit metrics; null when the denominator is zero. GRAY never counts. */
export function metrics(t) {
  const ratio = (num, den) => (den === 0 ? null : Math.round((num / den) * 1000) / 10);
  const assessed = t.GREEN + t.YELLOW + t.RED;
  return {
    verified_pass_rate: ratio(t.GREEN, assessed),
    verification_coverage: ratio(assessed, assessed + t.BLUE),
    overall_verified_applicable_compliance: ratio(t.GREEN, assessed + t.BLUE),
  };
}

export function pct(value) {
  return value === null ? "not available" : `${value}%`;
}
