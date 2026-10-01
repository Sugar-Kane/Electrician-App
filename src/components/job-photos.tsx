"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Camera, ImageUp, LoaderCircle, TriangleAlert, Trash2 } from "lucide-react";

import {
  createJobPhotoUpload,
  recordJobPhoto,
  removeJobPhoto,
  type PhotoActionState,
} from "@/app/jobs/[jobId]/photo-actions";
import { useImageFallback } from "@/components/use-image-fallback";
import { createClient } from "@/lib/supabase/client";
import type { JobPhoto } from "@/lib/job-photo-data";

/**
 * Before and after, on the job they belong to.
 *
 * Which of the two a photo is gets decided by the column it is added from, at
 * the moment of adding it: asking afterwards is a question nobody answers
 * correctly on the fourth job of the day.
 *
 * Each has two ways in. Take photo opens the camera straight away — the common
 * case, on a ladder with one hand free. Upload opens the photo library, for the
 * pictures already taken with the phone's own camera app, several at a time.
 * They are two buttons because no single file input does both on every phone:
 * `capture` goes straight to the camera and never offers the library, and
 * without it Android's photo picker offers no camera.
 *
 * The file goes from the phone to storage directly, never through this app's
 * server. It used to be posted to a Server Action, which caps request bodies at
 * 1MB — so a real phone photo was rejected by the framework before any of the
 * error handling ran, and the technician got a blank "This page couldn't load"
 * after what looked like a successful capture.
 *
 * Everything the technician can see about that is here: it says it is
 * uploading, then it shows the photo, and if it genuinely fails it says so and
 * offers the button again. There is no state in which the page breaks.
 */

const initialState: PhotoActionState = { error: "" };

type Upload =
  | { state: "idle" }
  /** `done` of `total` photos picked at once have finished, saved or not. */
  | { state: "uploading"; done: number; total: number }
  | { state: "failed"; message: string };

function RemoveButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Remove photo"
      className="tap-target absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-control bg-black/60 text-white disabled:opacity-60"
    >
      {pending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Trash2 className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}

/** "HEIC" for "IMG_0412.HEIC": what kind of file a photo with no preview is. */
function formatOf(fileName: string): string {
  return /\.([a-z0-9]{2,4})$/i.exec(fileName)?.[1]?.toUpperCase() ?? "";
}

