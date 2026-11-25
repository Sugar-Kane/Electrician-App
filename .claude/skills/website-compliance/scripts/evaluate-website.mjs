#!/usr/bin/env node
/**
 * Turn one website's observations.json into findings, one per requirement in the website
 * registers. Browser-observable checks become GREEN/YELLOW/RED with the observation as
 * evidence. Requirements a browser cannot settle become BLUE (with the reason), and those
 * whose applicability cannot be decided from outside are BLUE with legal review flagged, never
 * GREEN.
 *
 *   node compliance/scripts/evaluate-website.mjs <run-dir> [--registry DIR] [--profile contractor|saas|generic]
 * Writes <run-dir>/findings.json and <run-dir>/meta.json.
 */
import fs from "node:fs";
import path from "node:path";
import { REGISTRY_DIR, loadRegister } from "./lib.mjs";

const runDir = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(path.join(runDir, "observations.json"))) {
  console.error("usage: evaluate-website.mjs <run-dir containing observations.json> [--registry DIR] [--profile contractor|saas|generic]");
  process.exit(2);
}
const argv = process.argv;
const registryDir = argv.includes("--registry") ? path.resolve(argv[argv.indexOf("--registry") + 1]) : REGISTRY_DIR;
const obs = JSON.parse(fs.readFileSync(path.join(runDir, "observations.json"), "utf8"));
const pages = obs.pages || [];
const home = pages[0];
const auditId = `WEB-${obs.domain}-${(obs.started_at || "").slice(0, 10)}`;
// A contractor site advertises its own licence (a printed number) or calls itself a licensed
// contractor. Software sold to contractors mentions trades too, so trade words alone don't count.
const looksContractor = pages.some((p) => (p.licenseMentions || []).some((m) => /\d{6,7}/.test(m)) || /\b(licensed|our) (electrical |general )?contractors?\b|\bC-?10 (licen|electrical)/i.test(p.textSample || ""));
const profile = argv.includes("--profile") ? argv[argv.indexOf("--profile") + 1] : looksContractor ? "contractor" : "generic";
const collectsPhone = pages.some((p) => (p.forms || []).some((f) => f.hasPhone));
const collectsPersonalInfo = pages.some((p) => (p.forms || []).some((f) => f.fields.some((x) => /email|phone|tel|name|address/i.test(`${x.type} ${x.name} ${x.label}`))));
const offersSubscription = pages.some((p) => (p.subscriptionMentions || []).length);
const now = new Date().toISOString();

const ev = (location, method, limitations = "") => ({ type: "network-observation", location, collected_at: obs.finished_at || now, method, limitations });
const pageList = (fn) => pages.filter(fn).map((p) => p.url);

// ---------- automated checks: return {status, actual, evidence[], pages[]} or null (not decidable) ----------
const header = (name) => pages.map((p) => p.headers?.[name] || "");
const allHave = (name, test = (v) => !!v) => pages.length > 0 && header(name).every(test);

function wcagFromAxe() {
  // Map axe results to WCAG success criteria via their tags (wcag111 -> 1.1.1).
  const bySc = new Map();
  for (const p of pages) {
    for (const v of p.axe?.violations || []) {
      for (const tag of v.tags) {
        const m = tag.match(/^wcag(\d)(\d)(\d+)$/);
        if (!m) continue;
        const sc = `${m[1]}.${m[2]}.${m[3]}`;
        const entry = bySc.get(sc) || { violations: [], pages: new Set() };
        entry.violations.push(`${v.id} (${v.impact}, ${v.nodes} element(s)) on ${p.url}`);
        entry.pages.add(p.url);
        bySc.set(sc, entry);
      }
    }
  }
  return bySc;
}
const axeBySc = wcagFromAxe();
const axeRan = pages.some((p) => p.axe);
const scOf = (id) => {
  const m = id.match(/^WCAG-(\d)(\d{2})-(\d{3})$/);
  return m ? `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}` : null;
};

