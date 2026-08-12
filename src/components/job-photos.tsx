"use client";

import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Camera, LoaderCircle, Trash2 } from "lucide-react";

import {
  removeJobPhoto,
  uploadJobPhoto,
  type PhotoActionState,
} from "@/app/jobs/[jobId]/photo-actions";
import type { JobPhoto } from "@/lib/job-photo-data";

/**
 * Before and after, on the job they belong to.
 *
 * The `documents` table has modelled job photos since the storage migration and
 * nothing ever wrote one, so the panel shot went into the phone's camera roll —
 * filed by date, next to somebody's dog, and unfindable when a customer
 * disputes a bill eight months later.
 *
 * Two buttons rather than one with a picker: which of the two it is gets
 * decided at the moment of taking it, and asking afterwards is a question
 * nobody answers correctly on the fourth job of the day.
 *
 * The empty state used to explain, in a sentence and a half, that a before shot
 * settles arguments. True, and not worth reading twice a day for the rest of
 * somebody's career. Two buttons labelled Before and After say it.
 */

const initialState: PhotoActionState = { error: "" };

/**
 * The visible control.
 *
 * `type="button"`, not submit: it opens the file picker, and the form submits
 * itself once a file is actually chosen. A submit button here would post an
 * empty form on the first tap, every time.
 *
 * It still reads `useFormStatus` because it sits inside the form, so the
 * spinner covers the upload that its own tap started.
 */
function UploadButton({
  stage,
  onPick,
}: {
  stage: "before" | "after";
  onPick: () => void;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={pending}
      className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-line text-sm font-semibold disabled:opacity-60"
    >
      {pending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Camera className="h-4 w-4" aria-hidden />
      )}
      {stage === "before" ? "Before" : "After"}
    </button>
  );
}

function UploadForm({ jobNumber, stage }: { jobNumber: string; stage: "before" | "after" }) {
  const [state, action] = useActionState(uploadJobPhoto, initialState);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  return (
    <form ref={form} action={action} className="flex-1">
      <input type="hidden" name="jobNumber" value={jobNumber} />
      <input type="hidden" name="stage" value={stage} />

      <input
        ref={input}
        type="file"
        name="photo"
        accept="image/*"
        // `capture` opens the camera directly on a phone rather than the photo
        // library. Ignored on a desktop browser, which shows a file picker.
        capture="environment"
        className="sr-only"
        onChange={() => {
          // Chosen means send it. A second tap on a separate upload button is a
          // tap that gets forgotten with a phone in one hand and a torch in the
          // other, and the photo is then simply lost.
          if (input.current?.files?.length) form.current?.requestSubmit();
        }}
      />

      <UploadButton stage={stage} onPick={() => input.current?.click()} />

      {state.error ? <p className="mt-1 text-xs text-critical">{state.error}</p> : null}
    </form>
  );
}

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

export function JobPhotos({
  jobNumber,
  photos,
}: {
  jobNumber: string;
  photos: JobPhoto[];
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold">Photos</h2>

      {photos.length > 0 ? (
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <PhotoTile key={photo.id} jobNumber={jobNumber} photo={photo} />
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex gap-2">
        <UploadForm jobNumber={jobNumber} stage="before" />
        <UploadForm jobNumber={jobNumber} stage="after" />
      </div>
    </section>
  );
}