function PhotoTile({ jobNumber, photo }: { jobNumber: string; photo: JobPhoto }) {
  const [state, action] = useActionState(removeJobPhoto, initialState);
  // Saved, but not something this browser can draw: mostly a HEIC anywhere but
  // Safari, which is what a Samsung phone takes with "High efficiency pictures"
  // on. Drawn as it was, it is a broken image with its file name spilling over
  // it, and looks like the upload failed.
  const { failed: noPreview, imageProps } = useImageFallback(photo.url);
  const label = photo.stage === "after" ? "After" : "Before";
  const format = formatOf(photo.fileName);

  return (
    <li className="relative">
      {/* Still a link with no preview: the phone hands the file to an app that
          can open it, Gallery or Google Photos. */}
      <a href={photo.url} target="_blank" rel="noreferrer" className="block">
        {noPreview ? (
          <span
            role="img"
            aria-label={`${label} — ${photo.fileName}, no preview`}
            className="@container relative block aspect-square w-full rounded-control border border-line bg-sunken"
          >
            {/* Between the remove button and the Before/After label. On a
                320px screen that gap is 12px, too little for a line of text,
                so there the format alone says what it is. */}
            <span className="absolute inset-x-1 bottom-6 top-12 hidden place-items-center text-center text-[11px] font-semibold text-ink-muted @min-[6rem]:grid">
              No preview
            </span>
            {format ? (
              <span className="absolute left-2 top-2 text-[10px] font-semibold tracking-[0.12em] text-ink-faint">
                {format}
              </span>
            ) : null}
          </span>
        ) : (
          <>
            {/* Not next/image: these are signed URLs that expire, so there is
                nothing stable for the optimizer to cache and it would 404 an
                hour later. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              {...imageProps}
              src={photo.url}
              alt={`${label} — ${photo.fileName}`}
              loading="lazy"
              className="aspect-square w-full rounded-control border border-line object-cover"
            />
          </>
        )}
      </a>

      <span className="absolute bottom-1 left-1 rounded-chip bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">
        {label}
      </span>

      <form action={action}>
        <input type="hidden" name="jobNumber" value={jobNumber} />
        <input type="hidden" name="documentId" value={photo.id} />
        <RemoveButton />
      </form>

      {state.error ? <p className="mt-1 text-xs text-critical">{state.error}</p> : null}
    </li>
  );
}

/** A square standing in for the photos while they go up. */
function UploadingTile({ done, total }: { done: number; total: number }) {
  return (
    <li className="grid aspect-square w-full place-items-center rounded-control border border-dashed border-line text-ink-muted">
      <span className="flex flex-col items-center gap-1.5 px-1 text-center text-[11px]">
        <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
        {/* Several from the library go up one at a time, so it says which. */}
        {total > 1 ? `Uploading ${done + 1} of ${total}…` : "Uploading…"}
      </span>
    </li>
  );
}

const BUTTON =
  "tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-line text-sm font-semibold disabled:opacity-60";

function StagePhotos({
  stage,
  jobNumber,
  onProgress,
  onDone,
  disabled,
}: {
  stage: "before" | "after";
  jobNumber: string;
  /** `done` of `total` have finished, and the next is on its way. */
  onProgress: (done: number, total: number) => void;
  onDone: (failure: string) => void;
  disabled: boolean;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const label = stage === "before" ? "Before" : "After";

  /** One photo, start to finish: what went wrong, or "" once it is saved. */
  async function sendOne(file: File): Promise<string> {
    const fileName = file.name || `photo-${stage}.jpg`;

    try {
      const ticket = await createJobPhotoUpload({
        jobNumber,
        stage,
        fileName,
        mimeType: file.type,
        sizeBytes: file.size,
      });

      if (!ticket.ok) return ticket.error;

      // Straight from the phone to storage. The token is only good for this one
      // object, so nothing else can be written with it.
      const upload = await createClient()
        .storage.from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, file, {
          contentType: file.type || undefined,
        });

      if (upload.error) {
        console.error("job photo: upload to storage failed", upload.error);
        return "That photo did not upload. Check your signal and try again.";
      }

      const recorded = await recordJobPhoto({
        jobNumber,
        stage,
        path: ticket.path,
        fileName,
        mimeType: file.type,
        sizeBytes: file.size,
      });

      return recorded.error;
    } catch (error) {
      // Anything unforeseen — a dropped connection mid-upload, storage
      // unreachable — lands here rather than on a broken page.
      console.error("job photo: unexpected failure", error);
      return "That photo could not be saved. Try again.";
    }
  }

  /*
   * Everything picked, one after another.
   *
   * Not in parallel: five photos at once from a van on one bar of signal is
   * five uploads that all time out together. One at a time, the first ones are
   * saved even if the signal goes, and a photo that fails does not stop the
   * rest — it is counted, and said once at the end.
   */
  async function send(files: File[]) {
    if (files.length === 0) return;

    const failures: string[] = [];
    for (const [index, file] of files.entries()) {
      onProgress(index, files.length);
      const failure = await sendOne(file);
      if (failure) failures.push(failure);
    }

    // The server has the rows; this pulls the thumbnails down with fresh
    // signed URLs rather than guessing them on the client.
    if (failures.length < files.length) router.refresh();

    onDone(
      failures.length === 0
        ? ""
        : files.length === 1
          ? failures[0]!
          : `${failures.length} of ${files.length} photos did not upload. ${failures[0]}`,
    );
  }

  function picked(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Cleared so choosing the same photo twice in a row still fires.
    event.target.value = "";
    void send(files);
  }

  return (
    <div role="group" aria-label={`${label} photos`} className="min-w-0 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">{label}</p>

      {/* The camera, straight away: `capture` skips the library on a phone.
          A desktop browser ignores it and shows a file picker. */}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={picked}
      />
      {/* The library — Photos on an iPhone, the gallery on Android — and
          several at once, for pictures already taken. */}
      <input
        ref={library}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={picked}
      />

      <button type="button" onClick={() => camera.current?.click()} disabled={disabled} className={BUTTON}>
        <Camera className="h-4 w-4 shrink-0" aria-hidden />
        Take photo
      </button>
      <button type="button" onClick={() => library.current?.click()} disabled={disabled} className={BUTTON}>
        <ImageUp className="h-4 w-4 shrink-0" aria-hidden />
        Upload
      </button>
    </div>
  );
}

export function JobPhotos({ jobNumber, photos }: { jobNumber: string; photos: JobPhoto[] }) {
  const [before, setBefore] = useState<Upload>({ state: "idle" });
  const [after, setAfter] = useState<Upload>({ state: "idle" });

  const uploads: Record<"before" | "after", [Upload, (value: Upload) => void]> = {
    before: [before, setBefore],
    after: [after, setAfter],
  };

  const busy = before.state === "uploading" || after.state === "uploading";
  const failure =
    before.state === "failed" ? before.message : after.state === "failed" ? after.message : "";

  return (
    <section>
      <h2 className="text-sm font-semibold">Photos</h2>

      {photos.length > 0 || busy ? (
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <PhotoTile key={photo.id} jobNumber={jobNumber} photo={photo} />
          ))}
          {before.state === "uploading" ? <UploadingTile done={before.done} total={before.total} /> : null}
          {after.state === "uploading" ? <UploadingTile done={after.done} total={after.total} /> : null}
        </ul>
      ) : null}

      {failure ? (
        <p className="mt-2 flex items-start gap-2 text-sm text-critical">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {failure}
        </p>
      ) : null}

      <div className="mt-2 grid grid-cols-2 gap-2">
        {(["before", "after"] as const).map((stage) => {
          const [, set] = uploads[stage];
          return (
            <StagePhotos
              key={stage}
              stage={stage}
              jobNumber={jobNumber}
              disabled={busy}
              onProgress={(done, total) => set({ state: "uploading", done, total })}
              onDone={(message) =>
                set(message ? { state: "failed", message } : { state: "idle" })
              }
            />
          );
        })}
      </div>
    </section>
  );
}
