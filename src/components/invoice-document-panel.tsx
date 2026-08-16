"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Download, LoaderCircle, Pencil, RefreshCw } from "lucide-react";

import { regenerateInvoicePdf, type InvoiceActionState } from "@/app/invoices/actions";
import { PdfViewer } from "@/components/pdf-viewer";

/**
 * The document, and the four things to do with it.
 *
 * Deliberately in this order: look at it, then change it, then send it. An
 * electrician who has just raised an invoice wants to check the customer's name
 * and the total before anything leaves the building, and every other control is
 * a distraction until they have.
 *
 * Editing is a link back to the job rather than a form. What an invoice says is
 * decided by the hours and parts on the job — there is no separate invoice to
 * edit, and a second place to change a price would be a second answer.
 */

const initialState: InvoiceActionState = { error: "" };

export function InvoiceDocumentPanel({
  invoiceId,
  url,
  fileName,
  versionNumber,
  generatedLabel,
  jobNumber,
}: {
  invoiceId: string;
  /** Empty when there is no document yet — only Rebuild is offered then. */
  url: string;
  fileName: string;
  versionNumber: number;
  generatedLabel: string;
  jobNumber: string;
}) {
  const [state, rebuild, rebuilding] = useActionState(regenerateInvoicePdf, initialState);

  return (
    <section className={url ? "mt-3 rounded-panel border border-line bg-surface p-3 sm:p-4" : ""}>
      {url ? (
        <>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-1">
            <h2 className="text-sm font-semibold">What the customer receives</h2>
            {generatedLabel ? (
              <p className="text-xs text-ink-muted">
                {versionNumber > 1 ? `Version ${versionNumber} · ` : ""}
                Built {generatedLabel}
              </p>
            ) : null}
          </div>

          <PdfViewer url={url} fileName={fileName} />
        </>
      ) : null}

      <div className={`grid gap-2 sm:grid-cols-3 ${url ? "mt-3" : ""}`}>
        {url ? (
          /*
            A plain download rather than a share sheet. `download` with a
            filename is the one behaviour that works the same on a desktop, an
            Android phone and an iPhone — and on iOS it hands the file to the
            share sheet anyway, which is where somebody emails it from.
          */
          <a
            href={url}
            download={fileName}
            className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand"
          >
            <Download className="h-4 w-4" aria-hidden />
            Download
          </a>
        ) : null}

        {jobNumber ? (
          <Link
            href={`/jobs/${jobNumber}`}
            className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-semibold"
          >
            <Pencil className="h-4 w-4" aria-hidden />
            Edit on job
          </Link>
        ) : null}

        <form action={rebuild}>
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <button
            type="submit"
            disabled={rebuilding}
            className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-semibold disabled:opacity-60"
          >
            {rebuilding ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            {rebuilding ? "Rebuilding…" : url ? "Rebuild" : "Build the PDF"}
          </button>
        </form>
      </div>

      {state.error ? <p className="mt-2 text-sm text-critical">{state.error}</p> : null}
      {state.notice ? <p className="mt-2 text-sm text-positive">{state.notice}</p> : null}
    </section>
  );
}
