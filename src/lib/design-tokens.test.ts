import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * The design tokens, defended.
 *
 * Not a unit test of anything — a check that the things the tokens exist to
 * prevent have not grown back. `globals.css` says "One yellow. There were
 * seven." Nothing stopped an eighth, and nothing stopped the status banner
 * being written out by hand twenty-nine times in twelve files.
 *
 * Scanning source is a blunt instrument, and it is the only one that catches
 * this: a copied class string type-checks, lints, renders, and is wrong only in
 * the sense that it stops following the token it was copied from.
 */

const SOURCE = join(process.cwd(), "src");

/** Where the forbidden patterns are legitimately written down. */
const ALLOWED = new Set([
  // Documents the pattern it replaced, in a comment.
  join(SOURCE, "components", "ui", "banner.tsx"),
]);

function sourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith(".tsx")) found.push(path);
  }

  return found;
}

test("the status banner is not written out by hand again", () => {
  // The signature of the banner specifically — a bordered, tinted block with
  // matching text — rather than any use of a palette colour. `red-400` is
  // #f87171 and --color-critical is #fb7185, so one of these is a second,
  // slightly different red for the same meaning.
  //
  // Decorative uses of the palette elsewhere are not caught by this and are
  // not claimed to be clean; they are separate colours doing separate jobs,
  // not thirty copies of one component.
  const pattern = /border-(red|emerald|amber)-\d{3}\/\d+ bg-\1-\d{3}\//;

  const offenders = sourceFiles(SOURCE)
    .filter((path) => !ALLOWED.has(path))
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(SOURCE.length + 1));

  assert.deepEqual(
    offenders,
    [],
    `Use <Banner tone="critical|positive"> instead of a hand-rolled one:\n${offenders.join("\n")}`,
  );
});

test("job status colours come from one place", () => {
  // The week and month grids kept their own dot palette, whose values happened
  // to equal the tokens — so it looked right and was one token edit away from
  // not being.
  const grids = readFileSync(join(SOURCE, "components", "schedule-views.tsx"), "utf8");

  assert.doesNotMatch(grids, /bg-(blue|amber|rose|emerald|slate)-\d{3}/);
  assert.match(grids, /statusDot/);
});
