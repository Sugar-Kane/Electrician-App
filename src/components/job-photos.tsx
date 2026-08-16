"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Camera, LoaderCircle, TriangleAlert, Trash2 } from "lucide-react";

import {
  createJobPhotoUpload,
  recordJobPhoto,
  removeJobPhoto,
  type PhotoActionState,
} from "@/app/jobs/[jobId]/photo-actions";
import { createClient } from "@/lib/supabase/client";
import type { JobPhoto } from "@/lib/job-photo-data";

/**
 * Before and after, on the job they belong to.
 *
 * Two buttons rather than one with a picker: which of the two it is gets
 * decided at the moment of taking it, and asking afterwards is a question
 * nobody answers correctly on the fourth job of the day.
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

type Upload = { state: "idle" } | { state: "uploading" } | { state: "failed"; message: string };

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

function PhotoTile({ jobNumber, photo }: { jobNumber: string; photo: JobPhoto }) {
  const [state, action] = useActionState(removeJobPhoto, initialState);

  return (
    <li className="relative">
      <a href={photo.url} target="_blank" rel="noreferrer" className="block">
        {/* Not next/image: these are signed URLs that expire, so there is
            nothing stable for the optimizer to cache and it would 404 an hour
            later. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.url}
          alt={`${photo.stage === "after" ? "After" : "Before"} — ${photo.fileName}`}
          loading="lazy"
          className="aspect-square w-full rounded-control border border-line object-cover"
        />
      </a>

      <span className="absolute bottom-1 left-1 rounded-chip bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">
        {photo.stage === "after" ? "After" : "Before"}
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

/** A square standing in for the photo while it goes up. */
function UploadingTile() {
  return (
    <li className="grid aspect-square w-full place-items-center rounded-control border border-dashed border-line text-ink-muted">
      <span className="flex flex-col items-center gap-1.5 text-[11px]">
        <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
        Uploading…
      </span>
    </li>
  );
}

function CaptureButton({
  stage,
  jobNumber,
  onStart,
  onDone,
  disabled,
}: {
  stage: "before" | "after";
  jobNumber: string;
  onStart: () => void;
  onDone: (failure: string) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function send(file: File) {
    onStart();

    try {
      const ticket = await createJobPhotoUpload({
        jobNumber,
        stage,
        fileName: file.name || `photo-${stage}.jpg`,
        mimeType: file.type,
        sizeBytes: file.size,
      });

      if (!ticket.ok) {
        onDone(ticket.error);
        return;
      }

      // Straight from the phone to storage. The token is only good for this one
      // object, so nothing else can be written with it.
      const upload = await createClient()
        .storage.from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, file, {
          contentType: file.type || undefined,
        });

      if (upload.error) {
        console.error("job photo: upload to storage failed", upload.error);
        onDone("That photo did not upload. Check your signal and try again.");
        return;
      }

      const recorded = await recordJobPhoto({
        jobNumber,
        stage,
        path: ticket.path,
        fileName: file.name || `photo-${stage}.jpg`,
        mimeType: file.type,
        sizeBytes: file.size,
      });

      if (recorded.error) {
        onDone(recorded.error);
        return;
      }

      onDone("");
      // The server has the row; this pulls the thumbnail down with a fresh
      // signed URL rather than guessing one on the client.
      router.refresh();
    } catch (error) {
      // Anything unforeseen — a dropped connection mid-upload, storage
      // unreachable — lands here rather than on a broken page.
      console.error("job photo: unexpected failure", error);
      onDone("That photo could not be saved. Try again.");
    }
  }

  return (
    <div className="flex-1">
      <input
        ref={input}
        type="file"
        accept="image/*"
        // `capture` opens the camera directly on a phone rather than the photo
        // library. Ignored on a desktop browser, which shows a file picker.
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same photo twice in a row still fires.
          event.target.value = "";
          if (file) void send(file);
        }}
      />

      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled}
        className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-line text-sm font-semibold disabled:opacity-60"
      >
        <Camera className="h-4 w-4" aria-hidden />
        {stage === "before" ? "Before" : "After"}
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
          {before.state === "uploading" ? <UploadingTile /> : null}
          {after.state === "uploading" ? <UploadingTile /> : null}
        </ul>
      ) : null}

      {failure ? (
        <p className="mt-2 flex items-start gap-2 text-sm text-critical">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {failure}
        </p>
      ) : null}

      <div className="mt-2 flex gap-2">
        {(["before", "after"] as const).map((stage) => {
          const [, set] = uploads[stage];
          return (
            <CaptureButton
              key={stage}
              stage={stage}
              jobNumber={jobNumber}
              disabled={busy}
              onStart={() => set({ state: "uploading" })}
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
