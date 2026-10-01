import { join } from "node:path";

import { Font } from "@react-pdf/renderer";

/**
 * The faces every PDF is drawn in, embedded rather than left to the reader.
 *
 * Both are TTFs read from the project folder by path, the way Next documents a
 * font used on the server, so the build ships them with each function that
 * draws a PDF. Not WOFF2: a PDF carries only the letters it uses, and the
 * library's subsetter breaks on a WOFF2's packed glyph table at the first
 * accented letter built from parts.
 */

/**
 * The text of every document: letterhead, customer and job blocks, the body,
 * line items, the signing record.
 *
 * It was the PDF standard Helvetica, which the format only encodes for
 * Western European letters, so anything past them printed as some other
 * character: "José Nguyễn-Brooks" came out "José NguyÅn-Brooks" on the very
 * line that records who signed. Arimo has Central European, Vietnamese, Greek
 * and Cyrillic letters too, and it is drawn to Arial's letter widths, which
 * are Helvetica's: rendered both ways, a contract and an invoice broke every
 * line in the same place, no baseline moved, and no line ended more than
 * about a point and a half from where it did.
 *
 * Google Fonts' own Regular and Bold, unmodified, under the OFL
 * (src/fonts/Arimo-OFL.txt).
 */
export const TEXT_FONT = "Arimo";

Font.register({
  family: TEXT_FONT,
  fonts: [
    { src: join(process.cwd(), "src/fonts/Arimo-Regular.ttf"), fontWeight: 400 },
    { src: join(process.cwd(), "src/fonts/Arimo-Bold.ttf"), fontWeight: 700 },
  ],
});

/**
 * A typed signature's face: the same Dancing Script SemiBold the pages write
 * typed signatures in (src/components/signature-font.ts), so the name looks
 * the same signed on screen and in the copy everybody keeps.
 */
export const SIGNATURE_FONT = "Volteira Signature";

Font.register({
  family: SIGNATURE_FONT,
  src: join(process.cwd(), "src/fonts/volteira-signature.ttf"),
});
