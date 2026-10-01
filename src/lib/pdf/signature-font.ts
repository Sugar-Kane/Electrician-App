import { join } from "node:path";

import { Font } from "@react-pdf/renderer";

/**
 * A typed signature's face in the contract PDF: the same Dancing Script
 * SemiBold the pages write typed signatures in (src/components/signature-font.ts),
 * so the name looks the same signed on screen and in the copy everybody keeps.
 *
 * The TTF, not the WOFF2 the pages load. The PDF carries only the letters a
 * document uses, and the library's subsetter breaks on WOFF2's packed glyph
 * table at the first accented letter built from parts.
 *
 * Read from the project folder by path, the way Next documents a font used on
 * the server, so the build ships the file with each function that draws a PDF.
 */
export const SIGNATURE_FONT = "Volteira Signature";

Font.register({
  family: SIGNATURE_FONT,
  src: join(process.cwd(), "src/fonts/volteira-signature.ttf"),
});