const checks = {
  "https-redirect": () => {
    const h = obs.http_redirect || {};
    if (h.error) return null;
    const ok = [301, 302, 307, 308].includes(h.status) && /^https:/i.test(h.location || "");
    return { status: ok ? "GREEN" : "RED", actual: `http:// answered ${h.status} → ${h.location || "(no redirect)"}`, evidence: [ev("observations.json#http_redirect", "HTTP request without following redirects")] };
  },
  hsts: () => (pages.length ? { status: allHave("strict-transport-security", (v) => /max-age=\d{6,}/.test(v)) ? "GREEN" : header("strict-transport-security").some(Boolean) ? "YELLOW" : "RED", actual: `Strict-Transport-Security: ${[...new Set(header("strict-transport-security"))].join(" | ") || "absent"}`, evidence: [ev("observations.json#pages[].headers", "response headers of crawled pages")] } : null),
  csp: () => {
    if (!pages.length) return null;
    const enforced = header("content-security-policy");
    const reportOnly = pages.map((p) => p.headers?.["content-security-policy-report-only"] || "");
    const status = enforced.every(Boolean) ? (enforced.some((v) => /script-src[^;]*'unsafe-inline'/.test(v) && !/nonce-|strict-dynamic/.test(v)) ? "YELLOW" : "GREEN") : reportOnly.some(Boolean) ? "YELLOW" : "RED";
    return { status, actual: enforced.some(Boolean) ? "enforced CSP present" : reportOnly.some(Boolean) ? "report-only CSP only" : "no CSP", evidence: [ev("observations.json#pages[].headers", "response headers")] };
  },
  "frame-protection": () => (pages.length ? { status: pages.every((p) => p.headers?.["x-frame-options"] || /frame-ancestors/.test(p.headers?.["content-security-policy"] || "")) ? "GREEN" : "RED", actual: "X-Frame-Options / CSP frame-ancestors per page", evidence: [ev("observations.json#pages[].headers", "response headers")] } : null),
  nosniff: () => (pages.length ? { status: allHave("x-content-type-options", (v) => /nosniff/i.test(v)) ? "GREEN" : "RED", actual: `X-Content-Type-Options: ${[...new Set(header("x-content-type-options"))].join(" | ") || "absent"}`, evidence: [ev("observations.json#pages[].headers", "response headers")] } : null),
  "referrer-policy": () => (pages.length ? { status: allHave("referrer-policy") ? "GREEN" : "YELLOW", actual: `Referrer-Policy: ${[...new Set(header("referrer-policy"))].join(" | ") || "absent (browser default strict-origin-when-cross-origin)"}`, evidence: [ev("observations.json#pages[].headers", "response headers")] } : null),
  "permissions-policy": () => (pages.length ? { status: allHave("permissions-policy") ? "GREEN" : "YELLOW", actual: header("permissions-policy").some(Boolean) ? "present" : "absent", evidence: [ev("observations.json#pages[].headers", "response headers")] } : null),
  "mixed-content": () => (pages.length ? { status: pages.some((p) => (p.mixedContent || []).length) ? "RED" : "GREEN", actual: `${pages.reduce((n, p) => n + (p.mixedContent || []).length, 0)} insecure sub-resource(s)`, pages: pageList((p) => (p.mixedContent || []).length), evidence: [ev("observations.json#pages[].mixedContent", "DOM inspection")] } : null),
  "cookie-flags": () => {
    const cookies = pages.flatMap((p) => p.cookies || []);
    if (!cookies.length) return { status: "GREEN", actual: "no cookies set on public pages", evidence: [ev("observations.json#pages[].cookies", "browser cookie jar")] };
    const weak = cookies.filter((c) => !c.secure || c.sameSite === "None" && !c.secure);
    return { status: weak.length ? "YELLOW" : "GREEN", actual: `${cookies.length} cookie(s); ${weak.length} without Secure`, evidence: [ev("observations.json#pages[].cookies", "browser cookie jar")] };
  },
  "server-banner": () => (pages.length ? { status: pages.some((p) => p.headers?.["x-powered-by"]) ? "YELLOW" : "GREEN", actual: `X-Powered-By: ${[...new Set(header("x-powered-by"))].join(" | ") || "absent"}`, evidence: [ev("observations.json#pages[].headers", "response headers")] } : null),
  tls: () => (obs.tls?.validTo ? { status: obs.tls.validTo * 1000 > Date.now() + 14 * 86400000 ? "GREEN" : "YELLOW", actual: `${obs.tls.protocol || "TLS"}; certificate valid to ${new Date(obs.tls.validTo * 1000).toISOString().slice(0, 10)}; issuer ${obs.tls.issuer || "?"}`, evidence: [ev("observations.json#tls", "browser security details")] } : null),
  "privacy-link": () => (pages.length ? { status: pages.every((p) => (p.privacyLinks || []).length) ? "GREEN" : (home?.privacyLinks || []).length ? "YELLOW" : "RED", actual: `privacy link on ${pages.filter((p) => (p.privacyLinks || []).length).length}/${pages.length} crawled pages`, pages: pageList((p) => !(p.privacyLinks || []).length), evidence: [ev("observations.json#pages[].privacyLinks", "DOM link text/href")] } : null),
  "accessibility-statement": () => (home ? { status: pages.some((p) => (p.accessibilityLinks || []).length) ? "GREEN" : "YELLOW", actual: pages.some((p) => (p.accessibilityLinks || []).length) ? "accessibility page linked" : "no accessibility statement or contact found", evidence: [ev("observations.json#pages[].accessibilityLinks", "DOM link text/href")] } : null),
  "gpc-honored": () => {
    const t = obs.tracking || {};
    if (!t.fresh || !t.gpc) return null;
    const extra = t.gpc.thirdPartyHosts.filter((h) => t.fresh.thirdPartyHosts.includes(h));
    if (!t.fresh.thirdPartyHosts.length) return { status: "GRAY", reason: "No third-party requests observed on a fresh visit, so there is nothing for GPC to stop.", actual: "no third-party requests on a fresh visit", evidence: [ev("observations.json#tracking", "fresh vs GPC browser contexts")] };
    return { status: extra.length === t.fresh.thirdPartyHosts.length ? "YELLOW" : "GREEN", actual: `fresh visit contacted ${t.fresh.thirdPartyHosts.length} third-party host(s); with GPC ${t.gpc.thirdPartyHosts.length}`, evidence: [ev("observations.json#tracking", "fresh vs GPC browser contexts", "Whether those hosts are a sale/share under CCPA needs review of their purpose.")] };
  },
  "phone-consent": () => {
    if (!collectsPhone) return { status: "GRAY", reason: "No form on the crawled pages asks for a phone number.", actual: "no phone fields found", evidence: [ev("observations.json#pages[].forms", "DOM form inspection")] };
    const forms = pages.flatMap((p) => (p.forms || []).filter((f) => f.hasPhone).map((f) => ({ url: p.url, f })));
    const good = forms.filter(({ f }) => /stop/i.test(f.consentText) && /(rate|frequency)/i.test(f.consentText));
    return { status: good.length === forms.length ? "YELLOW" : "RED", actual: `${good.length}/${forms.length} phone form(s) show STOP and rates wording near the field`, pages: forms.map((x) => x.url), evidence: [ev("observations.json#pages[].forms[].consentText", "DOM form text", "Wording on the page is necessary but not sufficient; whether consent is recorded and enforced is a backend question, so at best YELLOW from outside.")] };
  },
  "license-in-advertising": () => {
    if (profile !== "contractor") return { status: "GRAY", reason: "The site does not appear to advertise contracting services.", actual: "not a contractor site", evidence: [ev("observations.json#pages[].textSample", "page text")] };
    const withLicense = pages.filter((p) => (p.licenseMentions || []).some((m) => /\d{6,7}/.test(m)));
    return { status: withLicense.length === pages.length ? "GREEN" : withLicense.length ? "YELLOW" : "RED", actual: `licence number shown on ${withLicense.length}/${pages.length} pages: ${[...new Set(pages.flatMap((p) => p.licenseMentions || []))].slice(0, 3).join("; ") || "none"}`, pages: pageList((p) => !(p.licenseMentions || []).some((m) => /\d{6,7}/.test(m))), evidence: [ev("observations.json#pages[].licenseMentions", "page text", "Whether the number is active and matches the business name needs the CSLB record.")] };
  },
  "page-title": () => (pages.length ? { status: pages.every((p) => (p.title || "").trim()) ? "GREEN" : "RED", actual: `${pages.filter((p) => !(p.title || "").trim()).length} page(s) without a title`, pages: pageList((p) => !(p.title || "").trim()), evidence: [ev("observations.json#pages[].title", "DOM")] } : null),
  "page-lang": () => (pages.length ? { status: pages.every((p) => p.lang) ? "GREEN" : "RED", actual: `${pages.filter((p) => !p.lang).length} page(s) without a language`, pages: pageList((p) => !p.lang), evidence: [ev("observations.json#pages[].lang", "DOM <html lang>")] } : null),
  "keyboard-focus-visible": () => {
    const kb = pages.filter((p) => p.keyboard);
    if (!kb.length) return null;
    const bad = kb.filter((p) => p.keyboard.withoutVisibleIndicator.length);
    return { status: bad.length ? "YELLOW" : "GREEN", actual: `${bad.length}/${kb.length} pages had focus targets with no outline or shadow on focus`, pages: bad.map((p) => p.url), evidence: [ev("observations.json#pages[].keyboard", "Tab walk with computed focus styles", "Heuristic: a colour or underline change may still be a visible indicator; confirm by eye.")] };
  },
  "keyboard-trap": () => {
    const kb = pages.filter((p) => p.keyboard);
    if (!kb.length) return null;
    const traps = kb.filter((p) => p.keyboard.possibleTrap);
    return { status: traps.length ? "RED" : "GREEN", actual: `${traps.length} page(s) where Tab cycled within two elements`, pages: traps.map((p) => p.url), evidence: [ev("observations.json#pages[].keyboard", "40-step Tab walk")] };
  },
  reflow: () => {
    const vps = pages.flatMap((p) => (p.viewports || []).filter((v) => v.viewport.startsWith("mobile")).map((v) => ({ url: p.url, v })));
    if (!vps.length) return null;
    const bad = vps.filter((x) => x.v.horizontalOverflow);
    return { status: bad.length ? "RED" : "GREEN", actual: `${bad.length}/${vps.length} key page(s) scroll sideways at 390px wide`, pages: bad.map((x) => x.url), evidence: vps.map((x) => ({ type: "screenshot", location: x.v.screenshot, collected_at: obs.finished_at || now, method: "Playwright 390x844" })) };
  },
  bypass: () => (pages.length ? { status: pages.every((p) => p.skipLink || p.landmarks?.main) ? "GREEN" : "YELLOW", actual: `${pages.filter((p) => !(p.skipLink || p.landmarks?.main)).length} page(s) without a skip link or main landmark`, evidence: [ev("observations.json#pages[].landmarks", "DOM")] } : null),
  "target-size": () => {
    const kb = pages.filter((p) => p.keyboard);
    if (!kb.length) return null;
    const small = kb.flatMap((p) => p.keyboard.smallTargets);
    return { status: small.length ? "YELLOW" : "GREEN", actual: `${small.length} focusable target(s) under 24×24 px (spacing exceptions not evaluated)`, evidence: [ev("observations.json#pages[].keyboard.smallTargets", "bounding boxes during Tab walk", "SC 2.5.8 has spacing and inline exceptions a script cannot judge.")] };
  },
};

