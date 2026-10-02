"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { ArrowDown, ArrowUp, Film, Pencil, Play, Trash2, Upload, X } from "lucide-react";

import {
  addSiteVideo,
  moveSiteVideo,
  removeSiteVideo,
  updateSiteVideo,
  type SiteVideoState,
} from "@/app/admin/front-page/actions";
import { Banner } from "@/components/ui/banner";
import { Button, SubmitButton } from "@/components/ui/button";
import { Field, FormMessage, TextInput, inputClass } from "@/components/ui/field";
import {
  DESCRIPTION_LIMIT,
  POSTER_PATHNAME,
  POSTER_TYPE,
  TITLE_LIMIT,
  durationLabel,
  frameRatio,
  mayNotPlayEverywhere,
  megabytes,
  readVideoWords,
  videoFileProblem,
  videoPathname,
  videoTypeOf,
  type SiteVideo,
} from "@/lib/site-videos";
import { readVideoFile, type VideoFacts } from "@/lib/video-file";

const initial: SiteVideoState = { error: "" };
const HANDLE_UPLOAD_URL = "/api/admin/site-videos/upload";

function TitleAndDescription({
  title,
  description,
  onChange,
}: {
  title: string;
  description: string;
  onChange: (next: { title?: string; description?: string }) => void;
}) {
  return (
    <div className="grid gap-4">
      <Field label="Title">
        <TextInput
          name="title"
          required
          maxLength={TITLE_LIMIT}
          value={title}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder="Maya books a diagnostic"
        />
      </Field>
      <Field label="Description" hint={`Optional. One or two sentences, up to ${DESCRIPTION_LIMIT} characters.`}>
        <textarea
          name="description"
          rows={2}
          maxLength={DESCRIPTION_LIMIT}
          value={description}
          onChange={(event) => onChange({ description: event.target.value })}
          className={`${inputClass} py-3`}
        />
      </Field>
    </div>
  );
}

type Picked = { file: File; contentType: string; facts: VideoFacts; posterPreview: string };

/**
 * Choosing a video and sending it.
 *
 * The file goes from this browser straight to Blob storage. It is far too big
 * to pass through the app, which only hands out the permission to upload it.
 * The video is recorded once the upload has finished, so a dropped connection
 * part way leaves nothing broken on the front page.
 */
