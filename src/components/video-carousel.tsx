"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Clapperboard, Play } from "lucide-react";

import { durationLabel, frameRatio, type SiteVideo } from "@/lib/site-videos";

/**
 * The front page's walkthrough videos, one at a time.
 *
 * Nothing is downloaded until somebody presses play. Each video shows its
 * poster frame until then, so a visitor who never watches anything does not
 * download any video.
 *
 * Each video is framed in its own shape. A recording made on a phone stands
 * upright and fills most of a phone's screen, rather than shrinking into a
 * widescreen box with black bars either side.
 *
 * It never moves on its own. A video that is playing keeps playing until the
 * visitor moves on, and moving on stops it.
 */
export function VideoCarousel({ videos }: { videos: SiteVideo[] }) {
  const [index, setIndex] = useState(0);
  const [started, setStarted] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  if (videos.length === 0) return <VideosComingSoon />;

  const count = videos.length;
  const at = Math.min(index, count - 1);
  const video = videos[at];
  const ratio = frameRatio(video);
  const length = durationLabel(video.durationSeconds);

  function show(next: number) {
    player.current?.pause();
    // Round the ends, so the arrows cycle through the videos.
    setIndex(((next % count) + count) % count);
    setStarted(false);
  }

  function play() {
    // The lifted finger at the end of a swipe still counts as a press on the
    // play button. Without this, swiping past a video would start it.
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    // Started here, inside the tap, because a phone only lets a video with
    // sound start from one. If it still refuses, the player's own controls
    // are showing by then and its own play button works.
    void player.current?.play().catch(() => undefined);
    setStarted(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    // The player's own arrow keys seek within the video.
    if (count < 2 || event.target instanceof HTMLVideoElement) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      show(at - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      show(at + 1);
    }
  }

  // A sideways swipe across the poster moves to the next or previous video.
  // Only before it plays: once it does, the player owns the touches.
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    swipe.current = { x: event.clientX, y: event.clientY };
    swiped.current = false;
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!start || count < 2) return;
    const across = event.clientX - start.x;
    const down = event.clientY - start.y;
    if (Math.abs(across) < 48 || Math.abs(across) < Math.abs(down)) return;
    swiped.current = true;
    show(across < 0 ? at + 1 : at - 1);
  }

  return (
    <section aria-roledescription="carousel" aria-label="Walkthrough videos" onKeyDown={onKeyDown} className="min-w-0">
      <div className="overflow-hidden rounded-panel border border-line bg-[radial-gradient(circle_at_50%_0%,rgba(255,191,24,.10),transparent_55%),#03080d]">
        <div
          role="group"
          aria-roledescription="slide"
          aria-label={`${at + 1} of ${count}: ${video.title}`}
          onPointerDown={started ? undefined : onPointerDown}
          onPointerUp={started ? undefined : onPointerUp}
          className="relative mx-auto [touch-action:pan-y]"
          style={{ aspectRatio: String(ratio), width: `min(100%, calc(70vh * ${ratio}))` }}
        >
          <video
            key={video.id}
            ref={player}
            src={video.videoUrl}
            poster={video.posterUrl || undefined}
            preload="none"
            playsInline
            controls={started}
            onPlay={() => setStarted(true)}
            aria-label={video.title}
            className="absolute inset-0 h-full w-full object-contain"
          />
          {!started ? (
            <button
              type="button"
              onClick={play}
              aria-label={`Play ${video.title}`}
              className="group absolute inset-0 grid h-full w-full place-items-center"
            >
              <span className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" aria-hidden />
              <span className="relative grid h-16 w-16 place-items-center rounded-full bg-brand text-on-brand shadow-2xl shadow-black/50 transition group-hover:scale-105 sm:h-20 sm:w-20">
                <Play className="ml-1 h-7 w-7 fill-current sm:h-8 sm:w-8" aria-hidden />
              </span>
              {length ? (
                <span className="absolute bottom-3 right-3 rounded-chip bg-black/70 px-2 py-1 text-xs font-semibold tabular-nums text-white">
                  {length}
                </span>
              ) : null}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="break-words text-lg font-semibold leading-snug text-ink">{video.title}</h3>
          {video.description ? (
            <p className="mt-1 break-words text-sm leading-6 text-ink-muted">{video.description}</p>
          ) : null}
        </div>

        {count > 1 ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => show(at - 1)}
              aria-label="Previous video"
              className="tap-target grid min-w-11 place-items-center rounded-control border border-line bg-raised text-ink transition hover:border-line-strong"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <span className="min-w-12 text-center text-sm tabular-nums text-ink-muted" aria-hidden>
              {at + 1} / {count}
            </span>
            <button
              type="button"
              onClick={() => show(at + 1)}
              aria-label="Next video"
              className="tap-target grid min-w-11 place-items-center rounded-control border border-line bg-raised text-ink transition hover:border-line-strong"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      {/* Said aloud when the video changes, since the change happens out of
          sight of somebody tabbing through the arrows. */}
      <p className="sr-only" aria-live="polite">
        {`Video ${at + 1} of ${count}: ${video.title}`}
      </p>

      {count > 1 ? (
        <ul className="mt-5 flex snap-x gap-3 overflow-x-auto pb-2" aria-label="All videos">
          {videos.map((item, position) => (
            <li key={item.id} className="w-36 shrink-0 snap-start sm:w-44">
              <button
                type="button"
                onClick={() => show(position)}
                aria-current={position === at ? "true" : undefined}
                aria-label={`Show video ${position + 1}: ${item.title}`}
                className={`block w-full rounded-control border p-1.5 text-left transition ${
                  position === at ? "border-brand/70 bg-brand/[0.08]" : "border-line bg-surface hover:border-line-strong"
                }`}
              >
                <span className="relative block aspect-video overflow-hidden rounded-chip bg-[#03080d]">
                  {item.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.posterUrl} alt="" loading="lazy" className="h-full w-full object-contain" />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-ink-faint">
                      <Play className="h-5 w-5" aria-hidden />
                    </span>
                  )}
                  {durationLabel(item.durationSeconds) ? (
                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                      {durationLabel(item.durationSeconds)}
                    </span>
                  ) : null}
                </span>
                <span className="mt-1.5 line-clamp-2 block px-1 text-xs font-semibold leading-snug text-ink">
                  {item.title}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * The space kept for the videos before there are any.
 *
 * Shaped like the player it will become, so adding the first video changes what
 * is in the frame rather than the layout of the page around it.
 */
function VideosComingSoon() {
  return (
    <div className="relative grid aspect-video place-items-center overflow-hidden rounded-panel border border-dashed border-line-strong bg-surface px-6 text-center">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,191,24,.10),transparent_45%),radial-gradient(circle_at_80%_90%,rgba(25,105,145,.22),transparent_50%)]" />
      <div className="relative max-w-md">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-line bg-white/5 text-brand">
          <Clapperboard className="h-6 w-6" aria-hidden />
        </span>
        <p className="mt-4 text-lg font-semibold text-ink">Walkthrough videos are on the way</p>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          Short videos of Volteira on a real day: a call answered, a diagnostic booked, an invoice sent.
        </p>
      </div>
    </div>
  );
}
