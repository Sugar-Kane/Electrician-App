import localFont from "next/font/local";

/**
 * The face a typed signature is written in, wherever one is shown: the
 * signing pad as somebody types, a saved signature in Settings, and the
 * contract itself.
 *
 * It was the browser's serif in italic, which reads as a name printed in a
 * slanted font rather than as anybody's signature. This is Dancing Script at
 * SemiBold: cursive enough to look signed, plain enough that the name is never
 * in doubt, and with every glyph the family has, so Nguyễn or Łukasz is written
 * in it too. The contract's PDF embeds the same face (src/lib/pdf/
 * signature-font.ts) from the TTF beside this file.
 *
 * Inside the files it is called "Volteira Signature". "Dancing Script" is a
 * Reserved Font Name under its licence (src/fonts/DancingScript-OFL.txt), and
 * the licence keeps that name off a modified copy, which a single weight cut
 * from the variable font and converted to WOFF2 is.
 *
 * Not preloaded: most pages never show a typed signature, so the file is
 * fetched the first time one is drawn.
 */
export const signatureFont = localFont({
  src: "../fonts/volteira-signature.woff2",
  weight: "600",
  display: "swap",
  preload: false,
  fallback: ["cursive"],
  // The default stands Arial in, metric-matched, while the file loads, and
  // Arial is the opposite of a signature. A generic script face is closer.
  adjustFontFallback: false,
});
