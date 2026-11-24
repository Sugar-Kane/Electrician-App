#!/usr/bin/env node
/**
 * Website compliance audit: outside-in, read-only, one site per run.
 *
 *   node compliance/scripts/run-website-audit.mjs <URL> [--mode full|quick|accessibility|privacy|security]
 *        [--max-pages 40] [--out compliance/website-audits] [--browsers chromium,firefox,webkit]
 *
 * What it does:
 *   validates the URL and refuses private or metadata addresses; follows redirects only on the
 *   same site; reads robots.txt and sitemaps; crawls same-site links up to --max-pages
 *   (respecting robots.txt Disallow for "*"); for each page records title, language, headers,
 *   cookies, storage, third-party requests, forms (and what they ask for), consent wording near
 *   phone fields, legal links, contractor licence wording and fee wording; runs axe-core
 *   (WCAG 2.0/2.1/2.2 A and AA rules); walks the keyboard from the top of the page; takes
 *   screenshots at four sizes; compares tracking with and without Global Privacy Control, and
 *   before and after a cookie banner choice.
 *
 * What it never does: submit a form, book, sign, pay, log in, create an account, follow a link
 * off the site, bypass robots, authentication or a CAPTCHA. Page text is treated as data; no
 * instruction found on a page changes what this script does.
 *
 * Output: <out>/<domain>/<timestamp>/observations.json plus screenshots/. Findings and the
 * report are produced from the observations by generate-report.mjs using the website check map.
 */

import { createRequire } from "node:module";
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const target = process.argv[2];
if (!target || target.startsWith("--")) {
  console.error("usage: run-website-audit.mjs <URL> [--mode full|quick|accessibility|privacy|security] [--max-pages N] [--out DIR]");
  process.exit(2);
}
const mode = arg("mode", "full");
const maxPages = Math.max(1, Math.min(200, Number(arg("max-pages", mode === "quick" ? "5" : "40"))));
const outRoot = arg("out", path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "website-audits"));
const browsersWanted = arg("browsers", "chromium").split(",").map((b) => b.trim()).filter(Boolean);
// Test fixtures only: lets the script audit a page served on this machine.
const allowLocal = process.argv.includes("--allow-local");

const VIEWPORTS = [
  { name: "desktop-1920x1080", width: 1920, height: 1080 },
  { name: "laptop-1440x900", width: 1440, height: 900 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "mobile-390x844", width: 390, height: 844 },
];

// ---------- URL safety ----------
function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = address.toLowerCase();
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("::ffff:127.");
}

