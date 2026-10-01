import localFont from "next/font/local";

/**
 * The face the contract's PDF is set in (src/lib/pdf/fonts.ts), for the copy
 * of the contract on the customer's signing page, so the page reads as the
 * same document rather than a web page about it.
 *
 * Arimo, cut down for the web from the TTFs the PDF embeds: Latin, Central
 * European and Vietnamese letters, punctuation and currency, no hinting, as
 * WOFF2. About 48 KB a weight instead of 480. A Greek or Cyrillic letter on
 * the page comes from the phone's own sans; the PDF has those in Arimo too.
 * Made with fonttools, and the same for Bold:
 *
 *   pyftsubset Arimo-Regular.ttf --layout-features='*' --no-hinting
 *     --unicodes="U+0000-024F,U+0259,U+02B0-02FF,U+0300-036F,U+1E00-1EFF,
 *       U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-2199,U+2212,U+2215,
 *       U+FEFF,U+FFFD" --flavor=woff2
 *
 * Arimo's licence (src/fonts/Arimo-OFL.txt) reserves no name, so the cut
 * keeps it.
 */
export const documentFont = localFont({
  src: [
    { path: "../fonts/arimo-regular-web.woff2", weight: "400", style: "normal" },
    { path: "../fonts/arimo-bold-web.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  fallback: ["Arial", "Helvetica", "sans-serif"],
});
