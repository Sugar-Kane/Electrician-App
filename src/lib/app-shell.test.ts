import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * The shell's quiet contracts.
 *
 * Both of these are things that look right in the source and do nothing at
 * runtime, which is the only reason they are worth a test. Neither would fail
 * a type check, a lint, or a render.
 */

const SOURCE = join(process.cwd(), "src");

function sourceFiles(directory: string, extensions: string[]): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(path);
  }

  return found;
}

test("safe-area padding is backed by a viewport that reports one", () => {
  // env(safe-area-inset-*) is 0 unless the viewport is told to cover the
  // display. Four components padded themselves with it to clear the iPhone
  // home indicator, and every one of them resolved to nothing for as long as
  // `viewportFit` was missing — written, reviewed, shipped, never run.
  const usesSafeArea = sourceFiles(SOURCE, [".tsx", ".css"]).filter((path) =>
    readFileSync(path, "utf8").includes("env(safe-area-inset"),
  );

  if (usesSafeArea.length === 0) return;

  const layout = readFileSync(join(SOURCE, "app", "layout.tsx"), "utf8");
  assert.match(
    layout,
    /viewportFit:\s*"cover"/,
    `${usesSafeArea.length} files pad for the safe area; without viewportFit "cover" every one is 0`,
  );
});

test("the skip link has something to skip to", () => {
  // A skip link pointing at an id nothing renders moves focus nowhere, and the
  // next Tab carries on through the sidebar it was meant to skip — the failure
  // is invisible unless somebody navigates by keyboard.
  const layout = readFileSync(join(SOURCE, "app", "layout.tsx"), "utf8");
  if (!layout.includes('href="#main-content"')) return;

  const targets = sourceFiles(SOURCE, [".tsx"]).filter((path) =>
    readFileSync(path, "utf8").includes('id="main-content"'),
  );

  assert.ok(targets.length > 0, "nothing renders id=\"main-content\"");

  // Every shell needs one. The dashboard has its own, so a target in the field
  // shell alone would leave the home page with a link that goes nowhere.
  for (const shell of ["field-page-shell.tsx", "dashboard-shell.tsx"]) {
    const path = join(SOURCE, "components", shell);
    assert.match(readFileSync(path, "utf8"), /id="main-content"/, shell);
  }
});