function AddVideo({ connected }: { connected: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [reading, setReading] = useState(false);
  const [words, setWords] = useState({ title: "", description: "" });
  const [phase, setPhase] = useState<"idle" | "uploading" | "saving">("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<SiteVideoState>(initial);

  // The poster preview is a blob: URL made from the file, freed with it.
  useEffect(() => {
    const preview = picked?.posterPreview;
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [picked]);

  function clearFile() {
    setPicked(null);
    if (input.current) input.current.value = "";
  }

  async function choose(file: File | undefined) {
    setResult(initial);
    clearFile();
    if (!file) return;

    const problem = videoFileProblem(file);
    if (problem) {
      setResult({ error: problem });
      return;
    }

    setReading(true);
    try {
      const facts = await readVideoFile(file);
      setPicked({
        file,
        contentType: videoTypeOf(file) ?? "video/mp4",
        facts,
        posterPreview: facts.poster ? URL.createObjectURL(facts.poster) : "",
      });
    } catch {
      if (input.current) input.current.value = "";
      setResult({
        error:
          "This browser could not open that video, so many visitors could not play it either. Export it as an MP4 (H.264) and try again.",
      });
    } finally {
      setReading(false);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!picked || phase !== "idle") return;

    const checked = readVideoWords(words);
    if (!checked.ok) {
      setResult({ error: checked.error });
      return;
    }

    setResult(initial);
    setProgress(0);
    setPhase("uploading");
    const controller = new AbortController();
    abort.current = controller;

    let videoUrl = "";
    try {
      const sent = await upload(videoPathname(picked.contentType), picked.file, {
        access: "public",
        handleUploadUrl: HANDLE_UPLOAD_URL,
        contentType: picked.contentType,
        // In parts, so a large file survives a slow or patchy connection: a
        // part that fails is sent again rather than the whole video.
        multipart: picked.file.size > 8 * 1024 * 1024,
        abortSignal: controller.signal,
        onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
      });
      videoUrl = sent.url;
    } catch (error) {
      setPhase("idle");
      abort.current = null;
      if (controller.signal.aborted) {
        setResult({ error: "Upload stopped. Nothing was added." });
      } else {
        console.error("site videos: upload failed", error);
        setResult({ error: "The video did not finish uploading. Check the connection and try again." });
      }
      return;
    }

    // The poster is a nicety. If it does not make it, the video still goes up
    // and shows a plain frame with a play button until somebody presses it.
    let posterUrl = "";
    if (picked.facts.poster) {
      try {
        const sent = await upload(POSTER_PATHNAME, picked.facts.poster, {
          access: "public",
          handleUploadUrl: HANDLE_UPLOAD_URL,
          contentType: POSTER_TYPE,
          abortSignal: controller.signal,
        });
        posterUrl = sent.url;
      } catch (error) {
        console.error("site videos: poster upload failed", error);
      }
    }
    abort.current = null;

    setPhase("saving");
    const saved = await addSiteVideo({
      videoUrl,
      posterUrl,
      title: checked.title,
      description: checked.description,
      width: picked.facts.width,
      height: picked.facts.height,
      durationSeconds: picked.facts.durationSeconds,
    }).catch((): SiteVideoState => ({ error: "The video uploaded but could not be added. Try again." }));
    setPhase("idle");
    setResult(saved);

    if (!saved.error) {
      clearFile();
      setWords({ title: "", description: "" });
      router.refresh();
    }
  }

  const busy = phase !== "idle";

  return (
    <section className="rounded-panel border border-line bg-surface p-5 sm:p-6" aria-labelledby="add-video-heading">
      <h2 id="add-video-heading" className="text-lg font-semibold">
        Add a video
      </h2>

      {!connected ? (
        <Banner tone="caution" className="mt-4">
          Video storage is not connected yet, so nothing can be uploaded. A Vercel Blob store has to be connected to
          the project first.
        </Banner>
      ) : null}

      <form onSubmit={send} className="mt-4 grid gap-4">
        <div>
          <span className="text-sm font-medium text-ink">Video file</span>
          <input
            ref={input}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => void choose(event.target.files?.[0])}
          />

          {picked ? (
            <div className="mt-2 flex flex-col gap-4 rounded-control border border-line bg-raised p-3 sm:flex-row sm:items-center">
              <div
                className="relative mx-auto max-h-48 w-full max-w-xs shrink-0 overflow-hidden rounded-chip bg-black sm:mx-0 sm:w-40"
                style={{ aspectRatio: String(frameRatio(picked.facts)) }}
              >
                {picked.posterPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={picked.posterPreview} alt="" className="h-full w-full object-contain" />
                ) : (
                  <span className="grid h-full w-full place-items-center text-ink-faint">
                    <Film className="h-6 w-6" aria-hidden />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="break-all text-sm font-semibold text-ink">{picked.file.name}</p>
                <p className="mt-1 text-sm text-ink-muted">
                  {[
                    megabytes(picked.file.size),
                    durationLabel(picked.facts.durationSeconds),
                    `${picked.facts.width} × ${picked.facts.height}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {mayNotPlayEverywhere(picked.contentType) ? (
                  <p className="mt-2 text-xs leading-5 text-caution">
                    A MOV from an iPhone sometimes only plays in Safari. If you can, export it as an MP4 instead.
                  </p>
                ) : null}
              </div>
              {!busy ? (
                <Button type="button" variant="ghost" onClick={clearFile} aria-label="Choose a different video">
                  <X className="h-4 w-4" aria-hidden /> Change
                </Button>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={!connected || reading}
              className="tap-target mt-2 flex min-h-24 w-full flex-col items-center justify-center gap-1 rounded-control border border-dashed border-line-strong bg-raised px-4 py-5 text-sm font-semibold text-ink transition hover:border-brand/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload className="h-5 w-5 text-brand" aria-hidden />
              {reading ? "Reading the video…" : "Choose a video"}
              <span className="text-xs font-normal text-ink-faint">
                MP4 plays everywhere. Up to 250 MB; under 100 MB starts fastest.
              </span>
            </button>
          )}
        </div>

        <TitleAndDescription
          title={words.title}
          description={words.description}
          onChange={(next) => setWords((was) => ({ ...was, ...next }))}
        />

        {phase === "uploading" ? (
          <div role="status" aria-live="polite">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-ink">Uploading…</span>
              <span className="tabular-nums text-ink-muted">{progress}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-raised">
              <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : null}

        <FormMessage error={result.error} notice={result.notice} />

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" size="lg" disabled={!connected || !picked || busy} aria-busy={busy}>
            {phase === "uploading" ? "Uploading…" : phase === "saving" ? "Adding…" : "Upload and add to the front page"}
          </Button>
          {phase === "uploading" ? (
            <Button type="button" variant="secondary" size="lg" onClick={() => abort.current?.abort()}>
              Stop
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function EditVideo({
  video,
  state,
  action,
  onCancel,
}: {
  video: SiteVideo;
  state: SiteVideoState;
  action: (formData: FormData) => void;
  onCancel: () => void;
}) {
  const [words, setWords] = useState({ title: video.title, description: video.description });
  // The answer to an earlier visit to this form is not this visit's problem.
  const [openedWith] = useState(state);

  return (
    <form action={action} className="mt-4 border-t border-line pt-4">
      <input type="hidden" name="id" value={video.id} />
      <TitleAndDescription {...words} onChange={(next) => setWords((was) => ({ ...was, ...next }))} />
      <FormMessage error={state === openedWith ? "" : state.error} />
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <SubmitButton pendingLabel="Saving…" size="md" block={false}>
          Save
        </SubmitButton>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function VideoRow({
  video,
  place,
  count,
  moveAction,
  removeAction,
}: {
  video: SiteVideo;
  place: number;
  count: number;
  moveAction: (formData: FormData) => void;
  removeAction: (formData: FormData) => void;
}) {
  const [updated, updateAction] = useActionState(updateSiteVideo, initial);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState("");

  // A save that went through closes the form and says so.
  const [settled, setSettled] = useState(updated);
  if (updated !== settled) {
    setSettled(updated);
    if (!updated.error) {
      setEditing(false);
      setSaved(updated.notice ?? "Saved.");
    }
  }

  return (
    <li className="rounded-panel border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <a
          href={video.videoUrl}
          target="_blank"
          rel="noreferrer"
          className="relative mx-auto block max-h-48 w-full max-w-xs shrink-0 overflow-hidden rounded-control bg-black sm:mx-0 sm:w-48"
          style={{ aspectRatio: String(frameRatio(video)) }}
          aria-label={`Watch ${video.title}`}
        >
          {video.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={video.posterUrl} alt="" loading="lazy" className="h-full w-full object-contain" />
          ) : (
            <span className="grid h-full w-full place-items-center text-ink-faint">
              <Play className="h-6 w-6" aria-hidden />
            </span>
          )}
        </a>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
            {place} of {count}
            {video.durationSeconds ? ` · ${durationLabel(video.durationSeconds)}` : ""}
          </p>
          <h3 className="mt-1 break-words text-base font-semibold">{video.title}</h3>
          {video.description ? (
            <p className="mt-1 break-words text-sm leading-6 text-ink-muted">{video.description}</p>
          ) : null}
          {saved && !editing ? <FormMessage notice={saved} /> : null}
        </div>
      </div>

      {editing ? (
        <EditVideo video={video} state={updated} action={updateAction} onCancel={() => setEditing(false)} />
      ) : confirming ? (
        <form action={removeAction} className="mt-4 rounded-control border border-critical/30 bg-critical-bg p-4">
          <input type="hidden" name="id" value={video.id} />
          <p className="text-sm text-ink">Take “{video.title}” off the front page and delete the file?</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <SubmitButton pendingLabel="Removing…" variant="danger" size="md" block={false}>
              Remove
            </SubmitButton>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          <form action={moveAction}>
            <input type="hidden" name="id" value={video.id} />
            <input type="hidden" name="direction" value="up" />
            <Button type="submit" variant="secondary" disabled={place === 1} aria-label={`Move ${video.title} earlier`}>
              <ArrowUp className="h-4 w-4" aria-hidden /> Earlier
            </Button>
          </form>
          <form action={moveAction}>
            <input type="hidden" name="id" value={video.id} />
            <input type="hidden" name="direction" value="down" />
            <Button type="submit" variant="secondary" disabled={place === count} aria-label={`Move ${video.title} later`}>
              <ArrowDown className="h-4 w-4" aria-hidden /> Later
            </Button>
          </form>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSaved("");
              setEditing(true);
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden /> Edit
          </Button>
          <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
            <Trash2 className="h-4 w-4" aria-hidden /> Remove
          </Button>
        </div>
      )}
    </li>
  );
}

export function SiteVideoManager({ videos, connected }: { videos: SiteVideo[]; connected: boolean }) {
  // One of each for the whole list rather than one per row. A removed video's
  // row is gone by the time its answer arrives, so the answer is shown here.
  const [moved, moveAction] = useActionState(moveSiteVideo, initial);
  const [removed, removeAction] = useActionState(removeSiteVideo, initial);

  return (
    <div className="space-y-5">
      <AddVideo connected={connected} />

      <section aria-labelledby="videos-list-heading">
        <h2 id="videos-list-heading" className="px-1 text-lg font-semibold">
          On the front page now
        </h2>
        <div role="status">
          <FormMessage error={moved.error} />
          <FormMessage error={removed.error} notice={removed.notice} />
        </div>
        {videos.length === 0 ? (
          <p className="mt-3 rounded-panel border border-dashed border-line-strong p-5 text-sm leading-6 text-ink-muted">
            No videos yet. Until there is one, the front page says walkthrough videos are on the way.
          </p>
        ) : (
          <ol className="mt-3 space-y-3">
            {videos.map((video, index) => (
              <VideoRow
                key={video.id}
                video={video}
                place={index + 1}
                count={videos.length}
                moveAction={moveAction}
                removeAction={removeAction}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
