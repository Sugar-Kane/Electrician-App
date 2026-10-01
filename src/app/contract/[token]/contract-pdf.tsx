"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";

import { PdfViewer } from "@/components/pdf-viewer";

/**
 * The exact PDF pages, for whoever wants them.
 *
 * Mounted only once asked for: the viewer pulls in pdf.js and draws every page,
 * which is wasted on the many people who read the copy above and sign.
 */
export function ContractPdfPages({ url, fileName }: { url: string; fileName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-x-6">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="tap-target inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand"
        >
          <FileText className="h-4 w-4" aria-hidden />
          {open ? "Hide the PDF pages" : "View the PDF pages"}
        </button>
        <a
          href={url}
          download={fileName}
          className="tap-target inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand"
        >
          <Download className="h-4 w-4" aria-hidden />
          Download a copy
        </a>
      </div>

      {open ? <PdfViewer url={url} fileName={fileName} className="mt-2" /> : null}
    </div>
  );
}
