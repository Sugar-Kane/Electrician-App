import test from "node:test";
import assert from "node:assert/strict";

import {
  brandTheme,
  contrastRatio,
  DEFAULT_BRAND,
  INK,
  normaliseBrandColor,
  PAPER,
  readableForeground,
  relativeLuminance,
} from "./branding.ts";

test("six-digit hex is kept and lowercased", () => {
  assert.equal(normaliseBrandColor("#FFC21C"), "#ffc21c");
});

test("three-digit shorthand is expanded", () => {
  assert.equal(normaliseBrandColor("#FA0"), "#ffaa00");
});

test("anything that is not a hex colour is refused", () => {
  for (const bad of ["", "red", "ffc21c", "#ffc21", "#gggggg", "rgb(1,2,3)"]) {
    assert.equal(normaliseBrandColor(bad), "", JSON.stringify(bad));
  }
});

test("luminance runs from black to white", () => {
  assert.equal(Math.round(relativeLuminance("#000000") * 1000) / 1000, 0);
  assert.equal(Math.round(relativeLuminance("#ffffff") * 1000) / 1000, 1);
});

test("black on white is the maximum contrast", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
});

test("yellow takes dark text, which is the bug this exists for", () => {
  // White on the brand yellow measured about 1.5:1 in this app. The point of
  // computing the foreground is that a tenant cannot reproduce that.
  assert.equal(readableForeground(DEFAULT_BRAND), INK);
  assert.ok(contrastRatio(DEFAULT_BRAND, PAPER) < 2, "white on yellow is unreadable");
});

test("navy takes light text", () => {
  assert.equal(readableForeground("#0b1b27"), PAPER);
});

test("the better of the two is chosen, not a lightness threshold", () => {
  // A mid colour where the naive "is it light?" test picks the worse option.
  const colour = "#3d7fb8";
  const chosen = readableForeground(colour);
  const other = chosen === INK ? PAPER : INK;
  assert.ok(
    contrastRatio(colour, chosen) >= contrastRatio(colour, other),
    `${chosen} should beat ${other} on ${colour}`,
  );
});

test("every brand colour gets the best available foreground", () => {
  for (const colour of ["#ffc21c", "#ff0000", "#00ff00", "#0000ff", "#808080", "#ffffff", "#000000"]) {
    const theme = brandTheme(colour);
    const other = theme.onBrand === INK ? PAPER : INK;
    assert.ok(
      theme.ratio >= contrastRatio(colour, other),
      `${colour} chose the worse foreground`,
    );
  }
});

test("a usable colour clears the 4.5:1 the settings screen checks", () => {
  for (const colour of ["#ffc21c", "#0b1b27", "#c62828", "#1b5e20"]) {
    assert.ok(brandTheme(colour).ratio >= 4.5, `${colour} came out at ${brandTheme(colour).ratio}`);
  }
});

test("mid grey cannot reach 4.5:1 either way, and reports it", () => {
  // Nothing can fix this in code. The screen has to say so before it is saved.
  const theme = brandTheme("#777777");
  assert.ok(theme.ratio < 4.5, `expected a poor ratio, got ${theme.ratio}`);
});

test("a missing or broken colour falls back to the product's own", () => {
  assert.equal(brandTheme(null).brand, DEFAULT_BRAND);
  assert.equal(brandTheme("nonsense").brand, DEFAULT_BRAND);
  assert.equal(brandTheme("").brand, DEFAULT_BRAND);
});