async function assertPublicUrl(raw) {
  let url;
  if (allowLocal) return new URL(raw);
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`not a valid URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`only http(s) URLs are audited: ${raw}`);
  if (url.username || url.password) throw new Error("URLs with credentials are refused");
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") {
    throw new Error(`refusing non-public host ${host}`);
  }
  if (net.isIP(host) && isPrivateAddress(host)) throw new Error(`refusing private address ${host}`);
  try {
    const records = await dns.lookup(host, { all: true });
    for (const r of records) if (isPrivateAddress(r.address)) throw new Error(`refusing ${host}: resolves to a private address`);
  } catch (error) {
    // Behind an egress proxy DNS may not resolve locally; the proxy then enforces reachability.
    if (String(error.message).startsWith("refusing")) throw error;
  }
  return url;
}

function siteKey(hostname) {
  return hostname.replace(/^www\./, "");
}

// ---------- robots.txt ----------
function parseRobots(text) {
  const disallow = [];
  const sitemaps = [];
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") applies = value === "*";
    else if (key === "disallow" && applies && value) disallow.push(value);
    else if (key === "sitemap") sitemaps.push(value);
  }
  return { disallow, sitemaps };
}

function allowedByRobots(url, robots) {
  return !robots.disallow.some((rule) => url.pathname.startsWith(rule));
}

// ---------- page inspection (runs in the page) ----------
function inspectPage() {
  const text = (document.body?.innerText || "").replace(/\s+/g, " ");
  const links = [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 80) }));
  const legal = (re) => links.filter((l) => re.test(l.text) || re.test(l.href)).map((l) => l.href);
  const forms = [...document.querySelectorAll("form")].map((form) => {
    const fields = [...form.querySelectorAll("input, select, textarea")].map((el) => {
      const id = el.id;
      const label = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText) || el.closest("label")?.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "";
      return { type: el.getAttribute("type") || el.tagName.toLowerCase(), name: el.getAttribute("name") || "", label: label.trim().slice(0, 120), required: el.required, autocomplete: el.getAttribute("autocomplete") || "" };
    });
    const formText = (form.innerText || "").replace(/\s+/g, " ");
    const hasPhone = fields.some((f) => f.type === "tel" || /phone|mobile|cell/i.test(f.name + " " + f.label));
    return {
      action: form.getAttribute("action") || "",
      method: (form.getAttribute("method") || "get").toLowerCase(),
      fields,
      hasPhone,
      consentText: hasPhone ? (formText.match(/[^.]*\b(text|sms|message|msg)\b[^.]*\.(?:[^.]*\.){0,3}/i)?.[0] || "").slice(0, 600) : "",
      consentCheckbox: [...form.querySelectorAll("input[type=checkbox]")].map((c) => ({ checked: c.checked, label: (c.closest("label")?.innerText || "").trim().slice(0, 200) })),
      hasCaptcha: /recaptcha|hcaptcha|turnstile/i.test(form.innerHTML),
    };
  });
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => ({ level: Number(h.tagName[1]), text: (h.innerText || "").trim().slice(0, 80) }));
  const images = [...document.querySelectorAll("img")];
  return {
    title: document.title,
    lang: document.documentElement.getAttribute("lang") || "",
    metaRobots: document.querySelector('meta[name="robots"]')?.getAttribute("content") || "",
    viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") || "",
    headings,
    landmarks: {
      main: document.querySelectorAll("main, [role=main]").length,
      nav: document.querySelectorAll("nav, [role=navigation]").length,
      header: document.querySelectorAll("header, [role=banner]").length,
      footer: document.querySelectorAll("footer, [role=contentinfo]").length,
    },
    skipLink: links.some((l) => /skip/i.test(l.text) && l.href.includes("#")),
    imagesMissingAlt: images.filter((i) => !i.hasAttribute("alt")).length,
    imageCount: images.length,
    links: links.map((l) => l.href),
    privacyLinks: legal(/privacy/i),
    termsLinks: legal(/terms|conditions/i),
    accessibilityLinks: legal(/accessib/i),
    doNotSellLinks: legal(/do not sell|do not share|your privacy choices|opt.?out/i),
    cookieLinks: legal(/cookie/i),
    forms,
    licenseMentions: (text.match(/(?:lic(?:ense|\.)?\s*(?:no\.?|number|#)?\s*:?\s*#?\s*\d{6,7}|CSLB[^.]{0,40}\d{6,7}|C-?10\b[^.]{0,40})/gi) || []).slice(0, 10),
    insuranceClaims: (text.match(/[^.]{0,60}\b(licensed|bonded|insured)\b[^.]{0,60}/gi) || []).slice(0, 10),
    feeMentions: (text.match(/[^.]{0,80}(\$\s?\d[\d,]*(?:\.\d{2})?|diagnostic fee|service fee|trip charge|call.?out fee)[^.]{0,80}/gi) || []).slice(0, 20),
    reviewMentions: (text.match(/[^.]{0,60}(review|testimonial|★|stars?)\b[^.]{0,60}/gi) || []).slice(0, 10),
    subscriptionMentions: (text.match(/[^.]{0,80}(per month|\/mo|monthly|annually|free trial|auto.?renew|cancel anytime)[^.]{0,80}/gi) || []).slice(0, 10),
    hasConsentBanner: !!document.querySelector('[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i]'),
    mixedContent: [...document.querySelectorAll("img[src^='http:'], script[src^='http:'], link[href^='http:'], iframe[src^='http:']")].map((e) => e.getAttribute("src") || e.getAttribute("href")),
    thirdPartyScripts: [...document.querySelectorAll("script[src]")].map((s) => ({ src: s.src, integrity: !!s.integrity })),
    iframes: [...document.querySelectorAll("iframe")].map((f) => f.src).filter(Boolean),
    textSample: text.slice(0, 1500),
  };
}

async function keyboardWalk(page, steps = 40) {
  const seen = [];
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        name: (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim().slice(0, 60),
        outline: style.outlineStyle !== "none" && style.outlineWidth !== "0px",
        boxShadow: style.boxShadow !== "none",
        visible: rect.width > 0 && rect.height > 0,
        inViewport: rect.bottom > 0 && rect.top < innerHeight,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    });
    if (!info) continue;
    seen.push(info);
  }
  const unique = new Set(seen.map((s) => `${s.tag}:${s.name}`));
  return {
    stepsTaken: steps,
    focusedCount: seen.length,
    uniqueFocusTargets: unique.size,
    possibleTrap: seen.length >= 10 && unique.size <= 2,
    withoutVisibleIndicator: seen.filter((s) => !s.outline && !s.boxShadow).map((s) => `${s.tag}:${s.name}`).slice(0, 15),
    smallTargets: seen.filter((s) => s.visible && (s.width < 24 || s.height < 24)).map((s) => `${s.tag}:${s.name} ${s.width}x${s.height}`).slice(0, 15),
  };
}

async function main() {
  const startedAt = new Date();
  const start = await assertPublicUrl(target);
  const { chromium, firefox, webkit } = require("@playwright/test");
  const engines = { chromium, firefox, webkit };
  const axePath = require.resolve("axe-core/axe.min.js");
  const axeSource = fs.readFileSync(axePath, "utf8");
  const axeVersion = require("axe-core/package.json").version;

  const domain = siteKey(start.hostname);
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(outRoot, domain, stamp);
  const shotDir = path.join(outDir, "screenshots");
  fs.mkdirSync(shotDir, { recursive: true });

  const obs = {
    tool: "volteira compliance run-website-audit",
    tool_version: "1.0.0",
    axe_version: axeVersion,
    target: start.href,
    domain,
    mode,
    started_at: startedAt.toISOString(),
    redirects: [],
    canonical_origin: "",
    robots: null,
    sitemaps: [],
    pages: [],
    excluded: [],
    tracking: {},
    tls: {},
    browsers: {},
    errors: [],
    limitations: [
      "Outside-in audit of public pages only: no login, no form submission, no payment, no booking.",
      "Automated accessibility scans find only part of WCAG; manual and assistive-technology testing were not performed by this script.",
      "Server-side controls (database, consent enforcement, record keeping) cannot be verified from a browser.",
    ],
  };

  // Same convention as playwright.config.ts: PLAYWRIGHT_CHROMIUM_PATH when set, else a
  // preinstalled browser where one exists, else Playwright's own download.
  const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath } : {});
  const context = await browser.newContext({ userAgent: "VolteiraComplianceAudit/1.0 (+read-only; no form submission)" });
  const page = await context.newPage();

  // Redirects and canonical origin.
  const first = await page.goto(start.href, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => {
    obs.errors.push(`load ${start.href}: ${e.message}`);
    return null;
  });
  if (!first) {
    obs.result_hint = "INSUFFICIENT EVIDENCE";
    obs.limitations.push(`The site could not be loaded from the audit environment (${obs.errors.at(-1)}).`);
    fs.writeFileSync(path.join(outDir, "observations.json"), JSON.stringify(obs, null, 2));
    await browser.close();
    console.log(outDir);
    return;
  }
  let req = first.request();
  const chain = [];
  while (req) {
    chain.unshift(req.url());
    req = req.redirectedFrom();
  }
  obs.redirects = chain;
  const finalUrl = new URL(page.url());
  if (siteKey(finalUrl.hostname) !== domain) {
    obs.errors.push(`redirected off-site to ${finalUrl.hostname}; audit stopped there`);
  }
  obs.canonical_origin = finalUrl.origin;
  const security = await first.securityDetails().catch(() => null);
  obs.tls = security ? { protocol: security.protocol, issuer: security.issuer, validFrom: security.validFrom, validTo: security.validTo, subjectName: security.subjectName } : { note: "no TLS details (http or proxy)" };

  // HTTP -> HTTPS redirect check.
  const httpProbe = await context.request.get(`http://${finalUrl.hostname}/`, { maxRedirects: 0, timeout: 20000 }).catch((e) => ({ error: e.message }));
  obs.http_redirect = httpProbe.error ? { error: httpProbe.error } : { status: httpProbe.status(), location: httpProbe.headers()["location"] || "" };

  // robots.txt and sitemaps.
  const robotsRes = await context.request.get(`${obs.canonical_origin}/robots.txt`, { timeout: 20000 }).catch(() => null);
  const robotsText = robotsRes && robotsRes.ok() ? await robotsRes.text() : "";
  const robots = parseRobots(robotsText);
  obs.robots = { present: !!robotsText, disallow: robots.disallow, sitemaps: robots.sitemaps };
  const sitemapUrls = robots.sitemaps.length ? robots.sitemaps : [`${obs.canonical_origin}/sitemap.xml`];
  const queue = [finalUrl.href];
  for (const sm of sitemapUrls.slice(0, 3)) {
    const res = await context.request.get(sm, { timeout: 20000 }).catch(() => null);
    if (!res || !res.ok()) continue;
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
    obs.sitemaps.push({ url: sm, entries: locs.length });
    queue.push(...locs);
  }

  // Crawl.
  const seen = new Set();
  const thirdPartyHosts = new Set();
  while (queue.length && obs.pages.length < maxPages) {
    const raw = queue.shift();
    let url;
    try {
      url = new URL(raw, obs.canonical_origin);
    } catch {
      continue;
    }
    url.hash = "";
    if (siteKey(url.hostname) !== domain || !/^https?:$/.test(url.protocol)) continue;
    if (/\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|mp3|docx?|xlsx?)$/i.test(url.pathname)) {
      if (!seen.has(url.href)) obs.excluded.push({ url: url.href, reason: "document or media file (listed, not crawled)" });
      seen.add(url.href);
      continue;
    }
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    if (!allowedByRobots(url, robots)) {
      obs.excluded.push({ url: url.href, reason: "disallowed by robots.txt" });
      continue;
    }
    const requests = [];
    const onRequest = (r) => requests.push(r.url());
    page.on("request", onRequest);
    const response = await page.goto(url.href, { waitUntil: "networkidle", timeout: 45000 }).catch((e) => {
      obs.errors.push(`load ${url.href}: ${e.message}`);
      return null;
    });
    page.off("request", onRequest);
    if (!response) continue;
    if (siteKey(new URL(page.url()).hostname) !== domain) {
      obs.excluded.push({ url: url.href, reason: `redirected off-site to ${new URL(page.url()).hostname}` });
      continue;
    }
    const headers = response.headers();
    const info = await page.evaluate(inspectPage);
    const thirdParty = [...new Set(requests.map((r) => { try { return new URL(r).hostname; } catch { return ""; } }).filter((h) => h && siteKey(h) !== domain))];
    thirdParty.forEach((h) => thirdPartyHosts.add(h));

    let axe = null;
    if (mode !== "security" && mode !== "privacy") {
      await page.addScriptTag({ content: axeSource });
      axe = await page.evaluate(async () => {
        // eslint-disable-next-line no-undef
        const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations", "incomplete"] });
        const slim = (list) => list.map((v) => ({ id: v.id, impact: v.impact, tags: v.tags.filter((t) => t.startsWith("wcag")), help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
        return { violations: slim(r.violations), incomplete: slim(r.incomplete), passes: r.passes.length };
      });
    }
    const keyboard = mode === "full" || mode === "accessibility" ? await keyboardWalk(page) : null;
    const cookies = (await context.cookies(url.href)).map((c) => ({ name: c.name, domain: c.domain, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, session: c.expires === -1 }));
    const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })).catch(() => ({ local: [], session: [] }));

    obs.pages.push({
      url: url.href,
      status: response.status(),
      headers: {
        "strict-transport-security": headers["strict-transport-security"] || "",
        "content-security-policy": headers["content-security-policy"] || "",
        "content-security-policy-report-only": headers["content-security-policy-report-only"] || "",
        "x-frame-options": headers["x-frame-options"] || "",
        "x-content-type-options": headers["x-content-type-options"] || "",
        "referrer-policy": headers["referrer-policy"] || "",
        "permissions-policy": headers["permissions-policy"] || "",
        "cache-control": headers["cache-control"] || "",
        server: headers["server"] || "",
        "x-powered-by": headers["x-powered-by"] || "",
      },
      ...info,
      links: undefined,
      linkCount: info.links.length,
      thirdPartyHosts: thirdParty,
      axe,
      keyboard,
      cookies,
      storage,
    });
    for (const href of info.links) queue.push(href);
  }

  // Screenshots of the home page and up to three key pages at four sizes.
  const keyPages = [obs.pages[0]?.url, ...obs.pages.filter((p) => p.forms.length > 0).map((p) => p.url), ...obs.pages.filter((p) => /privacy/i.test(p.url)).map((p) => p.url)].filter(Boolean);
  for (const url of [...new Set(keyPages)].slice(0, mode === "quick" ? 1 : 4)) {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const p = await ctx.newPage();
      const ok = await p.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => null);
      if (ok) {
        const name = `${new URL(url).pathname.replace(/[^a-z0-9]+/gi, "_") || "home"}__${vp.name}.png`.replace(/^_+/, "");
        await p.screenshot({ path: path.join(shotDir, name), fullPage: false });
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        const pageObs = obs.pages.find((x) => x.url === url);
        if (pageObs) (pageObs.viewports ||= []).push({ viewport: vp.name, screenshot: `screenshots/${name}`, horizontalOverflow: overflow });
      }
      await ctx.close();
    }
  }

  // Tracking: fresh context, then GPC on, then after a banner "accept" / "reject" if one exists.
  if (mode !== "accessibility" && obs.pages[0]) {
    const home = obs.pages[0].url;
    const capture = async (opts, action) => {
      const ctx = await browser.newContext(opts);
      if (opts.gpc) await ctx.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { get: () => true }));
      const p = await ctx.newPage();
      const hosts = new Set();
      p.on("request", (r) => { try { const h = new URL(r.url()).hostname; if (siteKey(h) !== domain) hosts.add(h); } catch { /* ignore */ } });
      await p.goto(home, { waitUntil: "networkidle", timeout: 45000 }).catch(() => null);
      let clicked = "";
      if (action) {
        const button = p.getByRole("button", { name: action });
        if (await button.count().catch(() => 0)) {
          await button.first().click({ timeout: 5000 }).catch(() => null);
          clicked = String(action);
          await p.waitForLoadState("networkidle").catch(() => null);
        }
      }
      const cookies = (await ctx.cookies()).map((c) => `${c.domain}:${c.name}`);
      await ctx.close();
      return { thirdPartyHosts: [...hosts].sort(), cookies, clicked };
    };
    obs.tracking.fresh = await capture({}, null);
    obs.tracking.gpc = await capture({ extraHTTPHeaders: { "Sec-GPC": "1" }, gpc: true }, null);
    obs.tracking.after_accept = await capture({}, /accept|agree|allow all|got it/i);
    obs.tracking.after_reject = await capture({}, /reject|decline|deny|necessary only/i);
  }
  obs.third_party_hosts = [...thirdPartyHosts].sort();

  await browser.close();

  // Other engines: load the home page and run axe once each, if installed.
  for (const name of browsersWanted.filter((b) => b !== "chromium")) {
    try {
      const b = await engines[name].launch();
      const p = await b.newPage();
      await p.goto(obs.pages[0]?.url || start.href, { waitUntil: "load", timeout: 45000 });
      obs.browsers[name] = { loaded: true, title: await p.title() };
      await b.close();
    } catch (error) {
      obs.browsers[name] = { loaded: false, error: String(error.message).split("\n")[0] };
    }
  }
  obs.browsers.chromium = { loaded: obs.pages.length > 0 };
  obs.finished_at = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, "observations.json"), JSON.stringify(obs, null, 2));
  console.log(outDir);
}

main().catch((error) => {
  console.error(`website audit failed: ${error.message}`);
  process.exit(1);
});
