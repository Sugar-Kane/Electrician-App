"use client";

import { useEffect, useRef, useState } from "react";
import { Download, LoaderCircle, TriangleAlert, ZoomIn, ZoomOut } from "lucide-react";

/**
 * A document, shown as the document.
 *
 * The obvious implementation is an iframe pointed at the file, and it is wrong
 * for exactly the people this app is for: Safari on iPhone renders only the
 * first page of a PDF in an iframe, silently, with no scrollbar to suggest
 * there is more. An electrician checking a three-page contract on site would
 * read page one and assume that was all of it.
 *
 * So the pages are drawn with pdf.js onto canvases. It costs a few hundred
 * kilobytes, loaded only when somebody actually opens a document, and it
 * behaves the same on every phone and every desktop.
 *
 * Zoom is a control rather than a gesture. Pinch-zoom still works — nothing here
 * disables it — but a fixed pair of buttons is what somebody finds with one
 * hand and gloves on.
 */

const MIN_SCALE = 0.6;
const MAX_SCALE = 3;

/**
 * How the last attempt for a particular document-and-zoom turned out.
 *
 * Kept as a record of *what* was rendered rather than a plain status, so the
 * status can be derived during render instead of set from inside the effect.
 * Setting it there is a cascading render, and the effect already re-runs
 * whenever the url or the zoom changes — which is exactly when the status
 * needs to go back to loading.
 */
type Outcome = { url: string; scale: number; ok: boolean; pages: number };

export function PdfViewer({
  url,
  fileName,
  className = "",
}: {
  url: string;
  fileName: string;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [scale, setScale] = useState(1);

  const current = outcome !== null && outcome.url === url && outcome.scale === scale;
  const status = !current ? "loading" : outcome.ok ? "ready" : "failed";
  const pageCount = current ? outcome.pages : 0;

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    // Captured so the closure below has a non-null reference; `container.current`
    // is mutable and TypeScript is right not to trust it across an await.
    const target: HTMLDivElement = host;

    /*
     * Cancellation, which this did not have.
     *
     * Rendering a document is a loop of awaits, and the effect re-runs on every
     * zoom. Two runs overlapping would append pages from both into the same
     * container, interleaved in whatever order they happened to finish — so
     * this run stops the moment a newer one starts.
     */
    let cancelled = false;

    async function draw() {
      try {
        // Imported here rather than at the top of the file so pdf.js is fetched
        // when a document is opened and never on a page that has none.
        //
        // The legacy build, deliberately. The modern one calls
        // `Map.prototype.getOrInsertComputed`, a proposal method that only very
        // recent engines have — it threw on the Chromium this was tested against,
        // and would have thrown on any phone more than a year old. A field app
        // does not get to choose its browsers.
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        const document_ = await pdfjs.getDocument({ url }).promise;
        if (cancelled) return;

        target.replaceChildren();

        // The width the page is drawn at. Capped so a wide desktop does not
        // render a letter page at 1800px and make the text absurd.
        const available = Math.min(target.clientWidth || 640, 900);

        for (let number = 1; number <= document_.numPages; number += 1) {
          if (cancelled) return;
          const page = await document_.getPage(number);
          const natural = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (available / natural.width) * scale });

          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          if (!context) continue;

          // Drawn at device resolution and displayed at CSS size, or the text is
          // a blurry mess on every phone made in the last decade.
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.floor(viewport.width * ratio);
          canvas.height = Math.floor(viewport.height * ratio);
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.className = "block rounded-control border border-line bg-white shadow-lg";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `Page ${number} of ${document_.numPages}`);

          target.append(canvas);

          // v4 takes the context, not the canvas. v6 takes both and was the
          // version this was first written against — before it turned out to
          // need a browser engine newer than the phones this app runs on.
          await page.render({
            canvasContext: context,
            viewport,
            transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        }).promise;
      }

        if (cancelled) return;
        setOutcome({ url, scale, ok: true, pages: document_.numPages });
    } catch (error) {
        // Anything at all — an expired signed URL, a worker that would not load,
        // a corrupt file. The document is still downloadable, which is the way
        // out offered below.
        if (cancelled) return;
          console.error("pdf viewer: could not render", error);
          setOutcome({ url, scale, ok: false, pages: 0 });
      }
    }

    void draw();

    return () => {
      cancelled = true;
    };
  }, [url, scale]);

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted" role="status" aria-live="polite">
          {status === "loading"
            ? "Opening document…"
            : status === "ready"
              ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}`
              : "Could not open"}
        </p>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setScale((value) => Math.max(MIN_SCALE, Number((value - 0.25).toFixed(2))))}
            disabled={scale <= MIN_SCALE || status !== "ready"}
            aria-label="Zoom out"
            className="tap-target grid h-11 w-11 place-items-center rounded-control border border-line disabled:opacity-40"
          >
            <ZoomOut className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setScale((value) => Math.min(MAX_SCALE, Number((value + 0.25).toFixed(2))))}
            disabled={scale >= MAX_SCALE || status !== "ready"}
            aria-label="Zoom in"
            className="tap-target grid h-11 w-11 place-items-center rounded-control border border-line disabled:opacity-40"
          >
            <ZoomIn className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {status === "failed" ? (
        <div className="rounded-panel border border-line bg-surface p-6 text-center">
          <TriangleAlert className="mx-auto h-6 w-6 text-caution" aria-hidden />
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            This document could not be opened here. It can still be downloaded and read in any PDF
            app.
          </p>
          <a
            href={url}
            download={fileName}
            className="tap-target mt-4 inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-semibold"
          >
            <Download className="h-4 w-4" aria-hidden />
            Download PDF
          </a>
        </div>
      ) : (
        <div className="relative">
          {status === "loading" ? (
            <div className="grid min-h-[220px] place-items-center rounded-panel border border-line bg-surface">
              <LoaderCircle className="h-6 w-6 animate-spin text-ink-muted" aria-hidden />
            </div>
          ) : null}

          {/* Scrolls inside itself so a zoomed page never takes the whole page
              sideways with it. */}
          <div
            ref={container}
            className={`max-h-[70vh] space-y-3 overflow-auto rounded-panel bg-sunken p-2 ${
              status === "loading" ? "hidden" : ""
            }`}
          />
        </div>
      )}
    </div>
  );
}