// Which check settles which requirement: by title keywords, so the map survives ID changes.
const CHECK_BY_KEYWORD = [
  [/https|redirect.*http|encrypt.*transit/i, "https-redirect"],
  [/strict.transport|hsts/i, "hsts"],
  [/content.security.policy|\bcsp\b/i, "csp"],
  [/clickjack|frame-ancestors|x-frame/i, "frame-protection"],
  [/mime|nosniff|content-type-options/i, "nosniff"],
  [/referrer/i, "referrer-policy"],
  [/permissions.policy/i, "permissions-policy"],
  [/mixed content/i, "mixed-content"],
  [/cookie.*(secure|httponly|samesite|attribute)/i, "cookie-flags"],
  [/(server|technology|version).*(banner|disclos|header)|x-powered-by|debug/i, "server-banner"],
  [/tls|certificate/i, "tls"],
  [/conspicuous.*privacy|privacy (policy )?link|post.*privacy policy/i, "privacy-link"],
  [/global privacy control|\bgpc\b/i, "gpc-honored"],
  [/(sms|text|tcpa).*(consent|disclos)|consent.*(phone|text|sms)/i, "phone-consent"],
  [/license number|licen[cs]e.*(advertis|display)|7030\.5/i, "license-in-advertising"],
  [/accessibility (statement|contact|information)/i, "accessibility-statement"],
];

