/**
 * What the browser can tell about a video before it is uploaded: its shape,
 * its length, and a frame to show before it plays.
 *
 * Done in the browser that picked the file because nothing else can. The
 * server never sees the file, which goes straight to storage. If this browser
 * cannot even open the video, many visitors' browsers will not be able to
 * play it either, so that is reported rather than uploaded.
 */

export type VideoFacts = {
  width: number;
  height: number;
  durationSeconds: number;
  /** A JPEG of one frame, or null when no frame could be drawn. */
  poster: Blob | null;
};

/** The longest side of the poster. Enough for a full-width frame on a laptop. */
const POSTER_EDGE = 1280;

function waitFor(video: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    const done = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("the video could not be read"));
    };
    function cleanup() {
      window.clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener("error", failed);
    }
    video.addEventListener(event, done);
    video.addEventListener("error", failed);
  });
}

async function drawPoster(video: HTMLVideoElement): Promise<Blob | null> {
  try {
    // A second in, or a quarter of the way through a very short clip: the
    // first frame of a recording is often black or a half-drawn screen.
    const at = Math.min(1, video.duration > 0 ? video.duration / 4 : 0);
    if (at > 0) {
      const seeked = waitFor(video, "seeked", 8000);
      video.currentTime = at;
      await seeked;
    } else if (video.readyState < 2) {
      await waitFor(video, "loadeddata", 8000);
    }

    const scale = Math.min(1, POSTER_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  } catch {
    return null;
  }
}

/**
 * Open the video, measure it, and take a poster frame.
 *
 * Throws when the browser cannot open the video at all. A missing poster is
 * not an error: the front page shows a plain frame with a play button instead.
 */
export async function readVideoFile(file: File): Promise<VideoFacts> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    const metadata = waitFor(video, "loadedmetadata", 15000);
    video.src = url;
    video.load();
    await metadata;

    if (!video.videoWidth || !video.videoHeight) {
      throw new Error("the video has no picture this browser can show");
    }

    return {
      width: video.videoWidth,
      height: video.videoHeight,
      durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
      poster: await drawPoster(video),
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
