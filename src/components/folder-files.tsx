"use client";

import { useActionState, useEffect, useState } from "react";
import { Download, FileText, History, Image as ImageIcon, LoaderCircle, X } from "lucide-react";

import {
  listDocumentVersions,
  restoreDocumentVersion,
  type VersionState,
} from "@/app/files/version-actions";
import { PdfViewer } from "@/components/pdf-viewer";
import { FormMessage } from "@/components/ui/field";
import type { DocumentVersion, FolderFile } from "@/lib/document-workspace";

/**
 * The files in a folder, and one of them open.
 *
 * A PDF opens in the viewer the app already has — it was built for invoices and
 * contracts and wired to nothing else, so every other PDF the business filed
 * could only be downloaded and opened in whatever the phone felt like. An image
 * opens inline. Anything else offers the download, honestly labelled, rather
 * than a preview pane that renders a grey rectangle.
 *
 * The preview is a panel above the list rather than a modal: on a phone a modal
 * over a list is a thing to get out of, and the list is what somebody came for.
 */

function sizeLabel(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function kindLabel(documentType: string): string {
  return documentType.replace(/_/g, " ");
}

export function FolderFiles({
  files,
  hasFolders,
  /**
   * A file to open on arrival.
   *
   * So a link can point at one document rather than at the folder holding it —
   * a purchase on a stock item's history opening the receipt behind it, which
   * is otherwise a folder, a scroll and a guess at which of nine photos it was.
   */
  initialOpenId = "",
}: {
  files: FolderFile[];
  hasFolders: boolean;
  initialOpenId?: string;
}) {
  const [openId, setOpenId] = useState(initialOpenId);
  const open = files.find((file) => file.id === openId) ?? null;

  if (files.length === 0) {
    return (
      <p className="rounded-panel border border-dashed border-line p-8 text-center text-sm text-ink-muted">
        {hasFolders
          ? "No files in this folder itself — look in the folders above."
          : "Nothing filed here yet. Invoices, contracts and job photos land in these folders as they are made."}
      </p>
    );
  }

  return (
    <>
      {open ? (
        <section className="mb-3 rounded-panel border border-line bg-surface p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-ink">{open.name}</h2>
              <p className="mt-0.5 truncate text-[11px] text-ink-faint">
                {[kindLabel(open.documentType), sizeLabel(open.sizeBytes), open.whenLabel]
                  .filter(Boolean)
                  .join(" · ")}
                {open.version > 1 ? ` · version ${open.version}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpenId("")}
              aria-label="Close the preview"
              className="tap-target grid h-11 w-11 shrink-0 place-items-center rounded-control border border-line text-ink-muted"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="mt-3">
            {!open.url ? (
              <p className="rounded-control border border-dashed border-line p-6 text-center text-sm text-ink-muted">
                This file could not be opened just now. It is still filed here.
              </p>
            ) : open.mimeType === "application/pdf" ? (
              <PdfViewer url={open.url} fileName={open.fileName || open.name} />
            ) : open.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={open.url}
                alt={open.name}
                className="max-h-[70vh] w-full rounded-control object-contain"
              />
            ) : (
              <div className="rounded-control border border-dashed border-line p-6 text-center">
                <p className="text-sm text-ink-muted">
                  This one cannot be shown here. Open it to read it.
                </p>
                <a
                  href={open.url}
                  target="_blank"
                  rel="noreferrer"
                  className="tap-target mt-3 inline-flex items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand"
                >
                  <Download className="h-4 w-4" aria-hidden />
                  Open {open.fileName || "the file"}
                </a>
              </div>
            )}
          </div>

          <DocumentHistory documentId={open.id} />
        </section>
      ) : null}

      <ul className="space-y-2">
        {files.map((file) => {
          const isOpen = file.id === openId;
          return (
            <li key={file.id}>
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? "" : file.id)}
                aria-expanded={isOpen}
                className={`tap-row flex min-h-14 w-full items-center gap-3 rounded-control border px-3 text-left ${
                  isOpen ? "border-brand/50 bg-brand/[0.06]" : "border-line bg-surface"
                }`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-white/5 text-brand">
                  {file.mimeType.startsWith("image/") ? (
                    <ImageIcon className="h-4 w-4" aria-hidden />
                  ) : (
                    <FileText className="h-4 w-4" aria-hidden />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{file.name}</span>
                  <span className="block truncate text-[11px] text-ink-faint">
                    {[
                      kindLabel(file.documentType),
                      file.jobNumber ? `job ${file.jobNumber}` : "",
                      sizeLabel(file.sizeBytes),
                      file.whenLabel,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>

                {file.version > 1 ? (
                  <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-ink-muted">
                    v{file.version}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const initialVersionState: VersionState = { error: "" };

/**
 * The versions of a document, and the way back to one.
 *
 * Fetched when the preview opens rather than with the list: most files have one
 * version, and asking for the history of every document in a folder to render
 * the ones nobody opened is a page's worth of queries for nothing.
 */
function DocumentHistory({ documentId }: { documentId: string }) {
  const [versions, setVersions] = useState<DocumentVersion[] | null>(null);
  const [state, action, pending] = useActionState(restoreDocumentVersion, initialVersionState);

  /*
   * Asked for when the preview opens, and again after a restore so the "on
   * file" badge moves. Nothing is set synchronously in the effect body — the
   * answer arrives in a callback, which is what an effect is for.
   */
  useEffect(() => {
    let live = true;
    listDocumentVersions(documentId).then((rows) => {
      if (live) setVersions(rows);
    });
    return () => {
      live = false;
    };
  }, [documentId, state.notice]);

  if (versions === null) {
    return (
      <p className="mt-3 flex items-center gap-2 text-[11px] text-ink-faint">
        <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
        Looking for earlier versions…
      </p>
    );
  }

  if (versions.length <= 1) return null;

  return (
    <div className="mt-3 rounded-control border border-line bg-raised p-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
        <History className="h-3.5 w-3.5" aria-hidden />
        Earlier versions
      </h3>

      <ul className="mt-2 divide-y divide-line">
        {versions.map((version) => (
          <li key={version.id} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-ink">
                Version {version.version}
                {version.current ? (
                  <span className="ml-2 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand">
                    on file
                  </span>
                ) : null}
              </span>
              <span className="block text-[11px] text-ink-faint">{version.whenLabel}</span>
            </span>

            {version.current ? null : (
              <form action={action}>
                <input type="hidden" name="versionId" value={version.id} />
                <button
                  type="submit"
                  disabled={pending}
                  className="tap-target inline-flex items-center gap-1.5 rounded-control border border-line px-3 text-xs font-semibold text-ink disabled:opacity-60"
                >
                  {pending ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : null}
                  Go back to this
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-2">
        <FormMessage error={state.error} notice={state.notice} />
      </div>

      <p className="mt-2 text-[11px] leading-4 text-ink-faint">
        Nothing is thrown away. Going back swaps which version is on file, and the one you left is
        still here.
      </p>
    </div>
  );
}