function evaluate(req) {
  const base = {
    finding_id: `F-${req.id}-${obs.domain.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 20)}`,
    requirement_id: req.id,
    audit_id: auditId,
    target: obs.domain,
    severity: req.risk_severity,
    responsible_party: req.responsible_parties.join(", "),
    expected: req.required_behavior.join(" "),
    legal_review_required: req.legal_review_required,
  };
  if (!pages.length) {
    return { ...base, status: "BLUE", status_reason: "The site could not be loaded from the audit environment.", confidence: "high", actual: (obs.errors || []).join("; ") || "no pages loaded", evidence: [ev("observations.json#errors", "page load")], remediation: "Re-run from an environment that can reach the site.", test_result: "not-run", priority: "none" };
  }
  // Applicability decided from what the site shows.
  if (req.register === "website-contractors" && profile !== "contractor") {
    return { ...base, status: "GRAY", status_reason: "The site does not advertise contracting services.", confidence: "medium", actual: "no contractor licence wording or trade services found", evidence: [ev("observations.json#pages[].textSample", "page text")], remediation: "None.", test_result: "not-applicable", priority: "none" };
  }
  if (/subscription|auto.?renew|negative option|rosca|17600/i.test(`${req.title} ${req.citation}`) && !offersSubscription) {
    return { ...base, status: "GRAY", status_reason: "No subscription or recurring charge is offered on the crawled pages.", confidence: "medium", actual: "no recurring-price wording found", evidence: [ev("observations.json#pages[].subscriptionMentions", "page text")], remediation: "None.", test_result: "not-applicable", priority: "none" };
  }

  let check = null;
  if (req.register === "website-accessibility") {
    const sc = scOf(req.id);
    const special = { "3.1.1": "page-lang", "2.4.2": "page-title", "2.4.7": "keyboard-focus-visible", "2.1.2": "keyboard-trap", "1.4.10": "reflow", "2.4.1": "bypass", "2.5.8": "target-size" }[sc];
    if (special) check = checks[special]();
    if (!check && sc && axeRan) {
      const hit = axeBySc.get(sc);
      if (hit) check = { status: "RED", actual: hit.violations.slice(0, 5).join("; "), pages: [...hit.pages], evidence: [{ type: "test-result", location: "observations.json#pages[].axe", collected_at: obs.finished_at || now, method: `axe-core ${obs.axe_version}` }] };
      else if (check === null) check = { status: "BLUE", reason: `axe-core found no violation for SC ${sc}, which is not proof of conformance; manual and assistive-technology review is required.`, actual: "no automated violations", evidence: [{ type: "test-result", location: "observations.json#pages[].axe", collected_at: obs.finished_at || now, method: `axe-core ${obs.axe_version}`, limitations: "Automated scans alone never support GREEN." }] };
    } else if (check && sc && axeBySc.get(sc) && check.status === "GREEN") {
      const hit = axeBySc.get(sc);
      check = { status: "RED", actual: hit.violations.slice(0, 5).join("; "), pages: [...hit.pages], evidence: check.evidence };
    }
  } else {
    const hit = CHECK_BY_KEYWORD.find(([re]) => re.test(`${req.title} ${req.category}`));
    if (hit) check = checks[hit[1]]();
  }

  if (check) {
    const reason = check.reason || (check.status === "BLUE" ? check.actual : undefined);
    return {
      ...base,
      status: req.source_verified === false && check.status === "GREEN" ? "BLUE" : check.status,
      status_reason: req.source_verified === false && check.status === "GREEN" ? "Observed behaviour passes, but the requirement's official source was not verified in this baseline." : reason,
      confidence: check.status === "BLUE" ? "medium" : "high",
      actual: check.actual,
      affected_pages: check.pages || [],
      evidence: check.evidence,
      test_ids: [],
      test_result: check.status === "GREEN" ? "passed" : check.status === "RED" ? "failed" : "not-applicable",
      remediation: check.status === "GREEN" || check.status === "GRAY" ? "None." : `Meet: ${req.required_behavior[0]}`,
      priority: check.status === "RED" ? (["critical", "high"].includes(req.risk_severity) ? "P1" : "P2") : check.status === "YELLOW" ? "P3" : "none",
    };
  }
  const backend = req.backend_verification_required || !req.website_verifiable;
  return {
    ...base,
    status: "BLUE",
    status_reason: backend
      ? "Needs evidence a browser cannot see (records, server behaviour or business facts)."
      : req.legal_review_required
        ? "Applicability or wording needs legal review; not settled by an automated check."
        : "Needs a manual review of page content; no automated check settles it.",
    confidence: "high",
    actual: "not assessed automatically",
    evidence: [],
    test_result: "not-run",
    remediation: "Verify manually or with the business's records.",
    priority: "none",
  };
}

