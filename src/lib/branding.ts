/**
 * A tenant's colour, and text that can be read on it.
 *
 * The foreground is computed, never chosen. This app already shipped the bug
 * this prevents: an unlayered `button { color: inherit }` put #f8fafc on the
 * brand yellow, about 1.5:1, on every primary action in the product. One
 * electrician picking yellow — and they will, it is the colour of the trade —
 * would put that same unreadable button on their own booking page, and nobody
 * would be there to notice.
 *
 * Import-free, so the boundary colours can be tested without a browser.
 */

/** The product's own yellow, and what a tenant gets before they choose. */
export const DEFAULT_BRAND = "#ffc21c";

const HEX = /^#([0-9a-f]{6})$/i;

/** A hex colour, or "" when it is not one. Six digits only: CSS shorthand and
 * named colours are not things a colour input produces, and accepting them
 * would mean parsing them everywhere this value is read. */
export function normaliseBrandColor(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return "";
  // A three-digit shorthand is the one abbreviation people type by hand.
  const short = /^#([0-9a-f]{3})$/i.exec(value);
  if (short) {
    const [r, g, b] = short[1]!.split("") as [string, string, string];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return HEX.test(value) ? value : "";
}

function channels(hex: string): [number, number, number] | null {
  const match = HEX.exec(hex);
  if (!match) return null;
  const digits = match[1]!;
  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance: sRGB, gamma-expanded, weighted for human vision. */
export function relativeLuminance(hex: string): number {
  const rgb = channels(hex);
  if (!rgb) return 0;

  const [r, g, b] = rgb.map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(one: string, two: string): number {
  const a = relativeLuminance(one);
  const b = relativeLuminance(two);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export const INK = "#071723";
export const PAPER = "#ffffff";

/**
 * The readable foreground for a background, whichever of the two is better.
 *
 * Not a lightness threshold. A threshold picks white on mid-blue at 4.4:1 when
 * black would have given 4.8:1, and the whole point is to take the better one.
 */
export function readableForeground(background: string): string {
  const colour = normaliseBrandColor(background) || DEFAULT_BRAND;
  return contrastRatio(colour, INK) >= contrastRatio(colour, PAPER) ? INK : PAPER;
}

export type BrandTheme = {
  /** The accent itself. */
  brand: string;
  /** Text and icons drawn on top of the accent. */
  onBrand: string;
  /** The contrast the pair achieves, so a screen can warn about a poor choice. */
  ratio: number;
};

/**
 * The pair of CSS variables the booking page sets.
 *
 * A colour too close to mid grey cannot reach 4.5:1 against either black or
 * white — nothing can be done about that in code, so `ratio` is returned and the
 * settings screen says so before it is saved rather than shipping an unreadable
 * button and calling it the tenant's choice.
 */
export function brandTheme(raw: string | null | undefined): BrandTheme {
  const brand = normaliseBrandColor(raw) || DEFAULT_BRAND;
  const onBrand = readableForeground(brand);
  return { brand, onBrand, ratio: contrastRatio(brand, onBrand) };
}
