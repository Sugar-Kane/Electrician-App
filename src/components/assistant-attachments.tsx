"use client";

import { useRef, useState } from "react";
import { FileText, Film, ImageIcon, LoaderCircle, Paperclip, X } from "lucide-react";

import {
  createAssistantUpload,
  recordAssistantAttachment,
} from "@/app/assistant/attachment-actions";
import {
  fileSizeLabel,
  refuseAttachment,
  MAX_ATTACHMENTS,
  type Reading,
} from "@/lib/attachment-kinds";
import { createClient } from "@/lib/supabase/client";

/**
 * Attaching a photo, a PDF or a video to a question.
 *
 * The file goes to storage from the browser, never through a Server Action —
 * an action's request body is capped near a megabyte and a phone photo is
 * several, so posting the file would be rejected before any of the careful
 * error handling ran.
 *
 * Failure is shown per file, on its own chip. One photo out of three failing
 * should cost that photo, not the question and not the other two.
 */

export type Attachment = {
  /** Local, for React keys and removal before the upload finishes. */
  key: string;
  name: string;
  sizeBytes: number;
  state: "uploading" | "ready" | "failed";
  /** The `documents` row, once the server has filed it. */
  documentId?: string;
  reading?: Reading;
  error?: string;
};

const ACCEPT = "image/*,application/pdf,video/*";

function KindIcon({ name, reading }: { name: string; reading?: Reading }) {
  const lower = name.toLowerCase();
  if (reading === "document" || lower.endsWith(".pdf")) {
    return <FileText className="h-4 w-4 shrink-0" aria-hidden />;
  }
  if (/\.(mp4|mov|webm)$/.test(lower)) {
    return <Film className="h-4 w-4 shrink-0" aria-hidden />;
  }
  return <ImageIcon className="h-4 w-4 shrink-0" aria-hidden />;
}

export function AttachButton({
  attachments,
  onChange,
  disabled,
}: {
  attachments: Attachment[];
  onChange: (next: (current: Attachment[]) => Attachment[]) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [full, setFull] = useState("");

  async function send(file: File, key: string) {
    const details = {
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    };

    const ticket = await createAssistantUpload(details);
    if (!ticket.ok) {
      onChange((current) =>
        current.map((item) =>
          item.key === key ? { ...item, state: "failed", error: ticket.error } : item,
        ),
      );
      return;
    }

    // Straight from the phone to storage. The token is only good for this one
    // object, so nothing else can be written with it.
    const put = await createClient()
      .storage.from(ticket.bucket)
      .uploadToSignedUrl(ticket.path, ticket.token, file, {
        contentType: file.type || undefined,
      });

    if (put.error) {
      console.error("assistant attachment: upload to storage failed", put.error);
      onChange((current) =>
        current.map((item) =>
          item.key === key
            ? { ...item, state: "failed", error: "That upload did not finish." }
            : item,
        ),
      );
      return;
    }

    const recorded = await recordAssistantAttachment({ path: ticket.path, ...details });
    onChange((current) =>
      current.map((item) =>
        item.key === key
          ? recorded.ok
            ? {
                ...item,
                state: "ready",
                documentId: recorded.documentId,
                reading: recorded.reading,
              }
            : { ...item, state: "failed", error: recorded.error }
          : item,
      ),
    );
  }

  function chosen(files: FileList | null) {
    if (!files || files.length === 0) return;

    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setFull(`That is ${MAX_ATTACHMENTS} files — send these first.`);
      return;
    }

    const taking = Array.from(files).slice(0, room);
    setFull(
      files.length > room ? `Only ${room} more will fit on this question.` : "",
    );

    for (const file of taking) {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;

      // Refused in the browser as a courtesy — the server refuses for the same
      // reasons, from the same table, and that is the check that counts.
      const refusal = refuseAttachment({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });

      onChange((current) => [
        ...current,
        {
          key,
          name: file.name,
          sizeBytes: file.size,
          state: refusal ? "failed" : "uploading",
          error: refusal || undefined,
        },
      ]);

      if (!refusal) void send(file, key);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        onChange={(event) => {
          chosen(event.target.files);
          // Cleared so choosing the same file twice in a row still fires.
          event.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label="Attach a photo, PDF or video"
        className="tap-target grid h-12 w-12 shrink-0 place-items-center rounded-control border border-line bg-raised text-ink-muted disabled:opacity-50"
      >
        <Paperclip className="h-5 w-5" aria-hidden />
      </button>

      {full ? <p className="mt-2 w-full text-xs text-caution">{full}</p> : null}
    </>
  );
}

/** The chips above the question box: what is going up, and what is ready. */
export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove: (key: string) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <ul className="mb-3 flex flex-wrap gap-2" aria-label="Attached files">
      {attachments.map((item) => (
        <li
          key={item.key}
          className={`flex max-w-full items-center gap-2 rounded-chip border px-3 py-2 text-xs ${
            item.state === "failed"
              ? "border-critical/40 bg-critical-bg text-critical"
              : "border-line bg-raised text-ink-muted"
          }`}
        >
          {item.state === "uploading" ? (
            <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          ) : (
            <KindIcon name={item.name} reading={item.reading} />
          )}

          <span className="min-w-0">
            <span className="block truncate">{item.name}</span>
            <span className="block text-[11px] opacity-80">
              {item.state === "failed"
                ? item.error
                : item.state === "uploading"
                  ? "Uploading…"
                  : /*
                     * Said on the chip, before the question is sent, so nobody
                     * asks the assistant to watch a video and only finds out
                     * afterwards that it could not.
                     */
                    item.reading === "stored"
                    ? `${fileSizeLabel(item.sizeBytes)} · saved, not readable yet`
                    : fileSizeLabel(item.sizeBytes)}
            </span>
          </span>

          <button
            type="button"
            onClick={() => onRemove(item.key)}
            aria-label={`Remove ${item.name}`}
            className="tap-target grid h-11 w-11 shrink-0 place-items-center rounded-chip"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