const registers = ["website-federal", "website-california", "website-contractors", "website-accessibility", "website-security"];
const findings = [];
const missing = [];
for (const name of registers) {
  const reg = loadRegister(name, registryDir);
  if (!reg) {
    missing.push(name);
    continue;
  }
  for (const req of reg.requirements) findings.push(evaluate({ ...req, register: name }));
}

const meta = {
  audit_id: auditId,
  kind: "website",
  target: obs.domain,
  website_url: obs.target,
  started_at: obs.started_at,
  finished_at: obs.finished_at,
  environment: "public website (outside-in)",
  profile,
  collects_personal_info: collectsPersonalInfo,
  collects_phone: collectsPhone,
  offers_subscription: offersSubscription,
  legal_baseline_version: loadRegister("website-federal", registryDir)?.baseline_version || "unknown",
  skill_version: "website-compliance 1.0.0",
  tool_version: obs.tool_version,
  axe_version: obs.axe_version,
  pages_discovered: pages.length + (obs.excluded || []).length,
  pages_tested: pages.length,
  pages_excluded: obs.excluded || [],
  missing_registers: missing,
  limitations: [...(obs.limitations || []), ...(missing.length ? [`Registers missing: ${missing.join(", ")}`] : [])],
};
fs.writeFileSync(path.join(runDir, "findings.json"), JSON.stringify(findings, null, 2));
fs.writeFileSync(path.join(runDir, "meta.json"), JSON.stringify(meta, null, 2));
console.log(`${findings.length} findings for ${obs.domain} (${profile}) → ${path.join(runDir, "findings.json")}`);
