import type { DocumensoField } from "@/lib/documenso";

/**
 * Locate the ruled signing areas in the PDF that was actually generated.
 *
 * Contract bodies can wrap onto another page, so hard-coded "page 1, 80%"
 * coordinates eventually put a signature on top of a paragraph.  The labels
 * are part of Volteira's frozen PDF; reading their coordinates lets Documenso
 * place fields in the blank ruled areas immediately above them on whichever
 * page they landed.
 */

type PositionedText = {
  page: number;
  text: string;
  x: number;
  baselineY: number;
  pageWidth: number;
  pageHeight: number;
};

export type ContractSignatureFields = {
  customer: DocumensoField[];
  contractor: DocumensoField[];
};

function normal(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function fieldAbove(
  label: PositionedText,
  type: DocumensoField["type"],
  blankHeightPoints: number,
  widthPercent: number,
): DocumensoField {
  const heightPercent = (blankHeightPoints / label.pageHeight) * 100;
  // PDF coordinates start at the bottom; Documenso coordinates start at the
  // top.  The text baseline is below the ruled blank, hence the upward offset.
  const top = ((label.pageHeight - label.baselineY - blankHeightPoints - 7) / label.pageHeight) * 100;

  return {
    identifier: 0,
    type,
    page: label.page,
    positionX: rounded(clamp((label.x / label.pageWidth) * 100, 0, 95)),
    positionY: rounded(clamp(top, 0, 96)),
    width: rounded(widthPercent),
    height: rounded(clamp(heightPercent, 2.5, 7)),
  };
}

function closestLabel(
  all: PositionedText[],
  text: string,
  anchor: PositionedText,
): PositionedText | null {
  const candidates = all.filter(
    (item) => item.page === anchor.page && normal(item.text) === text && Math.abs(item.x - anchor.x) < 80,
  );
  return candidates.sort(
    (a, b) => Math.abs(a.baselineY - anchor.baselineY) - Math.abs(b.baselineY - anchor.baselineY),
  )[0] ?? null;
}

function fieldsFor(all: PositionedText[], role: "customer" | "contractor"): DocumensoField[] {
  const signature = all.find((item) => normal(item.text) === `${role} signature`);
  if (!signature) return [];

  const fields: DocumensoField[] = [fieldAbove(signature, "SIGNATURE", 34, 35)];
  const printedName = closestLabel(all, "printed name", signature);
  const date = closestLabel(all, "date", signature);

  if (printedName) fields.push(fieldAbove(printedName, "NAME", 24, 35));
  if (date) fields.push(fieldAbove(date, "DATE", 24, 24));
  return fields;
}

export async function locateContractSignatureFields(pdf: Buffer): Promise<ContractSignatureFields> {
  // The legacy build supplies the DOM shims pdf.js needs in a Node runtime.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(pdf),
    isEvalSupported: false,
    useWorkerFetch: false,
    // Missing optional standard-font data is harmless for extracting embedded
    // label positions; keep pdf.js from turning that into a production warning.
    verbosity: 0,
  }).promise;

  const positioned: PositionedText[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      for (const item of content.items) {
        if (!("str" in item) || !("transform" in item)) continue;
        positioned.push({
          page: pageNumber,
          text: item.str,
          x: Number(item.transform[4] ?? 0),
          baselineY: Number(item.transform[5] ?? 0),
          pageWidth: viewport.width,
          pageHeight: viewport.height,
        });
      }
    }
  } finally {
    await document.destroy();
  }

  return {
    customer: fieldsFor(positioned, "customer"),
    contractor: fieldsFor(positioned, "contractor"),
  };
}
