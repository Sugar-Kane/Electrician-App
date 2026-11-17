#!/usr/bin/env node
// Screenshot pages at six device viewports and flag layout problems.
// Usage: node check_layouts.mjs --base http://localhost:3000 --paths / /jobs --out ./shots [--auth-cookie "name=value"]
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const VIEWPORTS = [
  { name: "phone-small", width: 320, height: 568, mobile: true },
  { name: "phone-portrait", width: 390, height: 844, mobile: true },
  { name: "phone-landscape", width: 844, height: 390, mobile: true },
  { name: "tablet-portrait", width: 768, height: 1024, mobile: true },
  { name: "tablet-landscape", width: 1024, height: 768, mobile: true },
  { name: "desktop", width: 1440, height: 900, mobile: false },
];

function parseArgs(argv) {
  const args = { base: "http://localhost:3000", paths: [], out: "./layout-shots", cookie: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") args.base = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--auth-cookie") args.cookie = argv[++i];
    else if (a === "--paths") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) args.paths.push(argv[++i]);
    }
  }
  if (args.paths.length === 0) args.paths = ["/"];
  return args;
}

const { base, paths, out, cookie } = parseArgs(process.argv.slice(2));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
let failed = false;

for (const path of paths) {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.mobile,
      isMobile: vp.mobile,
      deviceScaleFactor: 1,
    });
    if (cookie) {
      const [name, ...rest] = cookie.split("=");
      await context.addCookies([{ name, value: rest.join("="), url: base }]);
    }
    const page = await context.newPage();
    const label = `${path} @ ${vp.name} (${vp.width}x${vp.height})`;
    try {
      await page.goto(new URL(path, base).toString(), { waitUntil: "networkidle", timeout: 30000 });
    } catch (error) {
      console.log(`FAIL ${label}: could not load (${error.message.split("\n")[0]})`);
      failed = true;
      await context.close();
      continue;
    }

    const report = await page.evaluate(() => {
      const doc = document.documentElement;
      const vw = doc.clientWidth;
      const overflowX = doc.scrollWidth > vw + 1;
      const offenders = [];
      if (overflowX) {
        for (const el of document.body.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > vw + 1) {
            const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 4).join(".") : "";
            offenders.push(`${el.tagName.toLowerCase()}${cls ? "." + cls : ""} right=${Math.round(r.right)}`);
            if (offenders.length >= 6) break;
          }
        }
      }
      const small = [];
      const selector = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab]';
      for (const el of document.querySelectorAll(selector)) {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || style.visibility === "hidden") continue;
        if (r.width < 40 || r.height < 40) {
          const text = (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24);
          small.push(`${el.tagName.toLowerCase()} "${text}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return { overflowX, offenders, small, scrollWidth: doc.scrollWidth, vw };
    });

    const shot = join(out, `${path.replace(/[^a-z0-9]+/gi, "_") || "home"}__${vp.name}.png`);
    await page.screenshot({ path: shot, fullPage: true });

    if (report.overflowX) {
      failed = true;
      console.log(`FAIL ${label}: page scrolls sideways (content ${report.scrollWidth}px in ${report.vw}px)`);
      for (const o of report.offenders) console.log(`       wide: ${o}`);
    } else {
      console.log(`ok   ${label}`);
    }
    if (report.small.length) {
      console.log(`     ${report.small.length} tap target(s) under 40px, e.g. ${report.small.slice(0, 3).join("; ")}`);
    }
    await context.close();
  }
}

await browser.close();
console.log(`\nScreenshots in ${out}. Open the phone-landscape and tablet-portrait ones for any screen you changed.`);
process.exit(failed ? 1 : 0);
